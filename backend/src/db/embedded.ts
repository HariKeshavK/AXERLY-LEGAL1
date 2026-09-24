// AXERLY modified 2026-09-23.
import { execFile as execFileCallback, spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { promisify } from "node:util";
import { Client } from "pg";
import { axerlyDataDir, loadOrCreateSecrets, type AxerlySecrets } from "../config/secrets";

const execFile = promisify(execFileCallback);
const POSTGRES_USER = "axerly_admin";
const POSTGRES_DATABASE = "axerly";

export interface EmbeddedPostgresInfo {
  host: "127.0.0.1";
  port: number;
  database: string;
  adminUser: string;
  adminUrl: string;
  dataDir: string;
  logFile: string;
  secrets: AxerlySecrets;
}

interface PostgresBinaries {
  initdb: string;
  pg_ctl: string;
}

async function runPgCtl(executable: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    // PostgreSQL's Windows child inherits pg_ctl's standard handles. Pipes can
    // therefore keep execFile open after pg_ctl itself exits; ignored handles
    // let the launcher return while PostgreSQL writes only to its -l log file.
    const child = spawn(executable, args, {
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`pg_ctl exited with ${code ?? signal ?? "unknown status"}`));
    });
  });
}

async function windowsBinaries(): Promise<PostgresBinaries> {
  if (process.platform !== "win32" || process.arch !== "x64") {
    throw new Error("Bundled PostgreSQL is available only for Windows x64");
  }
  try {
    return (await import("@embedded-postgres/windows-x64")) as PostgresBinaries;
  } catch (error) {
    throw new Error(
      "Bundled PostgreSQL binaries are missing from this build",
      { cause: error },
    );
  }
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await access(file, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function freeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate a loopback PostgreSQL port"));
        return;
      }
      const { port } = address;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function connectionUrl(
  user: string,
  password: string,
  port: number,
  database = POSTGRES_DATABASE,
): string {
  const url = new URL("postgresql://127.0.0.1");
  url.username = user;
  url.password = password;
  url.port = String(port);
  url.pathname = `/${database}`;
  url.searchParams.set("sslmode", "disable");
  return url.toString();
}

async function processExists(pid: number): Promise<boolean> {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function clearStalePostmasterPid(dataDir: string): Promise<void> {
  const pidFile = path.join(dataDir, "postmaster.pid");
  let firstLine: string;
  try {
    firstLine = (await readFile(pidFile, "utf8")).split(/\r?\n/, 1)[0] ?? "";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  const pid = Number.parseInt(firstLine.trim(), 10);
  if (await processExists(pid)) {
    throw new Error(`PostgreSQL data directory is already owned by process ${pid}`);
  }
  await rm(pidFile, { force: true });
}

async function healthCheck(url: string): Promise<void> {
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 5_000 });
  await client.connect();
  try {
    const result = await client.query<{ ok: number }>("select 1 as ok");
    if (result.rows[0]?.ok !== 1) throw new Error("PostgreSQL health check failed");
  } finally {
    await client.end();
  }
}

async function ensureApplicationDatabase(
  password: string,
  port: number,
): Promise<void> {
  const client = new Client({
    connectionString: connectionUrl(POSTGRES_USER, password, port, "postgres"),
    connectionTimeoutMillis: 5_000,
  });
  await client.connect();
  try {
    const existing = await client.query(
      "select 1 from pg_database where datname = $1",
      [POSTGRES_DATABASE],
    );
    if (existing.rowCount === 0) {
      await client.query(`create database ${POSTGRES_DATABASE}`);
    }
  } finally {
    await client.end();
  }
}

export class EmbeddedPostgresManager {
  private running: EmbeddedPostgresInfo | null = null;

  constructor(private readonly rootDir = axerlyDataDir()) {}

  async start(): Promise<EmbeddedPostgresInfo> {
    if (this.running) return this.running;
    const binaries = await windowsBinaries();
    const secrets = await loadOrCreateSecrets();
    const dataDir = path.join(this.rootDir, "postgres", "data");
    const logDir = path.join(this.rootDir, "logs");
    const logFile = path.join(logDir, "postgres.log");
    await mkdir(path.dirname(dataDir), { recursive: true });
    await mkdir(logDir, { recursive: true });

    if (!(await fileExists(path.join(dataDir, "PG_VERSION")))) {
      const passwordFile = path.join(
        this.rootDir,
        "postgres",
        `.initdb-password-${process.pid}`,
      );
      await writeFile(passwordFile, secrets.postgresPassword, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      });
      try {
        await execFile(binaries.initdb, [
          "-D",
          dataDir,
          "-U",
          POSTGRES_USER,
          "--pwfile",
          passwordFile,
          "--auth-host=scram-sha-256",
          "--auth-local=scram-sha-256",
          "--encoding=UTF8",
          "--no-locale",
        ]);
      } finally {
        await rm(passwordFile, { force: true });
      }
    }

    await clearStalePostmasterPid(dataDir);
    const port = await freeLoopbackPort();
    const serverOptions = [
      "-h 127.0.0.1",
      `-p ${port}`,
      "-c password_encryption=scram-sha-256",
      "-c listen_addresses=127.0.0.1",
    ].join(" ");
    await runPgCtl(binaries.pg_ctl, [
      "start",
      "-D",
      dataDir,
      "-l",
      logFile,
      "-o",
      serverOptions,
      "-w",
      "-t",
      "30",
    ]);
    try {
      await ensureApplicationDatabase(secrets.postgresPassword, port);
      const adminUrl = connectionUrl(POSTGRES_USER, secrets.postgresPassword, port);
      await healthCheck(adminUrl);
      this.running = {
        host: "127.0.0.1",
        port,
        database: POSTGRES_DATABASE,
        adminUser: POSTGRES_USER,
        adminUrl,
        dataDir,
        logFile,
        secrets,
      };
      return this.running;
    } catch (error) {
      await runPgCtl(binaries.pg_ctl, [
        "stop", "-D", dataDir, "-m", "fast", "-w", "-t", "30",
      ]).catch(() => undefined);
      throw error;
    }
  }

  async health(): Promise<boolean> {
    if (!this.running) return false;
    try {
      await healthCheck(this.running.adminUrl);
      return true;
    } catch {
      return false;
    }
  }

  async stop(): Promise<void> {
    const current = this.running;
    if (!current) return;
    this.running = null;
    const binaries = await windowsBinaries();
    await runPgCtl(binaries.pg_ctl, [
      "stop",
      "-D",
      current.dataDir,
      "-m",
      "fast",
      "-w",
      "-t",
      "30",
    ]);
  }
}

let processManager: EmbeddedPostgresManager | null = null;

export function embeddedPostgresManager(): EmbeddedPostgresManager {
  processManager ??= new EmbeddedPostgresManager();
  return processManager;
}

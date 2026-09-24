// AXERLY modified 2026-09-23.
import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface AxerlySecrets {
  postgresPassword: string;
  sessionSecret: string;
}

/**
 * Storage boundary for machine secrets. Electron can replace this file-backed
 * implementation with a safeStorage-backed implementation without changing
 * database or authentication code.
 */
export interface SecretsStore {
  load(): Promise<AxerlySecrets | null>;
  save(secrets: AxerlySecrets): Promise<void>;
}

const SECRET_FILE_VERSION = 1;

export function axerlyDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.AXERLY_DATA_DIR?.trim();
  if (configured) return path.resolve(configured);
  const appData = env.APPDATA?.trim();
  return path.join(appData ? path.resolve(appData) : os.homedir(), "AXERLY");
}

function isSecrets(value: unknown): value is AxerlySecrets {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.postgresPassword === "string" &&
    record.postgresPassword.length >= 32 &&
    typeof record.sessionSecret === "string" &&
    record.sessionSecret.length >= 43
  );
}

export class FileSecretsStore implements SecretsStore {
  readonly filePath: string;

  constructor(dataDir = axerlyDataDir()) {
    this.filePath = path.join(dataDir, "config", "secrets.json");
  }

  async load(): Promise<AxerlySecrets | null> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as {
        version?: unknown;
        secrets?: unknown;
      };
      if (parsed.version !== SECRET_FILE_VERSION || !isSecrets(parsed.secrets)) {
        throw new Error("AXERLY secrets file has an unsupported format");
      }
      return parsed.secrets;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return null;
      throw error;
    }
  }

  async save(secrets: AxerlySecrets): Promise<void> {
    if (!isSecrets(secrets)) throw new Error("Refusing to persist invalid secrets");
    const directory = path.dirname(this.filePath);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = `${this.filePath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
    const body = `${JSON.stringify(
      { version: SECRET_FILE_VERSION, secrets },
      null,
      2,
    )}\n`;
    await writeFile(temporary, body, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(temporary, this.filePath);
    // chmod is meaningful on Unix and best-effort on Windows. Electron's
    // safeStorage backend will provide OS-backed encryption in P13.
    await chmod(this.filePath, 0o600).catch(() => undefined);
  }
}

export function generateSecrets(): AxerlySecrets {
  return {
    postgresPassword: randomBytes(32).toString("base64url"),
    sessionSecret: randomBytes(48).toString("base64url"),
  };
}

export async function loadOrCreateSecrets(
  store: SecretsStore = new FileSecretsStore(),
): Promise<AxerlySecrets> {
  const existing = await store.load();
  if (existing) return existing;
  const generated = generateSecrets();
  await store.save(generated);
  return generated;
}

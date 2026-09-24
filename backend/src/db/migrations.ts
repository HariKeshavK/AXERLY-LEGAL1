// AXERLY modified 2026-09-23.
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";

const MIGRATION_LOCK_ID = 8_171_945_729;
const APP_ROLE = "axerly_app";

export interface MigrationRecord {
  version: string;
  checksum: string;
  file: string;
}

function backendRoot(): string {
  return path.resolve(__dirname, "..", "..");
}

function checksum(sql: string): string {
  return createHash("sha256").update(sql, "utf8").digest("hex");
}

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

async function migrationFiles(): Promise<MigrationRecord[]> {
  const root = backendRoot();
  const baseline = path.join(root, "schema.sql");
  const records: MigrationRecord[] = [
    {
      version: "0001",
      checksum: checksum(await readFile(baseline, "utf8")),
      file: baseline,
    },
  ];
  const directory = path.join(root, "db", "migrations");
  let files: string[] = [];
  try {
    files = (await readdir(directory))
      .filter((file) => /^\d{4}_[a-z0-9_-]+\.sql$/i.test(file))
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  for (const file of files) {
    const sql = await readFile(path.join(directory, file), "utf8");
    records.push({
      version: file.slice(0, 4),
      checksum: checksum(sql),
      file: path.join(directory, file),
    });
  }
  const versions = new Set<string>();
  for (const record of records) {
    if (versions.has(record.version)) {
      throw new Error(`Duplicate database migration version ${record.version}`);
    }
    versions.add(record.version);
  }
  return records;
}

async function ensureApplicationRole(
  client: Client,
  password: string,
): Promise<void> {
  await client.query(`
    do $$
    begin
      if not exists (select 1 from pg_roles where rolname = '${APP_ROLE}') then
        create role ${APP_ROLE} login nosuperuser nocreatedb nocreaterole noinherit;
      end if;
    end
    $$;
  `);
  await client.query("set password_encryption = 'scram-sha-256'");
  await client.query(
    `alter role ${APP_ROLE} password ${sqlLiteral(password)}`,
  );
}

async function grantApplicationPrivileges(client: Client): Promise<void> {
  const database = await client.query<{ name: string }>(
    "select current_database() as name",
  );
  const databaseName = database.rows[0]?.name;
  if (!databaseName || !/^[a-z_][a-z0-9_]*$/i.test(databaseName)) {
    throw new Error("Unsafe PostgreSQL database name");
  }
  await client.query(`
    grant connect on database "${databaseName}" to ${APP_ROLE};
    grant usage on schema public to ${APP_ROLE};
    grant select, insert, update, delete on all tables in schema public to ${APP_ROLE};
    grant usage, select, update on all sequences in schema public to ${APP_ROLE};
    grant execute on all functions in schema public to ${APP_ROLE};
    alter default privileges in schema public
      grant select, insert, update, delete on tables to ${APP_ROLE};
    alter default privileges in schema public
      grant usage, select, update on sequences to ${APP_ROLE};
    alter default privileges in schema public
      grant execute on functions to ${APP_ROLE};
  `);
}

/** Apply each migration exactly once, with checksum drift detection. */
export async function runMigrations(args: {
  adminUrl: string;
  appPassword: string;
}): Promise<MigrationRecord[]> {
  const client = new Client({ connectionString: args.adminUrl });
  await client.connect();
  const applied: MigrationRecord[] = [];
  try {
    await ensureApplicationRole(client, args.appPassword);
    await client.query(`
      create table if not exists public.schema_migrations (
        version text primary key,
        checksum text not null,
        applied_at timestamptz not null default now()
      )
    `);
    for (const migration of await migrationFiles()) {
      await client.query("begin");
      try {
        await client.query("select pg_advisory_xact_lock($1)", [
          MIGRATION_LOCK_ID,
        ]);
        const existing = await client.query<{ checksum: string }>(
          "select checksum from public.schema_migrations where version = $1",
          [migration.version],
        );
        if (existing.rows[0]) {
          if (existing.rows[0].checksum !== migration.checksum) {
            throw new Error(
              `Applied migration ${migration.version} has changed on disk`,
            );
          }
        } else {
          await client.query(await readFile(migration.file, "utf8"));
          await client.query(
            "insert into public.schema_migrations(version, checksum) values ($1, $2)",
            [migration.version, migration.checksum],
          );
          applied.push(migration);
        }
        await grantApplicationPrivileges(client);
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    }
    return applied;
  } finally {
    await client.end();
  }
}

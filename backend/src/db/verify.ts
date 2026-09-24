// AXERLY modified 2026-09-23.
// Build-time smoke test for the bundled Windows PostgreSQL distribution.
import { Client } from "pg";
import { embeddedPostgresManager } from "./embedded";
import { prepareDatabaseRuntime } from "./runtime";

async function main(): Promise<void> {
  const runtime = await prepareDatabaseRuntime({ forceEmbedded: true });
  // A second run must be a no-op and proves migration idempotence.
  await prepareDatabaseRuntime({ forceEmbedded: true });
  const client = new Client({ connectionString: runtime.databaseUrl });
  await client.connect();
  try {
    const extensions = await client.query<{ extname: string }>(
      "select extname from pg_extension where extname in ('pgcrypto', 'pg_trgm') order by extname",
    );
    const columns = await client.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'users' order by ordinal_position",
    );
    const migrations = await client.query<{ version: string }>(
      "select version from public.schema_migrations order by version",
    );
    const expected = ["id", "email", "password_hash", "role", "status", "created_at"];
    const actual = columns.rows.map((row) => row.column_name);
    if (expected.some((column) => !actual.includes(column))) {
      throw new Error(`users table is missing required columns: ${actual.join(", ")}`);
    }
    if (!extensions.rows.some((row) => row.extname === "pgcrypto") ||
        !extensions.rows.some((row) => row.extname === "pg_trgm")) {
      throw new Error("Bundled PostgreSQL did not load pgcrypto and pg_trgm");
    }
    console.log(JSON.stringify({
      embedded: runtime.embedded,
      host: "127.0.0.1",
      port: runtime.port,
      extensions: extensions.rows.map((row) => row.extname),
      userColumns: actual,
      migrations: migrations.rows.map((row) => row.version),
    }));
  } finally {
    await client.end();
    await embeddedPostgresManager().stop();
  }
}

main().catch(async (error) => {
  console.error(error);
  await embeddedPostgresManager().stop().catch(() => undefined);
  process.exitCode = 1;
});

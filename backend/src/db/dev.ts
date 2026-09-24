// AXERLY modified 2026-09-23.
import "dotenv/config";
import { embeddedPostgresManager } from "./embedded";
import { prepareDatabaseRuntime } from "./runtime";

async function main() {
  const manager = embeddedPostgresManager();
  const runtime = await prepareDatabaseRuntime({ forceEmbedded: true });
  console.log(`AXERLY PostgreSQL ready on 127.0.0.1:${runtime.port}`);
  console.log(`Data: ${runtime.dataDir}`);
  console.log(`Log: ${runtime.logFile}`);

  const stop = async () => {
    await manager.stop();
    process.exit(0);
  };
  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());
}

void main();

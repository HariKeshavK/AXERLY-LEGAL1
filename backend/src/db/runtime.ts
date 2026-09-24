// AXERLY modified 2026-09-23; AXERLY modified 2026-09-24.
import { loadOrCreateSecrets } from "../config/secrets";
import { embeddedPostgresManager, type EmbeddedPostgresInfo } from "./embedded";
import { runMigrations } from "./migrations";
import { sweepStorageTempFiles } from "../lib/storage";

const APP_USER = "axerly_app";

function applicationUrl(info: EmbeddedPostgresInfo): string {
  const url = new URL(info.adminUrl);
  url.username = APP_USER;
  url.password = info.secrets.postgresPassword;
  return url.toString();
}

export interface DatabaseRuntime {
  embedded: boolean;
  port: number | null;
  dataDir: string | null;
  logFile: string | null;
  databaseUrl: string;
}

export async function prepareDatabaseRuntime(options: {
  forceEmbedded?: boolean;
} = {}): Promise<DatabaseRuntime> {
  await sweepStorageTempFiles();
  const configuredUrl = process.env.DATABASE_URL?.trim();
  if (configuredUrl && !options.forceEmbedded) {
    const secrets = await loadOrCreateSecrets();
    process.env.AXERLY_SESSION_SECRET = secrets.sessionSecret;
    await runMigrations({
      adminUrl: process.env.DATABASE_ADMIN_URL?.trim() || configuredUrl,
      appPassword: secrets.postgresPassword,
    });
    return {
      embedded: false,
      port: null,
      dataDir: null,
      logFile: null,
      databaseUrl: configuredUrl,
    };
  }

  const manager = embeddedPostgresManager();
  const info = await manager.start();
  try {
    await runMigrations({
      adminUrl: info.adminUrl,
      appPassword: info.secrets.postgresPassword,
    });
  } catch (error) {
    await manager.stop().catch(() => undefined);
    throw error;
  }
  const databaseUrl = applicationUrl(info);
  process.env.DATABASE_URL = databaseUrl;
  process.env.AXERLY_SESSION_SECRET = info.secrets.sessionSecret;
  return {
    embedded: true,
    port: info.port,
    dataDir: info.dataDir,
    logFile: info.logFile,
    databaseUrl,
  };
}

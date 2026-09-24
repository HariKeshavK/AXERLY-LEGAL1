// AXERLY modified 2026-09-23.
import "../instrument";
import { closeDatabasePool, createDatabase } from "../lib/database";
import { flushSentry, reportError } from "../lib/observability/sentry";
import { syncWorkflowCatalog } from "../lib/workflowCatalogSync";
import { prepareDatabaseRuntime } from "../db/runtime";
import { embeddedPostgresManager } from "../db/embedded";

async function main() {
  await prepareDatabaseRuntime();
  try {
    const result = await syncWorkflowCatalog(createDatabase());
    console.log(
      `Synced ${result.workflows} AXERLY workflows and ${result.assets} assets from ${result.sourceCommit}`,
    );
  } finally {
    await closeDatabasePool();
    await embeddedPostgresManager().stop();
  }
}

void main().catch(async (error) => {
  reportError(error, { tags: { component: "workflow-sync" }, level: "fatal" });
  console.error("AXERLY workflow sync failed", error);
  await flushSentry();
  process.exit(1);
});

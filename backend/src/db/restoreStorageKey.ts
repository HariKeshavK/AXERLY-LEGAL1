// AXERLY modified 2026-09-24.
/** Read a recovery key from standard input; never accept it in argv or an env var. */
import { createDecipheriv } from "node:crypto";
import { decodeStorageRecoveryKey, restoreStorageMasterKey } from "../config/secrets";
import { databasePool } from "../lib/database";
import { embeddedPostgresManager } from "./embedded";
import { prepareDatabaseRuntime } from "./runtime";

async function main(): Promise<void> {
  const interactive = !!process.stdin.isTTY;
  if (interactive) {
    process.stderr.write("Paste the AXERLY recovery key, then press Enter (input hidden): ");
    process.stdin.setRawMode(true);
  }
  let input = "";
  try {
    for await (const chunk of process.stdin) {
      input += String(chunk);
      if (input.includes("\n") || input.includes("\r")) break;
      if (input.length > 1024) throw new Error("Recovery key is too long");
    }
  } finally {
    if (interactive) {
      process.stdin.setRawMode(false);
      process.stderr.write("\n");
    }
  }
  const key = input.split(/[\r\n]/, 1)[0].trim();
  const candidate = decodeStorageRecoveryKey(key);
  await prepareDatabaseRuntime();
  try {
    const result = await databasePool().query<{
      id: string; owner_id: string; wrapped_data_key: Buffer; wrap_nonce: Buffer; wrap_tag: Buffer;
    }>("select id, owner_id, wrapped_data_key, wrap_nonce, wrap_tag from public.stored_files limit 1");
    const sample = result.rows[0];
    if (sample) {
      const decipher = createDecipheriv("aes-256-gcm", candidate, sample.wrap_nonce);
      decipher.setAAD(Buffer.from(`AXERLY:file:${sample.id}:owner:${sample.owner_id}`, "utf8"));
      decipher.setAuthTag(sample.wrap_tag);
      const unwrapped = Buffer.concat([decipher.update(sample.wrapped_data_key), decipher.final()]);
      if (unwrapped.length !== 32) throw new Error("Recovery key does not match encrypted files");
    }
    await restoreStorageMasterKey(key);
    process.stderr.write("Storage master key restored. Restart AXERLY before opening files.\n");
  } finally {
    await databasePool().end();
    await embeddedPostgresManager().stop();
  }
}

void main().catch(() => {
  process.stderr.write("Storage key restore failed. Verify the key and database, then retry.\n");
  process.exitCode = 1;
});

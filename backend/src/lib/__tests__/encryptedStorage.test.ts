// AXERLY modified 2026-09-24.
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { EncryptedFilesystemStorage, StorageOperationError } from "../storage";
import {
  acknowledgeStorageRecoveryKey,
  consumeStorageRecoveryKey,
  decodeStorageRecoveryKey,
  encodeStorageRecoveryKey,
  generateSecrets,
  pendingStorageRecoveryKey,
  restoreStorageMasterKey,
  type AxerlySecrets,
  type SecretsStore,
} from "../../config/secrets";

class MemoryMetadataDb {
  rows = new Map<string, any>();
  async query<T>(sql: string, values: unknown[] = []): Promise<{ rows: T[] }> {
    if (sql.startsWith("select *")) {
      const match = [...this.rows.values()].find((row) =>
        sql.includes("logical_key") ? row.logical_key === values[0] : row.id === values[0]);
      return { rows: match ? [match] : [] } as { rows: T[] };
    }
    if (sql.startsWith("insert into")) {
      const [id, owner_id, logical_key, logical_key_sha256, resource_kind, resource_id, wrapped_data_key,
        wrap_nonce, wrap_tag, nonce_prefix, frame_size, plaintext_size, plaintext_sha256] = values;
      this.rows.set(String(id), { id, owner_id, logical_key, logical_key_sha256, resource_kind, resource_id,
        wrapped_data_key, wrap_nonce, wrap_tag, nonce_prefix, frame_size, plaintext_size, plaintext_sha256 });
      return { rows: [] } as { rows: T[] };
    }
    if (sql.startsWith("delete")) this.rows.delete(String(values[0]));
    return { rows: [] } as { rows: T[] };
  }
}

const directories: string[] = [];
async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "axerly-storage-"));
  directories.push(directory);
  const db = new MemoryMetadataDb();
  return { directory, db, store: new EncryptedFilesystemStorage(directory, randomBytes(32), db as any, 64 * 1024) };
}
async function bytes(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
afterEach(async () => Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))));

describe("encrypted filesystem storage", () => {
  it.each([
    ["PDF", Buffer.from("%PDF-1.7\nAXERLY-PDF-CONTENT\n%%EOF")],
    ["DOCX", Buffer.concat([Buffer.from("PK\x03\x04"), randomBytes(128)])],
    ["image", Buffer.concat([Buffer.from("\x89PNG\r\n\x1a\n", "binary"), randomBytes(128)])],
  ])("round-trips %s bytes without plaintext on disk", async (_kind, input) => {
    const { directory, store } = await fixture();
    const ownerId = randomUUID();
    const saved = await store.put(Readable.from(input), { ownerId });
    const encrypted = await readFile(path.join(directory, "files", saved.id.slice(0, 2), `${saved.id}.enc`));
    expect(encrypted.includes(input)).toBe(false);
    const output = await store.get(saved.id, { id: ownerId, role: "member", status: "active" });
    expect(output && await bytes(output)).toEqual(input);
  });

  it("rejects a caller without access as not found", async () => {
    const { store } = await fixture();
    const saved = await store.put(Readable.from("private"), { ownerId: randomUUID() });
    await expect(store.get(saved.id, { id: randomUUID(), role: "member", status: "active" })).resolves.toBeNull();
  });

  it("fails authenticated decryption after a ciphertext byte is changed", async () => {
    const { directory, store } = await fixture();
    const ownerId = randomUUID();
    const saved = await store.put(Readable.from(Buffer.alloc(100_000, 7)), { ownerId });
    const filename = path.join(directory, "files", saved.id.slice(0, 2), `${saved.id}.enc`);
    const encrypted = await readFile(filename);
    encrypted[20] ^= 1;
    await writeFile(filename, encrypted);
    const output = await store.get(saved.id, { id: ownerId, role: "member", status: "active" });
    await expect(bytes(output!)).rejects.toBeInstanceOf(StorageOperationError);
  });

  it("streams 200 MB with bounded process memory", async () => {
    const { store } = await fixture();
    const ownerId = randomUUID();
    const chunk = Buffer.alloc(64 * 1024, 0x5a);
    const count = (200 * 1024 * 1024) / chunk.length;
    const rssBefore = process.memoryUsage().rss;
    const saved = await store.put(Readable.from((function* () { for (let i = 0; i < count; i++) yield chunk; })()), { ownerId });
    const output = await store.get(saved.id, { id: ownerId, role: "member", status: "active" });
    const digest = createHash("sha256");
    let total = 0;
    for await (const value of output!) { const part = Buffer.from(value); total += part.length; digest.update(part); }
    expect(total).toBe(200 * 1024 * 1024);
    expect(digest.digest("hex")).toBe(saved.sha256);
    expect(process.memoryUsage().rss - rssBefore).toBeLessThan(96 * 1024 * 1024);
  }, 60_000);
});

describe("storage recovery key", () => {
  it("keeps the recovery key available until the first admin acknowledges it", async () => {
    let value: AxerlySecrets | null = generateSecrets();
    const store: SecretsStore = { load: async () => value, save: async (next) => { value = next; } };
    const first = await pendingStorageRecoveryKey(store);
    expect(first).toBeTruthy();
    expect(await pendingStorageRecoveryKey(store)).toBe(first);
    await acknowledgeStorageRecoveryKey(store);
    expect(await pendingStorageRecoveryKey(store)).toBeNull();
  });

  it("has a checksum, is shown once, and restores the exact master key", async () => {
    let value: AxerlySecrets | null = generateSecrets();
    const store: SecretsStore = { load: async () => value, save: async (next) => { value = next; } };
    const expected = Buffer.from(value.storageMasterKey, "base64url");
    expect(decodeStorageRecoveryKey(encodeStorageRecoveryKey(expected))).toEqual(expected);
    const recovery = await consumeStorageRecoveryKey(store);
    expect(recovery).toMatch(/^AXERLY-/);
    await expect(consumeStorageRecoveryKey(store)).resolves.toBeNull();
    value = { ...value!, storageMasterKey: randomBytes(32).toString("base64url") };
    await restoreStorageMasterKey(recovery!, store);
    expect(Buffer.from(value.storageMasterKey, "base64url")).toEqual(expected);
    const altered = `${recovery!.slice(0, 7)}${recovery![7] === "A" ? "B" : "A"}${recovery!.slice(8)}`;
    expect(() => decodeStorageRecoveryKey(altered)).toThrow();
  });
});

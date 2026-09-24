// AXERLY modified 2026-09-24.
/** Encrypted, streaming host-filesystem storage. */
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, rename, rm } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { axerlyDataDir, loadOrCreateSecrets } from "../config/secrets";
import { can, ensureDocAccess, type AuthzUser } from "./authz";
import { createDatabase, databasePool } from "./database";
import { bestEffort } from "./observability/sentry";

const MAGIC = Buffer.from("AXF1\r\n\x1a\n", "binary");
const DEFAULT_FRAME_SIZE = 1024 * 1024;
const SYSTEM_OWNER_ID = "00000000-0000-0000-0000-000000000000";

export type StorageUser = AuthzUser & { email?: string };
export interface PutMetadata {
  ownerId: string;
  fileId?: string;
  logicalKey?: string;
  resourceKind?: "user" | "document" | "project" | "library" | "system";
  resourceId?: string;
}
export interface StoredFile { id: string; size: number; sha256: string; }
export interface Storage {
  put(stream: Readable, meta: PutMetadata): Promise<StoredFile>;
  get(fileId: string, user: StorageUser): Promise<Readable | null>;
  delete(fileId: string): Promise<void>;
}
type StoredFileRow = {
  id: string; owner_id: string; logical_key: string | null; logical_key_sha256: string | null;
  resource_kind: PutMetadata["resourceKind"]; resource_id: string | null;
  wrapped_data_key: Buffer; wrap_nonce: Buffer; wrap_tag: Buffer;
  nonce_prefix: Buffer; frame_size: number; plaintext_size: string | number;
  plaintext_sha256: string;
};

export class StorageOperationError extends Error {
  constructor(operation: string, options?: { cause?: unknown }) {
    super(`Encrypted file storage ${operation} failed`, options);
    this.name = "StorageOperationError";
  }
}
function aad(fileId: string, ownerId: string, frame?: number): Buffer {
  return Buffer.from(frame === undefined
    ? `AXERLY:file:${fileId}:owner:${ownerId}`
    : `AXERLY:file:${fileId}:owner:${ownerId}:frame:${frame}`, "utf8");
}
function frameNonce(prefix: Buffer, frame: number): Buffer {
  if (prefix.length !== 8 || frame > 0xffff_ffff) throw new Error("Invalid encrypted file nonce");
  const nonce = Buffer.allocUnsafe(12);
  prefix.copy(nonce);
  nonce.writeUInt32BE(frame, 8);
  return nonce;
}
function ciphertextPath(dataDir: string, fileId: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(fileId)) throw new Error("Invalid file id");
  return path.join(dataDir, "files", fileId.slice(0, 2).toLowerCase(), `${fileId}.enc`);
}
async function writeChunk(output: NodeJS.WritableStream, chunk: Buffer): Promise<void> {
  if (output.write(chunk)) return;
  await new Promise<void>((resolve, reject) => {
    const onDrain = () => { output.removeListener("error", onError); resolve(); };
    const onError = (error: Error) => { output.removeListener("drain", onDrain); reject(error); };
    output.once("drain", onDrain);
    output.once("error", onError);
  });
}

export class EncryptedFilesystemStorage implements Storage {
  constructor(
    private readonly dataDir: string,
    private readonly masterKey: Buffer,
    private readonly db = databasePool(),
    private readonly frameSize = DEFAULT_FRAME_SIZE,
  ) {
    if (masterKey.length !== 32) throw new Error("Storage master key must be 32 bytes");
  }
  private async row(fileIdOrKey: string): Promise<StoredFileRow | null> {
    const byId = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(fileIdOrKey);
    const result = await this.db.query<StoredFileRow>(
      `select * from public.stored_files where ${byId ? "id" : "logical_key"} = $1`, [fileIdOrKey]);
    return result.rows[0] ?? null;
  }
  async put(input: Readable, meta: PutMetadata): Promise<StoredFile> {
    const prior = meta.logicalKey ? await this.row(meta.logicalKey) : null;
    const fileId = meta.fileId ?? randomUUID();
    const finalPath = ciphertextPath(this.dataDir, fileId);
    await mkdir(path.dirname(finalPath), { recursive: true, mode: 0o700 });
    const stagingDir = path.join(this.dataDir, "tmp", "staging");
    await mkdir(stagingDir, { recursive: true, mode: 0o700 });
    const temporaryPath = path.join(stagingDir, `${fileId}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
    const dataKey = randomBytes(32);
    const noncePrefix = randomBytes(8);
    const wrapNonce = randomBytes(12);
    const wrapper = createCipheriv("aes-256-gcm", this.masterKey, wrapNonce);
    wrapper.setAAD(aad(fileId, meta.ownerId));
    const wrappedDataKey = Buffer.concat([wrapper.update(dataKey), wrapper.final()]);
    const wrapTag = wrapper.getAuthTag();
    const hash = createHash("sha256");
    let size = 0;
    let frame = 0;
    const output = createWriteStream(temporaryPath, { flags: "wx", mode: 0o600 });
    try {
      await writeChunk(output, MAGIC);
      const pending = Buffer.allocUnsafe(this.frameSize);
      let pendingLength = 0;
      for await (const value of input) {
        const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
        let offset = 0;
        while (offset < chunk.length) {
          const length = Math.min(this.frameSize - pendingLength, chunk.length - offset);
          chunk.copy(pending, pendingLength, offset, offset + length);
          pendingLength += length;
          offset += length;
          if (pendingLength === this.frameSize) {
            await this.writeFrame(output, pending, dataKey, noncePrefix, fileId, meta.ownerId, frame++);
            hash.update(pending); size += pendingLength; pendingLength = 0;
          }
        }
      }
      if (pendingLength || frame === 0) {
        const last = pending.subarray(0, pendingLength);
        await this.writeFrame(output, last, dataKey, noncePrefix, fileId, meta.ownerId, frame);
        hash.update(last); size += pendingLength;
      }
      output.end();
      await new Promise<void>((resolve, reject) => {
        output.once("finish", resolve); output.once("error", reject);
      });
      const digest = hash.digest("hex");
      await rename(temporaryPath, finalPath);
      await this.db.query(
        `insert into public.stored_files
          (id,owner_id,logical_key,logical_key_sha256,resource_kind,resource_id,wrapped_data_key,wrap_nonce,wrap_tag,nonce_prefix,frame_size,plaintext_size,plaintext_sha256)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         on conflict (logical_key) do update set id=excluded.id,owner_id=excluded.owner_id,logical_key_sha256=excluded.logical_key_sha256,
          resource_kind=excluded.resource_kind,resource_id=excluded.resource_id,wrapped_data_key=excluded.wrapped_data_key,
          wrap_nonce=excluded.wrap_nonce,wrap_tag=excluded.wrap_tag,nonce_prefix=excluded.nonce_prefix,
          frame_size=excluded.frame_size,plaintext_size=excluded.plaintext_size,plaintext_sha256=excluded.plaintext_sha256,created_at=now()`,
        [fileId, meta.ownerId, meta.logicalKey ?? null,
          meta.logicalKey ? createHash("sha256").update(meta.logicalKey).digest("hex") : null,
          meta.resourceKind ?? "user", meta.resourceId ?? null,
          wrappedDataKey, wrapNonce, wrapTag, noncePrefix, this.frameSize, size, digest]);
      if (prior && prior.id !== fileId) {
        await rm(ciphertextPath(this.dataDir, prior.id), { force: true }).catch(() => undefined);
      }
      return { id: fileId, size, sha256: digest };
    } catch (error) {
      input.destroy(); output.destroy();
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      await rm(finalPath, { force: true }).catch(() => undefined);
      throw error instanceof StorageOperationError ? error : new StorageOperationError("put", { cause: error });
    }
  }
  private async writeFrame(output: NodeJS.WritableStream, plain: Buffer, dataKey: Buffer,
    noncePrefix: Buffer, fileId: string, ownerId: string, frame: number): Promise<void> {
    const cipher = createCipheriv("aes-256-gcm", dataKey, frameNonce(noncePrefix, frame));
    cipher.setAAD(aad(fileId, ownerId, frame));
    const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
    const length = Buffer.allocUnsafe(4); length.writeUInt32BE(plain.length);
    await writeChunk(output, Buffer.concat([length, encrypted, cipher.getAuthTag()]));
  }
  private async authorized(row: StoredFileRow, user: StorageUser): Promise<boolean> {
    if (row.resource_kind === "document" && row.resource_id && user.email) {
      const db = createDatabase();
      const { data: doc } = await db.from("documents")
        .select("user_id,project_id,org_id,workflow_id")
        .eq("id", row.resource_id).maybeSingle();
      const { data: version } = await db.from("document_versions")
        .select("id").eq("document_id", row.resource_id)
        .eq("storage_path", row.logical_key).is("deleted_at", null).maybeSingle();
      const { data: pdfVersion } = version ? { data: version } : await db.from("document_versions")
        .select("id").eq("document_id", row.resource_id)
        .eq("pdf_storage_path", row.logical_key).is("deleted_at", null).maybeSingle();
      if (!doc || !pdfVersion) return false;
      const access = await ensureDocAccess(doc, user.id, user.email, db);
      return access.ok && can(user, "read", {
        kind: "document", ownerId: doc.user_id ?? undefined,
        accessRole: access.projectRole ?? undefined,
      });
    }
    if (row.resource_kind === "user") {
      return can(user, "read", { kind: "user", ownerId: row.owner_id });
    }
    return false;
  }
  private decrypt(row: StoredFileRow): Readable {
    const filePath = ciphertextPath(this.dataDir, row.id);
    const masterKey = this.masterKey;
    return Readable.from((async function* () {
      const unwrap = createDecipheriv("aes-256-gcm", masterKey, row.wrap_nonce);
      unwrap.setAAD(aad(row.id, row.owner_id)); unwrap.setAuthTag(row.wrap_tag);
      let dataKey: Buffer;
      try { dataKey = Buffer.concat([unwrap.update(row.wrapped_data_key), unwrap.final()]); }
      catch (error) { throw new StorageOperationError("unwrap", { cause: error }); }
      const handle = await open(filePath, "r");
      try {
        const header = Buffer.alloc(MAGIC.length);
        if ((await handle.read(header, 0, header.length, 0)).bytesRead !== header.length || !header.equals(MAGIC))
          throw new StorageOperationError("read header");
        let position = MAGIC.length, frame = 0, remaining = Number(row.plaintext_size);
        while (remaining > 0 || frame === 0) {
          const lengthBuffer = Buffer.alloc(4);
          if ((await handle.read(lengthBuffer, 0, 4, position)).bytesRead !== 4) throw new StorageOperationError("read frame");
          position += 4;
          const length = lengthBuffer.readUInt32BE();
          if (length > row.frame_size || length > remaining) throw new StorageOperationError("validate frame");
          const payload = Buffer.allocUnsafe(length + 16);
          if ((await handle.read(payload, 0, payload.length, position)).bytesRead !== payload.length) throw new StorageOperationError("read frame");
          position += payload.length;
          const decipher = createDecipheriv("aes-256-gcm", dataKey, frameNonce(row.nonce_prefix, frame));
          decipher.setAAD(aad(row.id, row.owner_id, frame)); decipher.setAuthTag(payload.subarray(length));
          try { yield Buffer.concat([decipher.update(payload.subarray(0, length)), decipher.final()]); }
          catch (error) { throw new StorageOperationError("authenticate frame", { cause: error }); }
          remaining -= length; frame += 1;
          if (remaining === 0) break;
        }
        if (position !== (await handle.stat()).size) throw new StorageOperationError("validate trailing data");
      } finally { await handle.close(); }
    })());
  }
  async get(fileId: string, user: StorageUser): Promise<Readable | null> {
    const row = await this.row(fileId);
    return row && await this.authorized(row, user) ? this.decrypt(row) : null;
  }
  async getInternal(fileIdOrKey: string): Promise<Readable | null> {
    const row = await this.row(fileIdOrKey); return row ? this.decrypt(row) : null;
  }
  async metadata(fileIdOrKey: string): Promise<StoredFileRow | null> { return this.row(fileIdOrKey); }
  async delete(fileIdOrKey: string): Promise<void> {
    const row = await this.row(fileIdOrKey); if (!row) return;
    await this.db.query("delete from public.stored_files where id = $1", [row.id]);
    await rm(ciphertextPath(this.dataDir, row.id), { force: true });
  }
  async list(prefix: string): Promise<string[]> {
    const result = await this.db.query<{ logical_key: string }>(
      "select logical_key from public.stored_files where left(logical_key, length($1)) = $1 order by logical_key", [prefix]);
    return result.rows.map((row) => row.logical_key);
  }
}

let defaultStorePromise: Promise<EncryptedFilesystemStorage> | null = null;
async function defaultStore(): Promise<EncryptedFilesystemStorage> {
  defaultStorePromise ??= loadOrCreateSecrets().then((secrets) =>
    new EncryptedFilesystemStorage(axerlyDataDir(), Buffer.from(secrets.storageMasterKey, "base64url")));
  return defaultStorePromise;
}
export const storage: Storage = {
  put: async (stream, meta) => (await defaultStore()).put(stream, meta),
  get: async (fileId, user) => (await defaultStore()).get(fileId, user),
  delete: async (fileId) => (await defaultStore()).delete(fileId),
};
export const storageEnabled = true;
export function assertStorageConfigured(): void { /* local storage is intrinsic */ }

function keyMetadata(key: string): PutMetadata {
  const parts = key.split("/");
  const uuid = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i;
  let ownerId = parts.find((part) => uuid.test(part)) ?? SYSTEM_OWNER_ID;
  let resourceKind: PutMetadata["resourceKind"] = ownerId === SYSTEM_OWNER_ID ? "system" : "user";
  let resourceId: string | undefined;
  const possibleDocId = parts[0] === "converted-pdfs" && parts.length === 3
    ? parts[2]?.replace(/\.pdf$/i, "") : parts[2];
  if ((parts[0] === "documents" || parts[0] === "generated" || parts[0] === "converted-pdfs") && uuid.test(possibleDocId ?? "")) {
    ownerId = parts[1]; resourceKind = "document"; resourceId = possibleDocId;
  }
  return { ownerId, logicalKey: key, resourceKind, resourceId };
}
export async function uploadFile(key: string, content: ArrayBuffer, _contentType: string): Promise<void> {
  await storage.put(Readable.from(Buffer.from(content)), keyMetadata(key));
}
export async function uploadFileFromPath(key: string, filePath: string, _contentType: string): Promise<void> {
  await storage.put(createReadStream(filePath), keyMetadata(key));
}
export async function downloadFile(key: string): Promise<ArrayBuffer | null> {
  const stream = await (await defaultStore()).getInternal(key); if (!stream) return null;
  const chunks: Buffer[] = []; for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const result = Buffer.concat(chunks); return result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength);
}
export function createFileReadStream(key: string): Readable {
  return Readable.from((async function* () {
    const source = await (await defaultStore()).getInternal(key);
    if (!source) throw new StorageOperationError("not found");
    for await (const chunk of source) yield chunk;
  })());
}
export async function deleteFile(key: string): Promise<void> { await storage.delete(key); }
export function deleteFileBestEffort(key: string, stage: string): Promise<void | undefined> {
  return bestEffort(deleteFile(key), { what: `storage-delete:${stage}`, tags: { component: "storage", stage } });
}
export async function copyFile(sourceKey: string, targetKey: string): Promise<void> {
  const source = await (await defaultStore()).getInternal(sourceKey);
  if (!source) throw new StorageOperationError("copy source missing");
  await storage.put(source, keyMetadata(targetKey));
}
export async function listFiles(prefix: string): Promise<string[]> { return (await defaultStore()).list(prefix); }
export async function headFile(key: string): Promise<{ size: number; etag: string; contentType: null } | null> {
  const row = await (await defaultStore()).metadata(key);
  return row ? { size: Number(row.plaintext_size), etag: row.plaintext_sha256, contentType: null } : null;
}
export function normalizeDownloadFilename(name: string): string {
  return (name.trim() || "download").replace(/[\x00-\x1F\x7F]/g, "_").replace(/[\\/]/g, "_");
}
export function sanitizeDispositionFilename(name: string): string {
  return normalizeDownloadFilename(name).replace(/["\\]/g, "_").replace(/[^\x20-\x7E]/g, "_");
}
export function encodeRFC5987(value: string): string {
  return encodeURIComponent(value).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}
export function buildContentDisposition(kind: "inline" | "attachment", filename: string): string {
  const normalized = normalizeDownloadFilename(filename);
  return `${kind}; filename="${sanitizeDispositionFilename(normalized)}"; filename*=UTF-8''${encodeRFC5987(normalized)}`;
}
function storageExtension(filename: string, fallback: string): string {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot < 0) return fallback;
  const ext = filename.slice(lastDot).toLowerCase();
  return /^\.[a-z0-9]{1,16}$/.test(ext) ? ext : fallback;
}
export function storageKey(userId: string, docId: string, filename: string): string {
  return `documents/${userId}/${docId}/source${storageExtension(filename, ".bin")}`;
}
export function pdfStorageKey(userId: string, docId: string, stem: string): string {
  return `documents/${userId}/${docId}/${stem}.pdf`;
}
export function generatedDocKey(userId: string, docId: string, filename: string): string {
  return `generated/${userId}/${docId}/generated${storageExtension(filename, ".docx")}`;
}
export function versionStorageKey(userId: string, docId: string, versionSlug: string, filename: string): string {
  return `documents/${userId}/${docId}/versions/${versionSlug}${storageExtension(filename, ".bin")}`;
}
export function extractedTextKey(versionId: string): string { return `extracted-text/${versionId}.txt`; }
export async function withStorageTempDir<T>(fn: (directory: string) => Promise<T>): Promise<T> {
  const directory = path.join(axerlyDataDir(), "tmp", randomUUID());
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try { return await fn(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}
export async function sweepStorageTempFiles(): Promise<void> {
  const directory = path.join(axerlyDataDir(), "tmp");
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true, mode: 0o700 });
}

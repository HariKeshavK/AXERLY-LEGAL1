// AXERLY modified 2026-09-23; AXERLY modified 2026-09-24.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface AxerlySecrets {
  postgresPassword: string;
  sessionSecret: string;
  storageMasterKey: string;
  storageRecoveryKeyPending: boolean;
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

const SECRET_FILE_VERSION = 2;
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

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
    record.sessionSecret.length >= 43 &&
    typeof record.storageMasterKey === "string" &&
    Buffer.from(record.storageMasterKey, "base64url").length === 32 &&
    typeof record.storageRecoveryKeyPending === "boolean"
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
      if (parsed.version === 1 && parsed.secrets && typeof parsed.secrets === "object") {
        const previous = parsed.secrets as Record<string, unknown>;
        if (typeof previous.postgresPassword !== "string" || previous.postgresPassword.length < 32 ||
            typeof previous.sessionSecret !== "string" || previous.sessionSecret.length < 43) {
          throw new Error("AXERLY secrets file has an unsupported format");
        }
        const upgraded: AxerlySecrets = {
          postgresPassword: previous.postgresPassword,
          sessionSecret: previous.sessionSecret,
          storageMasterKey: randomBytes(32).toString("base64url"),
          storageRecoveryKeyPending: true,
        };
        await this.save(upgraded);
        return upgraded;
      }
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
    storageMasterKey: randomBytes(32).toString("base64url"),
    storageRecoveryKeyPending: true,
  };
}

function base32Encode(input: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of input) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(input: string): Buffer {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of input) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) throw new Error("Invalid AXERLY recovery key");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** Human-copyable recovery representation of the storage master key. */
export function encodeStorageRecoveryKey(masterKey: Buffer): string {
  if (masterKey.length !== 32) throw new Error("Storage master key must be 32 bytes");
  const checksum = createHash("sha256").update(masterKey).digest().subarray(0, 4);
  const encoded = base32Encode(Buffer.concat([masterKey, checksum]));
  return `AXERLY-${encoded.match(/.{1,4}/g)!.join("-")}`;
}

export function decodeStorageRecoveryKey(value: string): Buffer {
  const compact = value.trim().toUpperCase().replace(/^AXERLY-/, "").replaceAll("-", "");
  const decoded = base32Decode(compact);
  if (decoded.length !== 36) throw new Error("Invalid AXERLY recovery key");
  const masterKey = decoded.subarray(0, 32);
  const expected = createHash("sha256").update(masterKey).digest().subarray(0, 4);
  if (!timingSafeEqual(decoded.subarray(32), expected)) {
    throw new Error("Invalid AXERLY recovery key checksum");
  }
  return Buffer.from(masterKey);
}

export async function consumeStorageRecoveryKey(
  store: SecretsStore = new FileSecretsStore(),
): Promise<string | null> {
  const secrets = await loadOrCreateSecrets(store);
  if (!secrets.storageRecoveryKeyPending) return null;
  const recoveryKey = encodeStorageRecoveryKey(Buffer.from(secrets.storageMasterKey, "base64url"));
  await store.save({ ...secrets, storageRecoveryKeyPending: false });
  return recoveryKey;
}

/** Leave the key pending until the administrator confirms safe storage. */
export async function pendingStorageRecoveryKey(
  store: SecretsStore = new FileSecretsStore(),
): Promise<string | null> {
  const secrets = await loadOrCreateSecrets(store);
  return secrets.storageRecoveryKeyPending
    ? encodeStorageRecoveryKey(Buffer.from(secrets.storageMasterKey, "base64url")) : null;
}

export async function acknowledgeStorageRecoveryKey(
  store: SecretsStore = new FileSecretsStore(),
): Promise<void> {
  const secrets = await loadOrCreateSecrets(store);
  if (secrets.storageRecoveryKeyPending) {
    await store.save({ ...secrets, storageRecoveryKeyPending: false });
  }
}

export async function restoreStorageMasterKey(
  recoveryKey: string,
  store: SecretsStore = new FileSecretsStore(),
): Promise<void> {
  const secrets = await loadOrCreateSecrets(store);
  const masterKey = decodeStorageRecoveryKey(recoveryKey);
  await store.save({
    ...secrets,
    storageMasterKey: masterKey.toString("base64url"),
    storageRecoveryKeyPending: false,
  });
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

// AXERLY modified 2026-09-24.
import type { Readable } from "node:stream";
import { storage, type StorageUser } from "../../lib/storage";

/** File reads enter through the central storage authorization boundary. */
export function openFileForUser(fileId: string, user: StorageUser): Promise<Readable | null> {
  return storage.get(fileId, user);
}

# P4 — Encrypted host filesystem storage

Date: 2026-09-24

## Outcome

The application no longer uses RustFS, Cloudflare R2, S3 API calls, Supabase Storage, browser-direct object uploads, or presigned object URLs for live file paths. Uploads enter the authenticated API and ciphertext lives at `%APPDATA%\AXERLY\files\<first-two-id-characters>\<file-id>.enc` (or under `AXERLY_DATA_DIR`). Original names and media types remain in application database records, not filesystem paths. The new `Storage` interface offers `put(stream, meta)`, authorized streaming `get(fileId, user)`, and `delete(fileId)`. Older domain callers use compatibility helpers behind that one interface.

Each file has a random 256-bit data key. AES-256-GCM encrypts independent bounded frames with file ID, owner ID, and frame number as associated data. A randomly generated master key wraps the data key with AES-256-GCM; wrapping parameters and size/hash metadata live in PostgreSQL `stored_files`. Any altered frame fails authentication. Encrypted temporary staging and processing files are under `AXERLY_DATA_DIR/tmp` and swept on startup. The existing production processing code still sometimes loads decrypted bytes in memory, but does not persist them unencrypted.

`GET /api/files/:id` (backend `/files/:id`) requires a session and central authorization, returns 404 for unavailable resources, and sets `Cache-Control: private, no-store` and `X-Content-Type-Options: nosniff`. Existing document download URLs resolve to same-origin API endpoints. Browser and Word add-in uploads now PUT to authenticated `/api/upload-sessions/:sessionId/files/:fileId` with CSRF protection; the upload limit is 256 MiB.

The first administrator sees a base32 recovery key with a SHA-256 checksum after login and must acknowledge saving it before proceeding. It remains retrievable only by that administrator until acknowledgment, then is no longer shown. `npm run restore:storage-key` in `backend/` reads the key from standard input (hidden when interactive), verifies it against an existing wrapped data key where one exists, then restores the master key. Do not put the key in command arguments, environment variables, logs, or the repository. P13 must replace the current file-backed secrets store with Electron `safeStorage`.

## Files touched

- Storage, crypto, key management, and migration: `backend/src/lib/storage.ts`, `backend/src/config/secrets.ts`, `backend/src/db/runtime.ts`, `backend/src/db/restoreStorageKey.ts`, `backend/db/migrations/0003_encrypted_file_store.sql`, `backend/package.json`, `backend/package-lock.json`.
- File and download API: `backend/src/modules/files/*`, `backend/src/modules/documents/documents.download.ts`, `backend/src/modules/downloads/*`, `backend/src/lib/downloadTokens.ts`, `backend/src/app.ts`.
- Upload and processing path: `backend/src/modules/uploads/*`, `backend/src/lib/workflowCatalogSource.ts`, `backend/src/lib/workflowCatalogSync.ts`.
- Frontend and add-in transport/recovery UI: `frontend/src/shared/api/uploadSessionClient.ts`, `frontend/src/app/lib/{authApi,mikeApi}.ts`, `frontend/src/app/login/page.tsx`, `word-addin/src/taskpane/api/client.ts`.
- Deployment cleanup: `docker-compose.yml`, `docker/storage-cors.json` (removed), `backend/.env.example`, `frontend/package.json`, `frontend/package-lock.json`, `frontend/bun.lock`.
- Focused storage, route, upload, download-token, and login tests were added or updated; obsolete S3-presigning tests were removed.

## Verification

- Backend build and test typecheck passed.
- Frontend typecheck passed; lint had 0 errors and 29 pre-existing warnings.
- Backend: 2,225 passed, 2 failed on the final full run (pre-existing Windows fixture failures in `convertTimeout.test.ts` and `pdfText.integration.test.ts`). The focused storage/file-route rerun passed 10 tests.
- Frontend: 1,567 passed.
- Storage tests exercise PDF/DOCX/image round-trip, absence of a known plaintext marker on disk, unauthorized 404/null, tamper detection, recovery-key checksum/restore, and 200 MiB streaming with less than 96 MiB RSS growth.
- Authenticated file-route tests cover 404 and response security headers.

## Open issues and limitations

- Historical R2 objects are **not migrated** into the local encrypted store. Existing rows that reference old object keys need a separately authorized import/migration before the new host can read those files. Old signed download links are invalidated by the new opaque-key token format.
- Extracted-text cache is now an encrypted storage object (`extracted-text/<version>.txt`), not plaintext in PostgreSQL. No persisted embeddings table or pgvector usage was found in the current schema. PostgreSQL still stores document metadata, user-entered text such as chat/project content, and file sizes/SHA-256 digests unencrypted. If embeddings are added later, they require a separate encryption/privacy decision. Database backups therefore need protection independently of file encryption.
- The file-backed master key is currently in `config/secrets.json` under the data directory (mode 0600 where supported). The recovery key cannot repair loss of PostgreSQL credentials. P13 `safeStorage` integration and backup/restore UX remain necessary.
- The repository still contains legacy Docker/Redis/Mailpit/Next.js deployment paths and non-storage external-service code; these are outside P4. No Windows `.exe` is delivered by this prompt.
- Office/PDF conversion still needs its Windows runtime binaries packaged for the final installer. The existing Windows fixture failures remain.

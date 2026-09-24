# P2 — Direct PostgreSQL, startup migrations, and machine secrets

Date: 2026-09-24

## Outcome

The upstream repository and its full Git history were imported into AXERLY. The root AGPL-3.0 `LICENSE` is byte-identical to upstream and was not edited.

The backend no longer depends on the Supabase SDK, GoTrue, PostgREST, `auth.users`, `auth.uid()`, or browser database credentials. It starts either the bundled Windows x64 PostgreSQL distribution or an explicitly configured external PostgreSQL instance, runs checksum-protected migrations before opening the HTTP listener, and connects application traffic through the non-superuser `axerly_app` role.

## Authorization decision

RLS was removed for this phase. The assessment found that upstream's effective application path used a privileged service role that bypassed RLS, while much of the schema merely enabled RLS without a complete policy set. Keeping it would therefore require designing and validating a new policy system rather than retaining an existing defense cheaply.

Authorization is enforced by backend policy functions exported through the single `backend/src/lib/authz.ts` boundary. An architecture fitness test prevents production consumers from importing the underlying access modules directly. Database triggers that enforce structural invariants remain, and the application role is non-superuser and receives only schema/table/sequence/function privileges needed by the backend.

## What changed

- Added direct PostgreSQL access in `backend/src/lib/database.ts` using `pg`, including a compatibility query facade and direct SQL-function calls for the existing service layer.
- Added local password/session authentication in `backend/src/lib/localAuth.ts`: lowercased unique email, salted scrypt password hashes, opaque random session tokens, HMAC token hashes, revocation, expiry, and disabled-user checks.
- Added request-bound HttpOnly cookie handling in `backend/src/lib/authSession.ts`.
- Added `backend/src/lib/authz.ts` and routed production authorization imports through it.
- Replaced PostgREST relationship selects in MCP tool discovery with explicit server-side queries.
- Added `backend/src/db/migrations.ts`: ordered versions, SHA-256 checksum drift detection, one transaction per migration, advisory locking, and startup grants for `axerly_app`.
- Added `backend/src/db/runtime.ts`, and made API, worker, and workflow-sync startup prepare the database before use.
- Added `backend/src/db/embedded.ts`: bundled Windows x64 binaries, no runtime download, first-run `initdb`, SCRAM-SHA-256, loopback-only random port, stale PID handling, file logging, health checks, and fast shutdown.
- Added `backend/src/config/secrets.ts` with a `SecretsStore` interface, atomic first-run generation, and a file implementation under `AXERLY_DATA_DIR`. This boundary is ready for Electron `safeStorage` in P13.
- Added `npm run dev:db` and `npm run verify:db` at the backend, plus root `npm run dev:db`.
- Converted the cumulative schema and legacy SQL references from `auth.users` to `public.users`, removed `auth.uid()`/RLS dependencies, and added `users` plus `auth_sessions`.
- Removed Supabase runtime packages, local Supabase configuration, the obsolete Supabase stack harness, and Supabase-only integration tests.
- Replaced Supabase-dependent CI stack/schema jobs with Windows jobs that exercise the actual bundled PostgreSQL build. The former Docker/Supabase/RustFS E2E workflow is temporarily a build/typecheck/database integration gate until host-disk storage is implemented.
- Sanitized `.env.example` files to contain variable names only; generated credentials are never committed.

## Principal files touched

- `backend/src/config/secrets.ts`
- `backend/src/db/{embedded,migrations,runtime,dev,verify}.ts`
- `backend/src/lib/{database,localAuth,authSession,authz}.ts`
- `backend/src/{index,worker}.ts`
- `backend/src/jobs/syncWorkflows.ts`
- `backend/schema.sql`
- `backend/db/migrations/README.md`
- `backend/package.json`, `backend/package-lock.json`, root `package.json`
- Backend feature modules importing the database/authz boundaries
- `.github/workflows/{stack-tests,schema-drift,e2e}.yml`
- `.env.example`, `backend/.env.example`

The imported upstream tree is also part of this branch. Historical Supabase-only tests and local-stack configuration removed here remain recoverable from the imported upstream Git history.

## Tests added

- `backend/src/config/secrets.test.ts`: generation entropy and create-once storage behavior.
- `backend/src/lib/database.test.ts`: identifier rejection, parameterized filters, correct placeholder numbering, and rejection of unsupported relationship syntax.
- `backend/src/lib/localAuth.test.ts`: salted scrypt hashing, verification, mismatch, and malformed-hash behavior.
- `backend/src/__tests__/architecture.test.ts`: central-authz import boundary.
- `backend/src/db/verify.ts`: real bundled PostgreSQL startup, migration idempotence, application-role login, required `users` columns, and extension loading.

## Verification

- Backend build: passed.
- Backend test typecheck: passed.
- Focused new tests: 6 passed.
- Frontend typecheck: passed.
- Bundled PostgreSQL smoke test on Windows x64: passed. PostgreSQL 17.9 started on `127.0.0.1` at a random port; migration `0001` remained single after two runs; `pgcrypto` and `pg_trgm` loaded; required `users` columns were present; `axerly_app` connected successfully.
- `pgvector` is not required by the current schema. No `vector` extension or vector column exists.
- Full backend suite: 2,234 passed, 9 skipped; two unrelated Windows/tooling tests failed (`convertTimeout.test.ts` cannot execute its extensionless fake `soffice` file on Windows, and `pdfText.integration.test.ts` returned no PDF text in this environment). Three unrelated dynamic-import suites timed out under the highly parallel Windows run. These failures predate and do not exercise the database migration.
- Root `LICENSE`: Git object hash matches `upstream/main:LICENSE` (`be3f7b28e564e7dd05eaf59d64adba1a4065ac0e`).

## Open issues

- The existing S3/R2 storage layer remains until the encrypted host-disk storage prompt; it contradicts the locked architecture today.
- OAuth, SSO, MFA enrollment, and outbound reset-password delivery return explicit unavailable/no-op results in local auth. They require product decisions or later implementation; login, signup, session validation, logout, email/password changes, and administrative invalidation are local.
- The direct database facade intentionally preserves the old fluent call shape to keep this migration bounded. Domain repositories with generated row types should replace it incrementally.
- The cumulative `schema.sql` is migration `0001`; future changes must be added only as `backend/db/migrations/NNNN_name.sql`. The imported historical `backend/migrations` directory is not executed by the AXERLY runner.
- True browser E2E coverage should be restored after encrypted host-disk storage replaces S3/R2; current CI keeps build, type, and real database startup coverage without the prohibited services.

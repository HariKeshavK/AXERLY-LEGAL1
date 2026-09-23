# AXERLY upstream assessment

Date: 2026-09-23

Scope: read-only review of `Open-Legal-Products/mike` at commit `4ad85e463ea769809c9e177fbe7a84548c71d546` (2026-09-22). The upstream repository was cloned to a temporary directory for this assessment; no upstream source was copied into AXERLY and no application code was changed. Paths below are upstream-relative unless prefixed with `AXERLY/`.

## 1. Supabase footprint

### Concrete inventory

The browser does **not** instantiate a Supabase client. It calls same-origin `/api`; the Next route handler proxies that to the Express backend (`frontend/src/app/lib/mikeApi.ts:1-4,89-99`; `frontend/src/app/api/[...path]/route.ts:8-15,51`). Supabase is concentrated in the backend:

- Client construction: the service-role database client is created in `backend/src/lib/supabase.ts:1-38`; the cookie-backed user-session client is created with `@supabase/ssr` in `backend/src/lib/authSession.ts:1-8,97-113`.
- Authentication: password sign-in, signup, OAuth, SSO, code exchange, session refresh, reset, user lookup, logout, email change, and password change are Supabase Auth calls in `backend/src/modules/auth/auth.service.ts:103-203`. Middleware validates the Supabase user/session in `backend/src/middleware/auth.ts:120-146,232-248`.
- Database: application reads and writes use `@supabase/supabase-js` as a PostgREST query builder, not a direct PostgreSQL driver (`backend/src/lib/supabase.ts:1-38`). Production query call sites are in the following files:

  - Shared infrastructure: `backend/src/lib/{access,audit,auditExport,authHandoff,concurrency,contentAccess,courtlistener,documentDisplay,documentVersions,docxTrackedChanges,downloadTokens,manifestSigning,orgAccessOverrides,orgs,pdfText,projectAccess,resourceAccessSummary,resourcePeople,routerModels,storage,userLookup,workflowCatalog,workflowCatalogSync}.ts`; `backend/src/lib/dbq/{enqueue,lifecycleGuard,runner}.ts`; `backend/src/lib/mcp/{client,oauth,servers}.ts`; `backend/src/lib/memory/{archive,bulk,files,schedule}.ts`; `backend/src/lib/queue/extractionQueue.ts`.
  - Request middleware and workers: `backend/src/middleware/auth.ts`, `backend/src/workerRuntime.ts`, and `backend/src/workers/appJobsWorker.ts`.
  - Feature modules: `backend/src/modules/chat/{chat.access,chat.crud,chat.messages,chat.prepare,chat.settings,chat.sharing,chat.titles}.ts`; `backend/src/modules/chat/engine/{contextBuilders,routeStreaming,wordDocumentEdits}.ts`; `backend/src/modules/chat/engine/tools/{courtlistenerTurnState,documentOps,toolDispatcher}.ts`; every production service file under `backend/src/modules/documents`; `backend/src/modules/downloads/downloads.service.ts`; `backend/src/modules/library/{library.routes,library.service}.ts`; `backend/src/modules/memory/memory.curator.ts`; `backend/src/modules/project-chat/projectChat.service.ts`; every production service file under `backend/src/modules/projects`, `tabular`, `uploads`, `user`, and `workflows`; plus `backend/src/modules/quick-actions/quickActions.service.ts` and `backend/src/modules/word-chat/wordChat.service.ts`.
- RPCs: application logic relies on PostgreSQL functions through `.rpc()`. The set found is `activate_document_version`, `append_chat_ask_inputs_response`, `append_chat_assistant_events`, `begin_memory_conversation_turn`, `claim_db_job`, `claim_db_jobs`, `claim_upload_processing_job`, `create_document_version`, `create_document_versions`, `create_project_with_memory`, `create_upload_session`, `delete_document_version`, `delete_user_private_memories`, `document_cache_writer_active`, `document_lifecycle_version`, `enable_memory_file`, `extend_upload_session_expiry`, `finish_tabular_review_generation`, `get_chats_overview`, `get_library_document_ids`, `get_library_filter_options`, `get_project_filter_options`, `get_project_ids_overview`, `get_project_summaries`, `get_projects_overview`, `get_workflow_filter_options`, `get_workflow_ids_overview`, `get_workflows_overview`, `install_missing_default_workflows`, `queue_upload_session_file_processing`, `refresh_upload_session_status`, `release_memory_conversation_turn`, `renew_tabular_review_generation`, `replace_mike_workflows`, `replace_user_router_models`, `resolve_library_folder_path`, `resolve_project_folder_path`, `schedule_memory_consolidation`, `search_library_documents`, `set_memory_consolidation_status`, `wipe_memory_file`, and `write_memory_file`. Representative callers are `backend/src/modules/library/library.service.ts:206-215,277-302,401`, `backend/src/modules/projects/projects.crud.ts:88,168,392,461,519`, `backend/src/modules/chat/chat.crud.ts:40`, `backend/src/modules/documents/documents.lifecycle.ts:41-66`, `backend/src/modules/uploads/uploads.sessions.ts:203-233,365`, `backend/src/modules/uploads/uploads.processing.ts:684,1085`, and `backend/src/modules/memory/memory.curator.ts:896,940`.
- Auth schema: `public.user_profiles` and many ownership/audit columns reference `auth.users`; profile creation and email-change triggers attach directly to that table (`backend/schema.sql:15,115-168`). The last-organization-admin trigger probes `auth.users` to distinguish account deletion (`backend/schema.sql:238-290`), password-capability logic reads its encrypted-password field (`backend/schema.sql:120-148`), and memory-file creation has another signup trigger (`backend/schema.sql:4819-4842`). Further `auth.users` foreign keys occur throughout `backend/schema.sql:178-1837,1956-2842,4582-4765`, and memory authorization functions read it at `backend/schema.sql:4905-4961`. There is **no** `auth.uid()` occurrence.
- RLS: 31 tables have RLS enabled in the fresh schema, including auth handoff, organizations, grants, uploads, Word data, tabular rows, audit/jobs, and memory (`backend/schema.sql:193-236,328-613,914-916,1045,1630,1849,2212-2215,2292-2494,2878-2894,4597-4813`). The fresh schema creates no policies. Migration `backend/migrations/20260606_oss_schema_diff.sql:29-31,169-189` only drops old policies. Runtime uses the service-role client and application checks; grants to `anon`/`authenticated` are revoked and `service_role` receives access (`backend/schema.sql:6583-6600`; `backend/migrations/20260917_01_organization_access_followup.sql:68-81`). RLS is therefore a deny-by-default backstop, not current tenant policy enforcement.
- Supabase Storage: none. Realtime: none. Edge Functions: none. No `.storage`, `.channel`, Realtime subscription, or `functions.invoke` call was found. Object storage is AWS S3-compatible code (section 2).
- Local Supabase services are GoTrue, PostgREST, a Supabase PostgreSQL image, and an Nginx gateway (`docker-compose.yml:11-120`).

### Replacement map

| Supabase feature | Direct-Postgres / own-auth replacement | Effort and risk |
|---|---|---|
| GoTrue password users, OAuth, reset, email change, MFA and SSO | `app_users` with Argon2id password hashes; random opaque server-side sessions stored hashed; explicit reset/enrolment tokens; Electron/LAN-safe invitation flow | **High.** Authentication, account deletion, password capability, OAuth/SSO, Word handoff, and every `auth.users` FK change together. Security-critical. |
| `@supabase/ssr` cookie/session handling | Express-owned `HttpOnly`, `Secure`, `SameSite` session cookie; CSRF/origin enforcement; session rotation and revocation | **High.** Must work for LAN HTTPS, Electron host/client, and Word add-in without exposing bearer tokens. |
| PostgREST `.from()` query builder | Direct `pg` pool plus typed repository functions and parameterized SQL | **High/broad.** Nearly every backend feature file is affected. Introduce one compatibility repository boundary first rather than rewriting routes independently. |
| `.rpc()` functions | Keep transactional PL/pgSQL and invoke with parameterized `SELECT public.fn(...)`, then selectively move simple functions into repositories | **Medium-high.** Functions encode locking, leases, pagination, cleanup, and lifecycle invariants; a mechanical rewrite is unsafe. |
| `auth.users` FKs and triggers | Point all identity FKs/triggers at `public.app_users`; migrate signup/profile/email hooks into transactions | **High.** More than forty schema references plus migrations and deletion behavior. |
| Supabase roles/grants and policy-free RLS | Remove `anon/authenticated/service_role`; run with a least-privilege application role. Either retain RLS with transaction-local identity or rely on the required central `authz` plus SQL ownership constraints | **Medium.** AXERLY's locked design requires central server authz; retaining correctly parameterized RLS is optional defense-in-depth, not a substitute. |
| Storage, Realtime, Edge Functions | No replacement needed because upstream does not use them | **None.** S3/RustFS replacement is separate. |

## 2. File storage

`backend/src/lib/storage.ts:1-80` constructs an AWS SDK S3 client. `R2_ENDPOINT_URL`, access/secret keys, and bucket (`mike` by default) make it work with Cloudflare R2 or RustFS. Operations are upload (`:108-148`), presigned PUT (`:156-177`), HEAD/copy (`:197-243`), download/stream/list (`:249-315`), delete, and presigned GET (`:321-368`). There is no Supabase Storage code.

### Object keys

| Object | Key format | Evidence |
|---|---|---|
| Source document | `documents/{userId}/{documentId}/source.{ext}` | `backend/src/lib/storage.ts:409-415` |
| PDF rendition | `documents/{userId}/{documentId}/{stem}.pdf` | `backend/src/lib/storage.ts:417-423` |
| Generated document | `generated/{userId}/{documentId}/generated.{ext}` | `backend/src/lib/storage.ts:425-431` |
| Version | `documents/{userId}/{documentId}/versions/{slug}.{ext}` | `backend/src/lib/storage.ts:433-440` |
| Extracted text | `extracted-text/{versionId}.txt` | `backend/src/lib/storage.ts:448-450` |
| Upload staging/sealed file | `upload-sessions/{userId}/{sessionId}/{fileId}/{staging|sealed}` | `backend/src/modules/uploads/uploads.manifest.ts:223-237` |
| Converted PDF | `converted-pdfs/{userId}/{documentId}/{versionSlug}.pdf` | `backend/src/modules/uploads/uploads.processing.ts:171-191`; `backend/src/lib/convert.ts:225-227` |
| Chat-created edit | `documents/{userId}/{documentId}/edits/{versionId}.docx` | `backend/src/modules/chat/engine/tools/documentOps.ts:1200` |
| User export | `exports/{userId}/{jobId}-{filename}` | `backend/src/modules/user/user.exportJobs.ts:191` |

The user ID remains embedded in keys even for organization-owned/project-inherited objects. Treat it as a historical namespace, not an authorization boundary.

### Complete production call-site inventory

- Storage primitives and document display: `backend/src/lib/storage.ts:108-368`, `backend/src/lib/documentDisplay.ts:81-99`, `backend/src/lib/courtlistener.ts:808-825`, and `backend/src/lib/workflowCatalogSync.ts:61`.
- Download service: `backend/src/modules/downloads/downloads.service.ts:55`.
- Document modules: `documents.versions.ts:175,189,223`; `documents.textJobs.ts:52,59,69-70`; `documents.routes.ts:139,195`; `documents.edits.ts:37,143,239`; `documents.download.ts:330,396,446`; `documents.copyFiles.ts:32-48`; `documents.conversion.ts:34,63`; `documents.cleanupJobs.ts:203,279,369`.
- Uploads: `uploads.sessions.ts:95,148,158,181-186`; `uploads.processing.ts:190,273,368,402-403,486-492,569-575,713`; manifest key construction in `uploads.manifest.ts:223-237`.
- Projects/workflows/tabular: `projects.documents.ts:216,235`; `workflows.assets.ts:185`; `workflows.addons.ts:258-278`; `tabular.rows.ts:121`.
- User export/deletion: `user.accountJobs.ts:67`; `user.dataExport.ts:248`; `user.dataCleanup.ts:498-542`; `user.exportJobs.ts:126,193`.
- Jobs: `backend/src/lib/dbq/{storageCleanup,runner,enqueue}.ts` (cleanup queue production/consumption).
- Chat tools: `documentOps.ts:922-946,1097,1192-1201,1491,1566-1568`; `toolDispatcher.ts:1583-1662`.

### Presigned URLs and direct browser access

- Upload is browser-to-object-store. The frontend creates/refreshes an upload session, then uses raw `fetch` to PUT each file to a presigned URL (`frontend/src/shared/api/uploadSessionClient.ts:139-168,365-405,438-490`; fetch injection in `frontend/src/app/lib/mikeApi.ts:188-207`).
- The Word add-in reuses that same upload core and also PUTs directly to presigned storage URLs (`word-addin/src/taskpane/api/client.ts:229-254,332,589-604`).
- Normal downloads can be browser-to-object-store. The backend returns a one-hour signed GET URL (`backend/src/modules/documents/documents.download.ts:372-411`; route `backend/src/modules/documents/documents.routes.ts:222-245`). The browser navigates to it from `frontend/src/app/components/documents/DocTable.tsx:537-539,3056-3058`, `frontend/src/app/components/workflows/WorkflowAssets.tsx:257-259`, and `frontend/src/app/hooks/useExplorerDownload.ts:27-36`.
- The Word add-in also requests `/single-documents/{id}/url` and opens the returned storage URL externally (`word-addin/src/taskpane/api/client.ts:614-619`; `word-addin/src/taskpane/components/workflows/WorkflowAssets.tsx:156-171`).
- Viewer bytes do go through authenticated Express routes: `/file` and `/display` check access and stream data (`backend/src/modules/documents/documents.routes.ts:108-148`; `frontend/src/app/hooks/useFetchDocxBytes.ts:60-88`; `frontend/src/app/hooks/useFetchSingleDoc.ts:52-79`). ZIP downloads also stream through the backend.

This conflicts with AXERLY: direct presigned PUT/GET bypasses the required authenticated API byte path, RustFS is forbidden, and objects are not AES-256-GCM envelope-encrypted on local disk.

## 3. Database

- Extensions: only `pgcrypto` and `pg_trgm` (`backend/schema.sql:6-7,3175`). There is no `vector` extension, vector column, pgvector dependency, or embedding call.
- Fresh install: monolithic `backend/schema.sql`.
- Incremental migration tooling: ordered SQL files under `backend/migrations/`; Docker `db-init` runs `psql` and selected migrations through a Bash entrypoint (`docker-compose.yml:123-201`). There is no Prisma, Drizzle, Sequelize, TypeORM, Knex, or migration framework.
- Data access: Supabase/PostgREST query builder and SQL functions, not an ORM (`backend/src/lib/supabase.ts:1-38`).

`pgcrypto`, `pg_trgm`, PL/pgSQL, advisory locks, `SKIP LOCKED`, triggers, and the schema's ordinary SQL can run on a bundled Windows x64 PostgreSQL distribution. It cannot run **unchanged** on plain PostgreSQL: it expects the Supabase `auth` schema, `auth.users`, and roles `anon`, `authenticated`, and `service_role` (`backend/schema.sql:15,115-168,6583-6600`). The migration runner is also Bash/Compose-specific. AXERLY needs a Windows-native migration runner, direct `pg` connectivity, app-owned identity tables, and packaging of the two contrib extensions. No pgvector binary is needed today.

## 4. Organization model

The current organization is a tenant/workspace, not a lightweight permission group. The schema explicitly describes organization membership as the source of inherited access (`backend/schema.sql:195-205`).

- `organizations`: ID, name, normalized name, creator, timestamps (`backend/schema.sql:208-216`).
- `org_members`: organization/user pair and `admin|member` role, with uniqueness and last-admin protection (`backend/schema.sql:222-290`).
- `org_invitations`: organization, normalized email, role, inviter, status, expiry (`backend/schema.sql:292-328`).
- Tenant FKs: `projects.org_id` (`backend/schema.sql:536-562`), `documents.org_id` (`:696-724`), `workflows.org_id` (`:972-990`), `chats.org_id` (`:1801-1829`), and `tabular_reviews.org_id` (`:2238-2267`). Project grants/overrides are at `:575-613`; workflow overrides at `:1027-1045`.
- Triggers synchronize a child document/chat/review's organization with its project and clean invalid grants when ownership changes (`backend/schema.sql:6414-6503,6512-6542`).
- Central access logic maps organization admin to owner and member to editor, then applies resource-specific `owner|editor|viewer|deny` overrides (`backend/src/lib/access.ts:45-110,195-246`; SQL helper `backend/schema.sql:615-660`).

**Answer:** do not turn Organization into Team. In AXERLY, keep exactly one organization as the firm/tenant and rename the internal column to `firm_id` only if worthwhile after migration. Add Team as a separate membership and share principal. A direct Organization→Team rename would break resource lifetime, invitations, inherited access, ethical-wall denies, account deletion, cleanup triggers, and every overview/search RPC. The UI may hide tenant terminology after first launch, but the tenant boundary remains load-bearing.

## 5. Sharing

| Resource | Who can see it now | Evidence | AXERLY extension |
|---|---|---|---|
| Library document (a document with no project) | Owner only. Queries require `user_id = caller` and `project_id IS NULL`; there is no library ACL or org-wide grant. | `backend/src/modules/library/library.service.ts:1-7,37-50,98-137,171-194`; `backend/src/modules/documents/documents.access.ts:67-90`; folder ownership `backend/schema.sql:678-694` | Add document/folder grants whose principal can be user or team. Preserve personal ownership; optionally define a separate firm-wide Library policy. |
| Personal project | Creator plus email-based `project_access_grants` with `owner|editor|viewer`. | `backend/schema.sql:564-593`; `backend/src/lib/access.ts:195-246` | Add team principal grants alongside existing user/email grants. |
| Organization project | Every org member inherits access: admin→owner, member→editor. Per-resource override can grant owner/editor/viewer or explicit deny. | `backend/schema.sql:596-660`; `backend/src/lib/access.ts:195-246` | Preserve firm inheritance and ethical-wall deny; layer team grants/denies into the same effective-role calculation. |
| Project document/chat/tabular review | Inherits the containing project's effective role. | `backend/src/modules/documents/documents.access.ts:35-60`; `backend/src/modules/chat/chat.access.ts:71-100`; `backend/src/lib/resourcePeople.ts:28-60` | Team sharing belongs at the project grant layer; do not create inconsistent child ACLs. |
| Standalone chat or tabular review | Creator plus direct normalized-email ACL rows. | `backend/src/lib/contentAccess.ts:1-28,45-103`; `backend/schema.sql:1831-1849,2272-2292` | Extend ACL principal type to team while retaining direct-user sharing. |
| Workflow | Personal workflow uses direct `workflow_shares`; org workflow uses membership plus org overrides. | `backend/schema.sql:993-1045`; `backend/src/modules/workflows/workflows.access.ts:12-31` | Add team grants; do not replace direct shares or firm inheritance. |

Team sharing therefore extends three existing layers—direct-user grants, firm inheritance, and resource overrides. It must not replace any of them. Library sharing is new functionality because upstream Library is private.

## 6. Model call sites and keys

All provider traffic ultimately reaches AI SDK calls in `backend/src/lib/llm/aiSdk.ts:405` (`streamText`) or `:550-551` (`generateText`). Provider adapters are Anthropic (`backend/src/lib/llm/providers.ts:126-135`), OpenRouter (`:151-164`), OpenCode/OpenAI-compatible (`:193-229`), Google (`:280-303`), OpenAI (`:310-312`), and Ollama (`:346-347`); exported streaming/completion gates are at `:362-440`.

Every production model-purpose call found:

| Purpose | Call site |
|---|---|
| Standard chat | `backend/src/modules/chat/chat.routes.ts:634` |
| Project chat | `backend/src/modules/project-chat/projectChat.routes.ts:209` |
| Word add-in chat | `backend/src/modules/word-chat/wordChat.routes.ts:662` |
| Tabular-review chat | `backend/src/modules/tabular/tabular.routes.ts:750` |
| Chat title generation | `backend/src/modules/chat/chat.title.ts:14-25` |
| Per-cell tabular extraction | `backend/src/modules/tabular/tabular.extract.ts:25-56` |
| Tabular chat/title extraction | `backend/src/modules/tabular/tabular.extract.ts:91-115` |
| Tabular column-prompt drafting | `backend/src/modules/tabular/tabular.prompt.ts:89-132` |
| Background/batched tabular extraction | Orchestration in `backend/src/modules/tabular/tabular.extraction.ts:135-170`, calling the same extract functions above |
| Background memory summarization/curation | `backend/src/modules/memory/memory.curator.ts:641-723,1287-1336` |

Chat tools do not independently call providers. They are advertised/executed inside the gated chat stream (`backend/src/modules/chat/engine/streaming.ts:192-500`; `backend/src/modules/chat/engine/tools/toolDispatcher.ts`). There are no embeddings calls.

Provider keys are stored per user in `public.user_api_keys.encrypted_key` with IV/tag (`backend/schema.sql:330-345`). The store uses AES-256-GCM and `USER_API_KEYS_ENCRYPTION_SECRET` (`backend/src/modules/user/user.apiKeyStore.ts:71-118,164-231`). The UI submits a key but receives only status (`frontend/src/app/lib/mikeApi.ts:944-947`; `backend/src/modules/user/user.routes.ts:299-323`). Environment keys are fallbacks (`backend/src/modules/user/user.apiKeyStore.ts:41-60`; `backend/src/lib/llm/providers.ts:61-103,280-312`). This is close to the AXERLY key invariant, but environment defaults and all provider entry points still need to be forced through one audited gate.

## 7. Document rendering

### Trace

1. Browser obtains presigned upload URLs and PUTs bytes directly (`frontend/src/shared/api/uploadSessionClient.ts:365-490`).
2. Processing downloads the sealed object into a plaintext `mike-upload-*` temp file (`backend/src/modules/uploads/uploads.processing.ts:251-292`).
3. Source bytes are copied unchanged to the durable source key (`backend/src/modules/uploads/uploads.processing.ts:402-403`).
4. Word/presentation formats are converted with headless LibreOffice; no DPI, JPEG quality, resize, or compression flag is passed (`backend/src/lib/convert.ts:145-227`; upload orchestration `backend/src/modules/uploads/uploads.processing.ts:171-191,415-427`).
5. Display chooses the stored PDF for presentations/office fallbacks, raw PDF for PDFs, and raw spreadsheet data (`backend/src/lib/documentDisplay.ts:67-105`). DOCX normally uses authenticated raw bytes rendered by `docx-preview` (`frontend/src/app/hooks/useFetchDocxBytes.ts:31-88`; `frontend/src/app/components/shared/views/DocxView.tsx:341-418`). PDF uses authenticated `/display` bytes and PDF.js (`frontend/src/app/hooks/useFetchSingleDoc.ts:52-79`; `frontend/src/app/components/shared/views/PdfView.tsx:429-467,698-710`).

### Exact quality loss

- The PDF canvas is allocated at `viewport.width × viewport.height`, equal to CSS pixels, and never scaled by `window.devicePixelRatio` (`frontend/src/app/components/shared/views/PdfView.tsx:429-464`). On HiDPI displays this produces a visibly softer raster than the source PDF. This is the primary deterministic viewer-quality loss.
- DOCX fit-to-panel is CSS zoom/scale (`frontend/src/app/components/shared/views/DocxView.tsx:275-317`), not image resampling. It can look smaller but does not rewrite embedded images.
- LibreOffice PDF conversion can substitute fonts and alter Word/PowerPoint layout because it is a reflow/render step; upstream passes no quality controls (`backend/src/lib/convert.ts:145-227`). This is fidelity risk, not an explicit lossy-image setting.
- No thumbnail is used as the full viewer, and no upload-time image resize, JPEG recompression, or low-DPI conversion was found. Originals are retained unchanged.
- Separately from visual quality, the plaintext temp file violates AXERLY's no-plaintext-files invariant.

## 8. Frontend

- Framework: Next.js App Router. The root layout is a server component with metadata and `next/font/google` (`frontend/src/app/layout.tsx:1-68`). Pages perform server-side `redirect()` in `frontend/src/app/page.tsx:1-5`, `frontend/src/app/(pages)/library/files/page.tsx:1-5`, and `frontend/src/app/(pages)/settings/organizations/page.tsx:1-5`.
- API route: catch-all Node route handler proxies requests to Express (`frontend/src/app/api/[...path]/route.ts:4-15,51`).
- Middleware: none found. Server actions: none found (`"use server"` has no occurrence).
- `frontend/next.config.ts` has rewrites/redirects and Sentry wrapping, but neither `output: "export"` nor `output: "standalone"`.
- Backend discovery: browser code uses same-origin `/api` (`frontend/src/app/lib/mikeApi.ts:1-4,89-99`); the Next route reads `API_BASE_URL`, defaulting to `http://localhost:3001` (`frontend/src/app/api/[...path]/route.ts:8-15`).

It cannot ship as a static export unchanged because the route handler and server redirects require a Next server. For the locked architecture, refactor those redirects to client/static routing, remove the proxy, make Express serve the exported assets and `/api`, and self-host fonts. Otherwise Electron must start a second Next server, contrary to the stated “Express serves API and frontend” design.

## 9. Theming

Dark mode is class-based: Tailwind's custom dark variant watches `.dark` and CSS variables define both themes (`frontend/src/app/globals.css:6,52-139`). `applyDarkMode` toggles the root element class (`frontend/src/app/lib/theme.ts:1-5`).

The default is currently light, not dark: `user_profiles.dark_mode` defaults to false (`backend/schema.sql:55`; `backend/migrations/20260813_02_user_dark_mode.sql:1-4`), and the frontend fallback is false (`frontend/src/app/contexts/UserProfileContext.tsx:218-245`). Theme is applied only after asynchronous profile loading (`:253-267`). The root layout has no pre-paint theme class or inline bootstrap (`frontend/src/app/layout.tsx:54-66`). Result: initial HTML paints light, then authenticated dark users switch after hydration/profile fetch. That is the flash of light theme, and a profile failure leaves light mode permanently.

## 10. Windows readiness

- There is no Electron app or Windows installer yet.
- Runtime/dev scripts depend on Bash: root `package.json:6`, backend `package.json`'s `test:stack`, `scripts/e2e-local-stack.sh`, `backend/scripts/test-stack.sh`, `word-addin/scripts/dev.sh`, and the Compose migration command (`docker-compose.yml:123-201`).
- Current normal stack requires Docker plus Supabase Postgres, GoTrue, PostgREST, Nginx, Mailpit, RustFS, Redis, and Linux containers (`docker-compose.yml:11-426`). This directly conflicts with the locked architecture.
- Conversion requires separately installed LibreOffice. Discovery checks `soffice`/`libreoffice` and Unix paths but no standard Windows `.exe` locations (`backend/src/lib/convert.ts:23-55`); Windows only works if an explicit executable path resolves. Timeout uses `child.kill("SIGKILL")` (`:181-184`), which is not a dependable Windows process-tree termination strategy.
- Test tooling invokes `psql` (`backend/scripts/test-stack.sh:40`; `backend/scripts/test-document-lifecycle-concurrency.mjs`).
- Native/prebuilt packages: Next's SWC, Sharp/libvips, Lightning CSS, Tailwind Oxide, `@napi-rs/canvas`, and related optional platform packages appear in `frontend/package-lock.json`; Windows x64 variants are present in the lock, but Electron packaging/unpacked-native loading must be verified. The backend itself is mostly JavaScript; `libreoffice-convert` shells out to LibreOffice rather than embedding it (`backend/package.json`; `backend/src/lib/convert.ts`).
- Word add-in development additionally needs Office, `office-addin-dev-certs`, and HTTPS sideload tooling (`word-addin/webpack.config.js:69-117`); it is not required for the base Electron app.
- Positive portability: upload temp paths use Node `os`/`path` APIs. PostgreSQL-backed jobs can replace Redis/BullMQ (`backend/src/lib/dbq/driver.ts:20-30`), avoiding another native service.

## 11. Local services and ports

| Service | Host port(s) | Purpose | Admin interface? | Evidence |
|---|---:|---|---|---|
| Supabase PostgreSQL | `127.0.0.1:54322` | Database | No | `docker-compose.yml:11-31` |
| GoTrue | internal `9999` | Auth API | No | `docker-compose.yml:34-85` |
| PostgREST | internal `3000` | DB REST/RPC API | No | `docker-compose.yml:88-98` |
| Nginx gateway | `54321` | Routes Auth/PostgREST | No | `docker-compose.yml:100-120` |
| `db-init` | none; one-shot | Applies schema/migrations | No | `docker-compose.yml:123-201` |
| Mailpit | `127.0.0.1:8025`, SMTP `1025` | Test inbox and SMTP | **Yes**, web inbox on 8025 | `docker-compose.yml:204-213` |
| RustFS | `127.0.0.1:9000`, console `9001` | S3-compatible object store | **Yes**, console on 9001 | `docker-compose.yml:216-231` |
| `createbucket` | none; one-shot | Creates storage bucket | No | `docker-compose.yml:233-255` |
| Redis | `127.0.0.1:6379` | BullMQ/queue | No bundled UI | `docker-compose.yml:257-271` |
| `workflow-sync` | none; one-shot | Downloads/syncs workflow catalog | No | `docker-compose.yml:273-297` |
| Express backend | `3001` | API and workers | No; health/API only | `docker-compose.yml:299-361` |
| Optional worker | none | Queue worker process | No | `docker-compose.yml:363-395` |
| Next frontend | `3000` | User web UI | No admin UI | `docker-compose.yml:397-426` |
| Word add-in dev server | HTTPS `3200` | Task pane/dev proxy | No | `word-addin/webpack.config.js:69-117` |
| Ollama (external, optional; not started by Compose) | `11434` | Local OpenAI-compatible model API | No bundled UI | `backend/src/lib/llm/providers.ts:270` |

Test scripts may additionally bind temporary E2E/Sentry-sink ports; those are test harnesses, not services started by the normal Compose stack.

## 12. Licensing

This section is an engineering inventory, not legal advice. Counsel should review distribution.

- Upstream `LICENSE:1-619` is the stock GNU Affero General Public License v3 text. Section 7 begins at `LICENSE:331`; there is no project-specific appendix or additional term after the standard license/application text. Therefore this file does **not** impose an extra author-credit requirement under AGPL §7. The upstream README identifies the project as AGPLv3 (`README.md:122-124`), and package metadata says `AGPL-3.0-only` (`package.json:19`, `backend/package.json:66`, `frontend/package.json:95`). The [FSF's official AGPL text](https://www.gnu.org/licenses/agpl-3.0.html) is the comparison authority.
- No copyright/SPDX header was found in upstream source files. No root `NOTICE`, `COPYING`, or third-party-notices file exists; the only root license file is `LICENSE`. Absence upstream does not remove the obligation to preserve any notices in imported dependencies/assets.
- AXERLY currently has no root `LICENSE`, no `README.md`, and no application source headers to compare (`AXERLY/` contains `.gitignore`, `AGENTS.md`, and prompt documentation at this point). Before code is imported, copy upstream `LICENSE` verbatim and preserve source history/notices. The eventual AXERLY README must identify AGPL-3.0 and the canonical source URL.
- Lockfile license metadata is concrete but not yet a distribution notice: `backend/package-lock.json` contains 451 MIT, 87 Apache-2.0, 18 ISC, 12 MPL-2.0, 11 BSD-2-Clause, 7 BSD-3-Clause and smaller groups/dual licenses; `frontend/package-lock.json` contains 1,328 MIT, 176 Apache-2.0, 74 ISC, 25 MPL-2.0, 23 BSD-2-Clause, 20 BlueOak-1.0.0, 15 BSD-3-Clause, 10 LGPL-3.0-or-later and smaller groups/dual licenses; `word-addin/package-lock.json` contains 971 MIT, 62 Apache-2.0, 60 ISC, 35 BSD-2-Clause, 23 BSD-3-Clause, 12 MPL-2.0 and smaller groups/dual licenses. Frontend LGPL entries are Sharp/libvips platform packages. Dual-license entries include JSZip's `(MIT OR GPL-3.0-or-later)` and node-forge's `(BSD-3-Clause OR GPL-2.0)`. Produce a machine-generated third-party notice/SBOM from the exact packaged dependency graph and selected license alternatives rather than relying on counts alone.
- Bundling PostgreSQL requires its copyright/license text; the [official PostgreSQL license](https://www.postgresql.org/about/licence/) requires the named notice paragraphs to appear in copies. Bundling LibreOffice requires its installation's license and third-party notices; LibreOffice states it is under MPL 2.0 and includes code under other licenses ([official LibreOffice licensing page](https://www.libreoffice.org/licenses/)). Do not copy only a generic MPL file and assume that covers the bundled distribution.

Upstream author/marketing credits may be removed under the standing instruction because no additional §7 attribution term was found. Original copyright/license notices, if encountered during later import, must still remain.

## 13. SSO/SAML

Upstream has a real but optional Supabase Auth SAML flow:

- GoTrue SAML environment is opt-in (`docker-compose.yml:61-65`; `backend/.env.example:72-76`).
- Backend validates enablement and allowed email domains (`backend/src/lib/ssoConfig.ts:4-23`), starts `signInWithSSO` (`backend/src/modules/auth/auth.routes.ts:166-221`; `backend/src/modules/auth/auth.service.ts:134-145`), and uses the normal callback/session exchange.
- Frontend exposes “Continue with SSO” and a company-email screen (`frontend/src/app/components/auth/SsoAuthButton.tsx:11-24`; `frontend/src/app/login/sso/page.tsx:16-83`; API call `frontend/src/app/lib/authApi.ts:87-93`).
- The schema calls SSO/SAML/SCIM future extension points (`backend/schema.sql:199-200`); there is no SCIM implementation.

Recommendation for a small-firm beta: do not carry this implementation into the first own-auth release. It is tightly coupled to GoTrue and adds certificate/IdP metadata, domain discovery, account-linking, and support burden. Preserve an auth-provider abstraction and defer SAML/SCIM until a paying firm requires it. This is a report-only recommendation; no SSO code was changed.

## 14. Default and placeholder credentials

Committed values found:

| Credential/key | Location | Assessment |
|---|---|---|
| PostgreSQL password `postgres` | `docker-compose.yml:19,43,94,131`; `docker/db-init/roles.sql:10,13` | Working local default, unsafe beyond isolated development. |
| Supabase JWT signing secret | `docker-compose.yml:21,46,97` | Working public demo secret. |
| Supabase anon and service-role JWTs | `.env.example:22-23`; `docker-compose.yml:285,328-329,382`; allowlisted in `.gitleaks.toml:39-40` | Working demo tokens signed by the committed demo secret; service token is privileged. |
| RustFS access/secret `rustfsadmin` | `docker-compose.yml:227-239,287-288,332-333,384-385` | Working default admin credentials. |
| Mailpit unauthenticated/insecure mode | `docker-compose.yml:204-213` | No password; safe only on loopback development. |
| Download-signing placeholder | `backend/.env.example:18-24` | Literal `replace-with-...`; startup should reject it if copied. |
| Supabase publishable/service placeholders | `backend/.env.example:26-29` | Named placeholders. |
| Object-store placeholders | `backend/.env.example:78-83` | Named placeholders. |
| Provider/router/encryption placeholders | `backend/.env.example:91-103` | Gemini, Anthropic, OpenAI, router, encryption, and CourtListener placeholders/blank slots. |
| Manifest-signing placeholder | `backend/.env.example:129-137` | Blank signing-key slot. |
| MCP OAuth/client/encryption placeholders | `backend/.env.example:221-264` | Google/Slack client secrets, bearer key, and encryption secret slots. |
| Integration-test Supabase keys | `backend/.env.example:299-301` | Blank test-only slots. |
| Google OAuth/handoff placeholders | `.env.example:18-28` | Blank secret slots; anon demo key is populated as above. |

No default application user/password was found. Sentry DSNs are committed public ingestion addresses, not read/admin credentials, but they enable phone-home by default and are covered in section 15. AXERLY must not carry any of the working demo credentials; its `.env.example` may contain variable names only under `AGENTS.md`.

## 15. Telemetry, analytics, phone-home, licensing and billing

### Automatic telemetry

Sentry error reporting is **on by default** for backend, frontend, and Word add-in. If no override is supplied, community installs send to three Mike-owned DSNs (`backend/src/lib/observability/sentry.ts:266-303`; `frontend/src/shared/lib/sentryEvent.ts:249-287`; Word statement at `word-addin/src/taskpane/lib/errorReporting.ts:1-6,42-70`). Browser bootstrap occurs before hydration (`frontend/src/instrumentation-client.ts:1-20`), and backend bootstrap is `backend/src/instrument.ts:15-34`. Scrubbers remove many bodies, secrets, email/path data, and disable replay/PII, but event metadata, errors, route names, stack information, release/environment tags, and Word host/version still leave the machine (`backend/src/lib/observability/sentry.ts:245-263,759-802`; `word-addin/src/taskpane/lib/errorReporting.ts:68-78,100-123`). This must default off/remove upstream DSNs for AXERLY.

No Google Analytics, Segment, Mixpanel, PostHog, Amplitude, or equivalent product analytics SDK was found.

### Other outbound traffic

- Selected LLM providers receive prompts/doc context by design through section 6's provider gate (`backend/src/lib/llm/providers.ts:126-440`). Model catalog discovery also calls Ollama, OpenRouter, Vercel AI Gateway, and OpenCode endpoints (`backend/src/modules/models/models.service.ts:99-102,157-160,217-220,314-317`).
- CourtListener legal research calls its API/web/object store (`backend/src/lib/courtlistener.ts:5-7,66-112`).
- Workflow catalog sync calls GitHub API and codeload, optionally with a token (`backend/src/lib/workflowCatalogSource.ts:203-262`).
- MCP connectors can send user-authorized context/tools to arbitrary configured servers; bundled presets include Slack, Notion, Airtable, and Linear (`frontend/src/app/components/settings/connectorPresets.ts:5-8`; `backend/src/lib/mcp/client.ts`).
- PDF.js downloads standard font data from unpkg at viewer runtime (`frontend/src/app/components/shared/views/highlightQuote.ts:13-14`).
- Word add-in loads Office.js and Google Fonts from Microsoft/Google CDNs (`word-addin/src/taskpane/index.html:10-17`; the OAuth/commands pages also load hosted Office.js). The web global-error page imports Google Fonts (`frontend/src/app/global-error.tsx:26`), while the main layout uses `next/font/google` (`frontend/src/app/layout.tsx:1-18`).
- UI links and metadata phone users toward upstream/mikeoss.com, including signup terms/privacy and workflow repository links (`frontend/src/app/signup/page.tsx:209-218`; `frontend/src/app/components/workflows/OpenSourceWorkflowModal.tsx:20`; `frontend/src/app/layout.tsx:18-31`). These require rebrand/removal.

### Existing licensing/subscription/billing code

There is no app-license-key validation, subscription checkout, Stripe/Paddle/payment integration, or billing webhook. Searches for those mechanisms found none. The only commercial-looking remnants are `user_profiles.tier`, `message_credits_used`, and a 30-day reset (`backend/schema.sql:43-45`; reset logic `backend/src/modules/user/user.profile.load.ts:40-63`). The UI displays the tier (`frontend/src/app/components/shared/AppSidebar.tsx:254-256`; `frontend/src/app/(pages)/settings/page.tsx:371`), but the nominal monthly limit is `999999` and no production code increments usage (`backend/src/modules/user/user.profile.storage.ts:4`; serialization `backend/src/modules/user/user.profile.serialization.ts:14-36`). It is dormant profile/UI scaffolding, not enforcement. AXERLY licensing must therefore be designed from scratch and enforced in the backend read-only gate without blocking login/view/export/backup.

## Recommended migration order

1. Import upstream history/source while preserving `LICENSE`; establish AXERLY source URL, third-party-notice/SBOM generation, and rebrand inventory before modifying files.
2. Add characterization/security tests around access decisions, resource-not-found behavior, SQL RPCs, document lifecycle, and provider routing. Treat existing behavior as migration fixtures.
3. Introduce a direct PostgreSQL adapter and Windows-native migration runner. Keep SQL functions initially; replace PostgREST calls behind repositories without changing behavior.
4. Add app-owned users, Argon2id credentials, opaque server sessions, invitations, and auth migration; repoint every `auth.users` FK/trigger. Remove GoTrue/PostgREST/Supabase roles only after parity tests pass.
5. Make the existing Organization the single firm tenant. Add Teams as separate membership/share principals; extend, rather than replace, direct-user and organization/project access.
6. Replace RustFS/S3 with a host-disk encrypted blob service. Stream upload/download/view only through authenticated Express endpoints; migrate keys and eliminate plaintext temp files.
7. Consolidate all effective authorization in a deny-by-default `authz` module and audit every route. Preserve DB constraints/optional RLS as defense-in-depth.
8. Convert the frontend for Express-hosted static assets, same-origin `/api`, self-hosted fonts/assets, dark-first prepaint, and no default telemetry.
9. Add Electron host/client modes, embedded random-port PostgreSQL, LAN HTTPS, TLS public-key pinning, startup/shutdown/backup, and Windows process management.
10. Add the separate AXERLY license-server protocol and signed offline state. Enforce seats/read-only centrally only after auth and firm membership are stable.
11. Package LibreOffice or select a distributable renderer; generate third-party notices; test native dependencies and build/sign the Windows installer in GitHub Actions.
12. Run migration, recovery, backup/export, network-loss, license-expiry, seat-limit, and hostile-client security tests on clean Windows VMs before beta.

## Risk list

1. **Authorization regression:** service-role DB access means one missed application check exposes cross-tenant data; the current access rules are spread across many modules.
2. **Identity migration:** more than forty `auth.users` references, account-deletion triggers, handoff flows, MFA/OAuth/SSO, and email grants can orphan or overgrant records.
3. **Encrypted storage migration:** preserving versions, extracted text, exports, edits, and cleanup-job semantics while changing object IDs and encrypting every byte is high risk.
4. **Team semantics:** conflating firm, team, project, and direct-user grants would break ethical-wall `deny` behavior and inherited child access.
5. **Windows process lifecycle:** embedded PostgreSQL and LibreOffice must start, upgrade, recover, and terminate safely without Docker or Unix signals.
6. **LAN security:** certificate bootstrap/pinning, host discovery, session cookies, CSRF/origin checks, and recovery after host key change need explicit threat modeling.
7. **Document fidelity:** LibreOffice font substitution plus the HiDPI PDF canvas bug can make legal documents appear different from originals.
8. **License read-only state:** incomplete gating could either permit writes or wrongly block access/export to firm data; this needs route-level tests.
9. **Native packaging:** optional native Next/image/canvas packages and bundled database/rendering binaries may fail after ASAR packaging or on older Windows hosts.
10. **AGPL/third-party compliance:** AXERLY currently lacks the upstream license and a dependency notice bundle; distributing before those exist is unsafe.
11. **Default phone-home:** current Sentry defaults and CDN/font/workflow fetches violate an expected local-only posture unless explicitly removed or consented.
12. **Migration scale:** replacing PostgREST across roughly one hundred production files in one cutover would be difficult to review and rollback.

## Contradictions with locked `AGENTS.md` architecture

| Locked requirement | Current upstream contradiction |
|---|---|
| Windows Electron host/client, one installer | No Electron application or installer; web/Compose deployment only. |
| Express serves frontend and API | Next requires its own server because of its proxy route and redirects. |
| Embedded Postgres, no external DB/Supabase/Docker | Supabase Postgres + GoTrue + PostgREST + gateway are Docker services and core runtime dependencies. |
| Own hashed-password auth and server sessions | Supabase Auth owns password hashes, users, MFA/OAuth/SSO, JWT/session lifecycle. |
| No RustFS or Mailpit | Both are default Compose services; Redis is also started. |
| Host-disk AES-256-GCM files through authenticated API only | S3/RustFS objects are not envelope-encrypted; browser uses presigned direct PUT and GET; processing writes plaintext temp files. |
| One firm; teams only for permissioning | Organization is currently a multi-tenant workspace; Teams do not exist. |
| Central deny-by-default `authz`, 404 for hidden resources | Access logic exists but is distributed (`access`, `contentAccess`, feature modules); some code/comments/tests intentionally use 403 for known-but-forbidden resources. A single `authz` boundary does not exist. |
| Dark mode default | Database and client defaults are light and dark users see a light flash. |
| No secrets/default credentials in repo; examples list names only | Compose and examples commit working Supabase/Postgres/RustFS demo credentials and literal placeholder values. |
| AXERLY license enforcement/read-only degradation | No AXERLY licensing implementation exists; only dormant tier/credit profile fields. |
| License server secrets never in app | Not yet applicable, but no license protocol/public verification key exists. |
| Single gated provider module | Most calls converge on `lib/llm`, which is a good base; memory also uses the same stream primitive. The gate is not yet AXERLY license/model-policy aware. |
| Rebrand and canonical AXERLY Source link | Mike names, mikeoss.com links, upstream GitHub links, package names, and Sentry DSNs remain throughout upstream. |
| Root AGPL license retained | The current AXERLY repository has no `LICENSE` yet because source has not been imported. |

<!-- AXERLY modified 2026-09-24. -->
# Manual and production deployment

Use this path when connecting Mike to managed Supabase and S3-compatible
storage instead of the infrastructure bundled with Docker Compose.

## Prerequisites

- Node.js 22 or newer
- npm and Git
- A Supabase project
- A Cloudflare R2, MinIO, or other S3-compatible bucket
- At least one supported model-provider API key, or an accessible Ollama server
- Optional: a CourtListener API token for case-law tools
- LibreOffice when DOC/DOCX-to-PDF conversion is required

## Database setup

For a fresh Supabase database, run the contents of `backend/schema.sql` in the
Supabase SQL editor. The schema file contains the complete current database
shape.

For an existing deployment, do not run the complete schema over production
data. Back up the database first, identify the last migration already applied,
then apply each newer file in `backend/migrations/` in filename order.
Migration filenames follow `YYYYMMDD_NN_<name>.sql`.

Keep the last applied migration filename with your deployment records. Do not
blindly replay the directory against production: migrations are written for an
expected starting schema, and a successful fresh install from `schema.sql` is
not evidence that an older database has completed every upgrade step. The
repository's schema-drift CI separately checks that its pinned historical
baseline converges with the fresh schema after all later migrations run.

### After the organization-access upgrade: `tabular_review_legacy_shares`

`20260904_02_migrate_legacy_sharing.sql` converts the old roleless
`shared_with` arrays into real access grants. One shape has nowhere to go: a
tabular review that lives INSIDE a project now inherits access from that
project, so a share on the review alone cannot be reproduced without handing
the recipient the whole matter. That migration dropped
`tabular_reviews.shared_with` without recording those recipients.

`20260917_01_organization_access_followup.sql` creates
`public.tabular_review_legacy_shares` as the place those `(review, project,
email)` triples belong, and backfills it only if the `shared_with` column
still exists when it runs. On a deployment that already applied
`20260904_02` the column is gone, so the table lands EMPTY: the recipients
are recoverable only from a pre-upgrade backup. To recover them, restore the
old `shared_with` values into a scratch column named `shared_with` on
`tabular_reviews`, re-run `20260917_01` (it is safe to re-run), then drop the
scratch column. Fresh installs create the table empty and nothing writes it
at runtime. The table carries no foreign keys, so the record survives the
review or project being deleted. It is `service_role`-only; read it with the
service key:

```sql
select l.email, l.project_id, l.tabular_review_id, l.archived_at
from public.tabular_review_legacy_shares l
order by l.archived_at desc;
```

Each row is a person who could see that review before the upgrade and cannot
now. For each one, decide deliberately: grant them access to the project (or
add them to the organization) if they should still have it, and otherwise do
nothing. The table is a record, not a queue — nothing reads it, and rows may
be deleted once every recipient has been dealt with.

Apply the workflow catalog migration before deploying the matching backend
release, then run the dedicated ingestion job from the built backend artifact:

```bash
cd backend
npm run sync:workflows
```

The job resolves `MIKE_WORKFLOWS_REF`, downloads and validates the raw
`Open-Legal-Products/mike-workflows` archive, uploads reference assets to the
configured S3-compatible storage, and transactionally replaces the active
`mike_workflows` catalog. Temporary archive and JSON files are deleted when the
job exits. Run this as a release job before directing traffic to the new
backend; backend startup itself only reads the database. Docker Compose runs
this sequence automatically for local/self-hosted deployments.

## Environment

Copy the maintained examples:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.local.example frontend/.env.local
```

Edit both files with the credentials and URLs for your deployment. At runtime,
the frontend server needs only `API_BASE_URL`; browsers call the same-origin
`/api` gateway and receive no Supabase URL, key, or session token. The variable
is not needed while building the frontend.

Use:

- `NODE_ENV=production` so startup enforces HTTPS and secure-cookie invariants;
- the Supabase project URL for backend `SUPABASE_URL`;
- the anon/publishable key for backend `SUPABASE_PUBLISHABLE_KEY`;
- the service-role key for backend `SUPABASE_SECRET_KEY`; and
- the internal Mike backend origin for frontend `API_BASE_URL`.

Set backend `API_PUBLIC_URL` to the browser-reachable frontend gateway, including
its `/api` prefix (for example, `https://app.example.com/api`). OAuth providers,
including MCP connectors, must return through that public gateway; never use an
internal container hostname such as `http://backend:3001` for callbacks.

Never expose session tokens, model-provider keys, or storage secrets in
frontend JavaScript.

Authentication cookies are `Secure`, `SameSite=Lax`, path `/`, and use the
`__Host-` prefix. The opaque session cookie is also `HttpOnly`; the separate
CSRF cookie is readable only so the client can echo it in `X-CSRF-Token`.
Terminate TLS at every app origin and configure the exact trusted origins.

### Object-storage CORS for direct uploads

Mike's upload-session API gives an authenticated browser a short-lived signed
`PUT` URL for one specific staging object. The bucket must therefore allow
browser `PUT` requests from each deployed frontend origin. Configure the
equivalent of this CORS policy in Cloudflare R2, MinIO, RustFS, or the selected
S3-compatible provider:

```json
[
  {
    "AllowedOrigins": ["https://your-mike.example"],
    "AllowedMethods": ["PUT", "HEAD"],
    "AllowedHeaders": ["Content-Type", "x-amz-*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

List exact trusted origins; do not use `*` for a production deployment. The
signed URL authorizes only its generated object key and expires independently
of the CORS cache. The backend still verifies the uploaded byte count and
copies accepted bytes to a non-signed, sealed key before queuing processing.
Each file is verified and queued as soon as its individual `PUT` completes;
the remaining files in the same session may continue uploading while the
worker creates documents or document versions from earlier files. Success and
definite transfer failure are both reported through the file's idempotent
completion endpoint. The client retries that control request and then polls the
session, whose status is derived from its file rows; there is no separate
session-wide completion request.

Upload sessions accept at most 50 supported files, 100 MB per file, and 2 GB
in total. Users may run multiple independent upload sessions concurrently and,
by default, may create at most 50 sessions per hour. Upload-session mutation,
polling, and hourly creation limits can be overridden with the
`RATE_LIMIT_UPLOAD_SESSION_*` environment variables documented in
`backend/.env.example`; missing or invalid values use the documented defaults.
Sessions that update the same mutable document version remain mutually
exclusive. Sessions
expire after 30 minutes, extended by a further 30 minutes each time a file
completes so a slow batch is not destroyed mid-upload, up to four hours from
creation; individual signed URLs expire after 15 minutes and can
be refreshed while the session is pending. These limits are enforced atomically
in PostgreSQL, not only in the browser.

The Express process also runs a durable upload-processing pool. By default,
each backend replica claims up to 8 jobs concurrently while PostgreSQL limits
each user to two active jobs across all replicas. Override these defaults with
`UPLOAD_PROCESSING_CONCURRENCY` (capped at 64) and
`UPLOAD_PROCESSING_MAX_RUNNING_PER_USER`; every claim loop polls the database,
so raising the pool raises idle query load in proportion. Workers claim jobs
with database leases, retry a failed file up to three times, and clean expired,
cancelled, and terminally failed temporary objects. A single document
conversion is killed after `UPLOAD_CONVERT_TIMEOUT_MS` (default 120000, clamped
to 10000-600000) and a worker stops renewing its lease after
`UPLOAD_JOB_WALL_CLOCK_MS` (default 900000, clamped to 60000-3600000) so a
wedged job is recovered by another worker instead of holding its slot. Terminal session metadata is retained
for seven days so clients can inspect outcomes, then deleted in bounded cleanup
batches.
Deployments must therefore run `backend/src/index.ts`
(the normal `npm start` entry point), rather than importing the Express app
without starting its worker.

Model-provider keys and the CourtListener token can be configured globally in
`backend/.env` or per user under **Settings > API Keys**. A personal key takes
precedence over the matching globally configured key; removing the personal
key restores the global key as the fallback.

### Error tracking

Error reports are sent to the Mike project's own Sentry by default, so the
maintainers can fix failures encountered by forks and self-hosted installs.
Before network transmission, every runtime rebuilds reports from an explicit
allowlist: code locations and line numbers, controlled operation labels,
HTTP method/status and normalized routes, validated correlation IDs, release,
and environment. Client document filenames, document text, raw error and
console messages, request URLs/queries/headers/bodies, user identities, and
breadcrumbs are excluded. Automatic sessions, replay, attachments, traces,
and other non-error payloads are blocked. The same boundary applies to
community and official installations. See the [observability guide](observability.md)
for the exact policy, source-map behavior, and limitations.
To opt out, set `SENTRY_DISABLED=true`
(`NEXT_PUBLIC_SENTRY_DISABLED=true` / `REACT_APP_SENTRY_DISABLED=true` for the
browser and add-in builds); to use your own Sentry instead, set the matching
`*_SENTRY_DSN`.

For the compose stack that is `SENTRY_DISABLED=true` in the root `.env`
(the backend reads it through `env_file`; the frontend build and the Next
server receive it from compose). To report to your own Sentry instead, set
`SENTRY_DSN` (backend) and `FRONTEND_SENTRY_DSN` (web app). What is reported,
what is scrubbed, and how to verify are in [observability.md](observability.md).

## Authentication

AXERLY uses local email/password authentication. Passwords require at least 12
characters and are hashed with scrypt. The backend stores only hashed opaque
session tokens, enforces idle and absolute expiry, and applies account/IP login
limits. There is no public registration endpoint; organization onboarding will
provide the gated account-creation flow. Development builds expose the
first-user-only `/auth/dev/bootstrap` endpoint.

## Install and run

Install dependencies:

```bash
npm install --prefix backend
npm install --prefix frontend
npm install --prefix word-addin
```

For development, start the packages in separate terminals:

```bash
npm run dev --prefix backend
```

```bash
npm run dev --prefix frontend
```

For production, build both packages and run their `start` scripts through your
process manager or deployment platform:

```bash
npm run build --prefix backend
npm run build --prefix frontend
```

The repository includes Dockerfiles for the backend, frontend, and Word add-in.
Build and run the production add-in host with its public URLs baked into the
static bundle and its private backend origin supplied only at runtime:

```bash
docker build -t mike-word-addin \
  --build-arg REACT_APP_WEB_APP_URL=https://app.example.com \
  --build-arg WORD_ADDIN_PUBLIC_URL=https://word.example.com \
  -f word-addin/Dockerfile .
docker run --rm -p 3200:3200 \
  -e WORD_ADDIN_BACKEND_ORIGIN=http://backend:3001 \
  mike-word-addin
```

Put an HTTPS ingress or reverse proxy in front of port 3200. The included host
serves `dist/` and streams `/api/*` to the backend while preserving cookies,
`Set-Cookie`, `Origin`, request bodies, and SSE responses.

## Background jobs and Redis

Mike runs durable background jobs (document conversion, tabular extraction,
audit recording, account deletion, storage cleanup, export builds) through one
of two interchangeable transports:

- **With Redis** (`REDIS_URL` set): jobs are delivered instantly through
  BullMQ, and tabular reviews stream live progress over Redis pub/sub. The
  bundled Docker Compose stack ships a Redis service and enables this by
  default for new installs.
- **Without Redis**: the same jobs run through a Postgres-backed queue
  (`db_jobs`, created by the schema/migrations) with a polling worker. No
  extra infrastructure is required — an existing deployment that upgrades in
  place keeps working with no configuration changes and no Redis. Progress
  streaming falls back to short database polls.

The transport is selected automatically; `QUEUE_DRIVER=postgres` forces the
database queue even when `REDIS_URL` is set.

By default, workers run in a worker thread inside the backend process, so no
extra process management is needed. To run them on separate hardware, start
`node dist/worker.js` (any number of instances — work is partitioned safely)
and set `WORKERS_MODE=none` on the API process. The compose file contains a
commented `worker` service demonstrating this.

### Document lifecycle migration

Apply `20260914_01_document_lifecycle.sql` before deploying the backend that uses
its version RPCs. Fresh installs include it in `backend/schema.sql`; Compose's
`db-init` service applies it during upgrades. Do not remove pending
`document.cleanup` jobs: they retain the object keys needed to finish erasure.
The migration makes both queue claim paths recover failed cleanup jobs, including
ones rejected by an older worker during rollout, and exhausted stale claims.
Keep failed cleanup rows as well as pending ones; upgraded workers reclaim them.

Backend and frontend Docker build contexts are now the repository root, so both
can compile against `packages/contracts`. For a manual backend image build use
`docker build -f backend/Dockerfile -t mike-backend .` from the root.

Each image reads only what its Dockerfile copies: the frontend image contains
`frontend/` and `packages/contracts`; the add-in image adds `frontend/src/shared`
and `frontend/public/icons`, which its bundle includes. In the frontend image
`next build` type-checks `frontend/tsconfig.build.json`, which excludes test
files, so test fixtures and sibling applications never become build inputs. CI builds all three
images on every pull request (`.github/workflows/docker-images.yml`), so a
source change that reaches outside a build context fails before merge instead
of on the next fresh install.

## Deployment safety

- Generate unique, high-entropy signing and encryption secrets.
- Use production Supabase credentials rather than the local demo values.
- Keep backend secrets out of `NEXT_PUBLIC_*` variables.
- Configure spending limits for model-provider keys where supported.
- Confirm LibreOffice is available on the backend process path if document
  conversion is enabled.
- Review storage, logging, retention, and deletion behavior before processing
  confidential documents.

See [Safe local testing](safe-local-testing.md), the [security policy](../SECURITY.md),
and [Troubleshooting](troubleshooting.md) for related guidance.

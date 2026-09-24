<!-- AXERLY modified 2026-09-24. -->
# Troubleshooting

## Login is rejected

AXERLY deliberately returns the same message for an unknown account, wrong
password, disabled account, or temporary account lock. After five failed
password attempts, wait 15 minutes or have an administrator clear the lock.
Sessions can also be revoked by password, role, or account-status changes.

## Port 54322 is already allocated

Another local Postgres or Supabase stack is using Mike's default host port.
Stop that stack or choose another mapping, for example:

```bash
DB_PORT=54323 docker compose up --build
```

## The model picker reports a missing key

Add a key under **Settings > API Keys**, or configure it in
`backend/.env` and restart the backend.

For local Ollama models, confirm `ollama list` shows an installed model and the
backend can reach the URL configured by `OLLAMA_BASE_URL`. Refresh Mike after
installing a model.

## CourtListener tools are unavailable

See [CourtListener integration](courtlistener.md#troubleshooting) for API-token
and optional bulk-data checks.

## DOC or DOCX conversion fails

Install LibreOffice and restart the backend so its conversion command is
available on the process path.

## Sentry receives no events

- The backend logs `[sentry] enabled for api` at boot when reporting is active.
  An unset custom `SENTRY_DSN` uses Mike's built-in community DSN; only
  `SENTRY_DISABLED=true` (or the automatic test-process guard) disables it.
- The browser bundle also uses the built-in DSN when no custom
  `NEXT_PUBLIC_SENTRY_DSN` is set. Only `NEXT_PUBLIC_SENTRY_DISABLED=true`
  disables reporting. Rebuild after changing either build-time value
  (`FRONTEND_SENTRY_DSN` / `FRONTEND_SENTRY_DISABLED` for the compose image).
- Prove the pipeline with `SENTRY_ENABLE_TEST_ROUTE=true` and
  `curl -i http://localhost:3001/observability/sentry-test`, or run the local
  sink in `scripts/sentry-sink.mjs`. Details in [observability.md](observability.md).

## Useful checks

```bash
npm run build --prefix backend
npm run build --prefix frontend
npm run lint --prefix frontend
```

For test commands and contribution expectations, see
[Contributing](../CONTRIBUTING.md#testing).

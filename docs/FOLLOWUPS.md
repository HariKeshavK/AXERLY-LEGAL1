<!-- AXERLY modified 2026-09-24. -->
# AXERLY follow-ups

## After P2 direct PostgreSQL

- Replace S3/R2 storage with authenticated AES-256-GCM host-disk storage; then restore full browser E2E coverage without Docker or RustFS.
- Decide whether a later beta should implement first-party MFA; the current local-auth release does not require MFA.
- Replace the temporary fluent database compatibility facade with typed domain repositories incrementally.
- In P13, implement the existing `SecretsStore` interface with Electron `safeStorage` and migrate the file-backed secrets atomically.
- Update remaining upstream operational documentation and comments that describe PostgREST, Docker, hosted deployment, or external services as those subsystems are replaced.
- Diagnose the two upstream Windows test-fixture failures in `convertTimeout.test.ts` and `pdfText.integration.test.ts`, plus parallel dynamic-import timeouts, independently of the database migration.

## After P3 authentication and authorization

- P6 must replace the development-only first-user bootstrap with licensed organization creation and invitation/join flows.
- Replace the remaining historical `auth_handoff_tickets` definition in immutable baseline migration `0001` only through the applied `0002` drop; do not edit the baseline checksum.

# AXERLY follow-ups

## After P2 direct PostgreSQL

- Replace S3/R2 storage with authenticated AES-256-GCM host-disk storage; then restore full browser E2E coverage without Docker or RustFS.
- Decide whether the beta will implement or remove OAuth, SSO, MFA enrollment, and email-based password reset UI. Local auth currently reports unsupported capabilities explicitly.
- Replace the temporary fluent database compatibility facade with typed domain repositories incrementally.
- In P13, implement the existing `SecretsStore` interface with Electron `safeStorage` and migrate the file-backed secrets atomically.
- Update remaining upstream operational documentation and comments that describe PostgREST, Docker, hosted deployment, or external services as those subsystems are replaced.
- Diagnose the two upstream Windows test-fixture failures in `convertTimeout.test.ts` and `pdfText.integration.test.ts`, plus parallel dynamic-import timeouts, independently of the database migration.

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

## After P4 encrypted files

- Plan an explicit, authorized one-time migration/import of historical R2/S3 objects; P4 does not move existing remote data.
- P13: persist the storage master key via Electron `safeStorage`, and provide a user-facing backup/restore workflow for both PostgreSQL and encrypted files.
- Package LibreOffice and PDF-processing Windows binaries for the installer, and resolve the existing Windows conversion/PDF test-fixture failures.
- Remove legacy Docker, Redis, Mailpit, and remaining external-service deployment dependencies as their locked-architecture replacements are built.

## After P5 single firm and teams

- P6: replace the development-only initial-firm creation route with the licensed first-run setup flow; generate and hash the firm join code/password, and build the join/admin controls. The production route is deliberately absent until that gate exists.
- P7: use all memberships from `teamIdsForUser` to union model entitlements and add explicit team targets to the existing Library/Project sharing model. Team membership currently grants no document or project access by itself.
- If an existing installation has multiple organizations, design an explicit, reviewed, access-preserving migration. Migration `0004` intentionally refuses to merge tenants automatically.
- Remove or repurpose the now-unmounted legacy Create Organization modal and obsolete frontend create/delete-org API helpers as part of the P6 onboarding redesign.

## Licensing prerequisite before P6 production setup

- Keep the nested `licensing-server/` checkout out of the public app repository **and** the future Electron packaging inputs; `.gitignore` alone does not exclude installer files.
- After L-A deploys the ES256 license Edge Function and supplies its separate public JWK, wire the app's verifier into a backend-enforced activation/setup flow. Until then, production firm creation remains unavailable.
- Revisit license-signing key rotation before production: a single pinned public key cannot validate older tokens after immediate private-key replacement.

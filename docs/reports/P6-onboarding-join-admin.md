# P6 — Onboarding, join gate, and admin panel

Date: 2026-09-25
Status: implemented core flows; **not yet release-complete** because the P13 host identity and P7 model-entitlement gate do not exist, and the requested security audit feed is incomplete.

## What changed

- Added migration `0005`: temporary-password flag, IP-bound single-use join tokens, join-attempt ledger, and serialized onboarding guard. A fresh bundled Windows PostgreSQL applied migrations `0001`–`0005` and loaded `pgcrypto`/`pg_trgm`; a second migration run was a no-op.
- Added backend license activation and validation against the separately deployed AXERLY license endpoint. The app holds only the endpoint and pinned ES256 public JWK. A signed token is verified before first-firm creation; production writes are read-only if verification/renewal fails, while login, viewing, export, and password changes remain available. Neither the Supabase service-role key nor signing private key is in this app.
- Added first-firm creation with editable name prefilled from signed `practice_name`, a first admin, one-time generated join credentials, and the existing storage recovery key step. Added a 10-minute, one-use, IP-bound join-token flow with constant-time code comparison, scrypt-hashed join password, 5/15-minute per-IP lockout, and global backoff. New accounts are members with no team assigned; seat count is checked transactionally.
- Added admin endpoints and panel for users, team CRUD and membership, firm credential rotation, limited personal-resource ownership transfer after removal, license status/refresh, and audit viewing. Last-admin demotion/removal serializes on the firm row. Password resets issue a one-time random credential, revoke sessions, and force password change on next login. The dev bootstrap route is absent from production **and packaged** builds.
- Tightened central authz so administrator status alone does not grant private document/project access. Limited transfer to a departed user's standalone personal resource, since `user_id` on firm-scoped content is provenance, not ownership. The audit API omits free-form details/titles that could expose private matter content.
- Made compact JWS parsing canonical: alternate base64url spellings of the same signature bytes are rejected.

## Files touched

- Schema: `backend/db/migrations/0005_onboarding.sql`.
- Backend: `backend/src/licensing/licenseClient.ts`, `license.routes.ts`, `licenseToken.ts`; `backend/src/modules/onboarding/*`; `backend/src/modules/admin/*`; `backend/src/middleware/licenseGate.ts`, `auth.ts`, `routeSecurity.ts`; `backend/src/config/secrets.ts`; `backend/src/lib/authz.ts`, `localAuth.ts`, `authSession.ts`; `backend/src/app.ts`; `backend/src/modules/auth/auth.routes.ts`; route-inventory test.
- Frontend: `frontend/src/app/setup/page.tsx`, `change-password/page.tsx`, `(pages)/admin/page.tsx`, `lib/onboardingApi.ts`, `lib/authApi.ts`, `login/page.tsx`, `components/shared/AppSidebar.tsx`.
- Documentation: this report and `docs/FOLLOWUPS.md`. Root `LICENSE` and upstream notices were not changed. The separate `licensing-server/` checkout was not changed or bundled.

## Tests

- Before: backend build and test typecheck passed; frontend typecheck passed and lint had 0 errors/29 pre-existing warnings. Baseline backend full suite had the same two Windows fixture failures described below, plus a transient unrelated Sentry hook timeout.
- After: backend build and test typecheck passed; `verify:db` passed against fresh bundled Windows PostgreSQL, including idempotent re-run and migration `0005`; focused P6 tests passed (17/17 at first run, then additional revocation cases passed in the integration file). Frontend typecheck passed; lint 0 errors/29 existing warnings; frontend full suite 1,566/1,566 passed.
- Backend full suite after changes: 2,249 passed, 2 failed out of 2,251. Both are pre-existing Windows fixture problems: `convertTimeout.test.ts` attempts to spawn a nonexistent `soffice` fixture; `pdfText.integration.test.ts` cannot extract expected fixture text. The ES256 canonical-encoding test passed on focused rerun and in the final full run.
- New integration coverage on temporary bundled PostgreSQL: wrong join password and IP lockout, token IP binding/reuse/expiry, seat limit, concurrent sole-admin demotion/removal, role-change/removal/password-reset session revocation, and audited departed-user personal-resource transfer. No real firm data was used.

## Open issues / release gates

1. The setup invite cannot yet include a truthful host LAN address, HTTPS port, or pinned TLS public-key fingerprint: P13 Electron host mode creates those values. The UI explicitly says they will be available then; it never fabricates them.
2. P7's model entitlement gate is not implemented. A joined member receives no team, but legacy model paths may still be callable; do not treat teamless membership as a complete model-access denial until P7.
3. The audit view includes existing `audit_events` and P6 admin/join-success events but not the full requested coverage of auth failures, anonymous join attempts, shares, key changes, downloads, and blocked model calls. Complete this before release. The existing `audit_events.user_id NOT NULL` means anonymous failures require a separate nullable-actor security-event table or a reviewed schema change.
4. Activation has not been smoke-tested with a live issued test license. No license key or private secret was requested or written to this repository.
5. P13 must move file-backed host secrets to Electron `safeStorage`, and the license verifier needs planned public-key overlap/recovery for signer rotation.

This is an engineering report, not legal advice. Counsel should review wording that explains AXERLY's license gate alongside AGPL rights before distribution.

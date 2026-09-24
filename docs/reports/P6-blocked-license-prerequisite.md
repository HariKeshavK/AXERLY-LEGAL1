# P6 — Onboarding prerequisite audit (blocked)

Date: 2026-09-24

## Outcome

P6's stated first-run premise is false in the current app. The P6 plan says creation runs after the L-C license step, but `backend/src/app.ts` and `backend/src/middleware/routeSecurity.ts` have no activation or verified-license route, and `backend/src/modules/auth/auth.routes.ts` still has only the development bootstrap. The P5 `firm_settings` row contains nullable reserved join-credential fields but no generated credentials or licensed setup path.

The locked architecture requires the backend to reject first-firm creation until it has verified a successful license activation. Implementing P6's production creator before that gate would violate the requirement. P6's plan and L-C's stated order form a dependency cycle: P6 says it follows L-C's license step, while L-C says it follows P6's wizard flow. This needs a revised sequence, such as building the license gate and a minimal setup flow together, before the remaining P6 admin/join work.

After the user selected ES256, `backend/src/licensing/licenseToken.ts` added isolated **public-key verification only** for the license-token contract. It does not embed the Supabase Auth JWKS, enable setup, contact Supabase, or sign anything. The app remains fail-closed because no production firm-creation route exists. No AXERLY license-specific public key has yet been supplied. The supplied P-256 JWKS belongs to Supabase Auth and cannot verify tokens signed by a separate license Edge Function.

The separate repository `HariKeshavK/axerly-legal-license-code-pvt` was cloned into an ignored nested `licensing-server/` checkout. Its ES256 Edge Function, key scripts, tests, README, and transactional activation-slot RPC are in that private repository, not staged in the public app. Making the code repository private does not affect deployed functions or installed apps; those depend on the HTTPS function endpoint and public verification key. This has **not been deployed** or exercised against the live Supabase database.

## Files touched

- `backend/src/licensing/licenseToken.ts` and `backend/src/licensing/__tests__/licenseToken.test.ts` (ES256 verifier and tests); `.gitignore` (exclude nested private repository); this report.
- Private repository only: `licensing-server/supabase/functions/license/*`, `licensing-server/sql/001_reserve_activation.sql`, `licensing-server/scripts/*`, `licensing-server/tests/*`, `licensing-server/README.md`, and `licensing-server/package.json`.
- The completed P0–P5 series was fast-forwarded into local `main`, reconciled with GitHub's P3 merge commit, and pushed to GitHub `main` at `8a14996` before this prerequisite was identified.

## Tests

- P5's final verification is recorded in `docs/reports/P5-single-firm-teams.md`: backend 2,233 passed and two pre-existing Windows fixture failures; frontend 1,566 passed; typechecks passed; lint had zero errors and 29 pre-existing warnings.
- Focused app-side ES256 verifier tests: 4 passed. Backend build and test typecheck passed. The later full backend run had 2,236 passed, two pre-existing Windows fixture failures, and one unrelated dynamic-import hook timeout in the Sentry test. The Sentry test and verifier were rerun together afterward and passed 5/5.
- Private license service tests: 5 passed using a faithful in-memory repository and Web Crypto; TypeScript typecheck passed. The Deno/Supabase CLI was not installed locally, so the Edge entry point and SQL RPC require a deployment smoke test.
- Frontend typecheck passed; frontend lint had 0 errors and the same 29 pre-existing warnings. No frontend source was changed.

## Open issue

- User L-A actions still required: run `licensing-server/sql/001_reserve_activation.sql` after the Appendix A tables, generate a **separate P-256/ES256 keypair** with the private repo's `npm run gen-keys`, set the private JWK and `IP_HASH_SALT` as Edge Function secrets, deploy with `--no-verify-jwt`, issue a test license, and provide only the generated public JWK to the app. The Supabase Auth JWKS is unrelated. The additional SQL RPC was introduced to enforce activation limits atomically.
- Wire license activation and the hard backend setup gate before implementing P6's production firm creation. Until then the production creation route must remain unavailable.
- No Supabase secret, service-role key, or signing private key belongs in this repository. The original plan's Ed25519/EdDSA wording in L-A/L-B/L-C/A.5 must be treated as superseded by the user's ES256 decision.

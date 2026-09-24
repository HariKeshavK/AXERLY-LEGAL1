# P6 — Onboarding prerequisite audit (blocked)

Date: 2026-09-24

## Outcome

P6 implementation was not started because its stated first-run premise is false in the current app. The P6 plan says creation runs after the L-C license step, but `backend/src/app.ts` and `backend/src/middleware/routeSecurity.ts` have no activation or verified-license route, and `backend/src/modules/auth/auth.routes.ts` still has only the development bootstrap. No `LICENSE_API_URL`, `LICENSE_PUBLIC_KEY`, license activation, or license validation implementation exists under `backend/src` or `frontend/src`. The P5 `firm_settings` row contains nullable reserved join-credential fields but no generated credentials or licensed setup path.

The locked architecture requires the backend to reject first-firm creation until it has verified a successful license activation. Implementing P6's production creator before that gate would violate the requirement. P6's plan and L-C's stated order form a dependency cycle: P6 says it follows L-C's license step, while L-C says it follows P6's wizard flow. This needs a revised sequence, such as building the license gate and a minimal setup flow together, before the remaining P6 admin/join work.

## Files touched

- This report only. No application code, migration, or tests were changed for P6.
- The completed P0–P5 series was fast-forwarded into local `main`, reconciled with GitHub's P3 merge commit, and pushed to GitHub `main` at `8a14996` before this prerequisite was identified.

## Tests

- P5's final verification is recorded in `docs/reports/P5-single-firm-teams.md`: backend 2,233 passed and two pre-existing Windows fixture failures; frontend 1,566 passed; typechecks passed; lint had zero errors and 29 pre-existing warnings.
- No P6 tests were added or run because no P6 code was changed.

## Open issue

- Decide whether to reorder L-C ahead of P6 or combine the minimal licensed activation gate with P6 setup. Only the Ed25519 public verification key is needed in the app; no Supabase secret, service-role key, or signing private key belongs in this repository.

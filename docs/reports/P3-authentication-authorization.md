# P3 — Local authentication and central authorization

Date: 2026-09-24

## Outcome

AXERLY now has local email/password authentication backed directly by PostgreSQL. Public registration, external identity-provider login, email-link confirmation/recovery, and the Word add-in authentication dialog were removed. Production exposes only login plus the explicitly public health and manifest-key endpoints. Development additionally exposes a one-time first-user bootstrap; P6 will replace it with licensed organization creation and join flows.

Authorization uses the central `backend/src/lib/authz.ts` entry point. RLS remains removed for the reason recorded in P2: upstream application traffic bypassed it and the policy set was incomplete, so retaining it was not cheap defense-in-depth. A default-deny middleware authenticates every route unless its exact method/path appears in the public allowlist.

## What changed

- Added migration `backend/db/migrations/0002_local_auth.sql`. It renames `auth_sessions` to `sessions`, adds idle/absolute expiry, last-seen and CSRF hashes, adds persistent account lockout fields, atomically guards development bootstrap, revokes sessions after password/role/status changes, and drops the obsolete authentication-handoff table.
- Rebuilt `backend/src/lib/localAuth.ts` around salted Node `scrypt`, a 12-character minimum, opaque random tokens stored only as HMAC hashes, session-bound CSRF hashes, generic login errors, five-attempt/15-minute account lockout, and idle plus absolute expiry.
- Authentication cookies are `Secure`, `SameSite=Lax`, path `/`; the session cookie is `HttpOnly`. The readable CSRF cookie is matched in constant time against the request header and the session's stored hash.
- Added IP and normalized-account login throttles, trusted-origin checks, and CSRF validation for every authenticated unsafe request.
- Implemented `/auth/login`, `/auth/logout`, `/auth/me`, `/auth/session` compatibility, direct authenticated email/password changes, and development-only `/auth/dev/bootstrap`. There is no `/auth/signup` route.
- Added central `can(user, action, resource)` authorization while preserving existing project-capability checks through the same public boundary.
- Added `authenticationBoundary` and the explicit public route allowlist. The route-inventory test proves the boundary is mounted before every Express route and that registration is not public.
- Removed the web and Word add-in registration, external-provider, SSO, callback, handoff, password-email recovery, and confirmation UI/code paths, plus obsolete environment variables and deployment instructions.
- Added CSRF propagation to the web API wrapper and Word add-in session client.

## Principal files touched

- `backend/db/migrations/0002_local_auth.sql`
- `backend/src/lib/{localAuth,authSession,authz}.ts`
- `backend/src/middleware/{auth,routeSecurity}.ts`
- `backend/src/modules/auth/{auth.routes,auth.service}.ts`
- `backend/src/app.ts`
- `frontend/src/app/lib/{authApi,authEvents}.ts`
- `frontend/src/app/login/page.tsx`
- `frontend/src/app/contexts/AuthContext.tsx`
- `word-addin/src/taskpane/auth/{session,useAuth,LoginPage}.tsx`
- `word-addin/webpack.config.js`
- Authentication pages/components and obsolete handoff/SSO modules were deleted.

## Tests added or updated

- Real bundled-PostgreSQL integration tests for one-time bootstrap, login, logout, idle/absolute expiry, password/role/removal revocation, CSRF binding, and account lockout.
- Cookie attribute test for `HttpOnly`, `Secure`, and `SameSite=Lax` behavior.
- Central authorization policy tests.
- Route-inventory/default-deny tests.
- Frontend API tests for `/me`, password login, and CSRF propagation.
- Updated login, auth context, settings, CORS, and unauthenticated-route regression tests.

## Verification

- Backend build: passed.
- Backend test typecheck: passed.
- Focused backend authentication/security suite: 41 passed, including the one-time bootstrap and central-authz tests.
- Frontend typecheck: passed.
- Full frontend suite: 1,566 passed across 204 files.
- Frontend lint: passed with 29 pre-existing warnings and no errors.
- Word add-in app and E2E typechecks: passed after installing its locked dependencies.
- Full backend suite: 2,225 passed across 179 files. The same two pre-existing Windows/tooling failures remain: the extensionless fake `soffice` fixture cannot spawn on Windows, and the PDF integration fixture extracts no text in this environment.
- Search across active source and operational docs (excluding the immutable `backend/schema.sql` baseline and historical assessment/reports) finds no Supabase Auth, application Google login, magic-link, email-confirmation, SSO, or authentication-handoff implementation.

## Open issues

- P6 must replace `/auth/dev/bootstrap` with the licensed create/join organization flow.
- First-party MFA is not implemented. Existing feature-level MFA gates currently degrade to no additional challenge; decide and implement a local MFA design separately if required for beta.
- The immutable `0001` baseline still contains the old handoff-table definition; migration `0002` immediately drops it. Editing `0001` would break checksum validation for existing installations.

# P5 — Single firm with many teams

Date: 2026-09-24

## Outcome and design decision

The existing `organizations` row is now the **one firm** for an installation. A database unique index prevents a second row, including through concurrent requests or direct SQL. The production multi-org creation and firm deletion routes are gone; a development-only initial-firm route remains until P6's licensed setup replaces it. A separate `firm_settings` row holds the display name and reserved columns for the future join code and password hash. These credentials are not generated in P5.

The former Organization entity was **not** renamed to Team. The upstream organization ID is a load-bearing tenant/ownership key throughout Projects, Library documents, sharing, and access overrides. Repurposing it would risk expanding access to private firm content. Instead, `teams` and `team_members` are separate tables under the single firm. A user may belong to any number of teams; team membership alone does not grant access to existing resources. This follows the assessment's access-preserving recommendation and the user's approval, although it differs from the literal P5 wording.

Firm admins can create, rename and delete teams and manage their members. Firm members can see the team list and membership but cannot mutate it. These decisions use the central `authz` module; missing or unauthorized teams return 404. The frontend now shows one firm and a Teams management tab, with multi-organization creation and firm deletion controls removed. Existing document and Project sharing rules were not altered.

## Files touched

- Schema: `backend/db/migrations/0004_single_firm_teams.sql`.
- Firm and authorization services/routes: `backend/src/lib/{authz,orgs}.ts`, `backend/src/modules/orgs/{orgs.routes,orgs.service}.ts`, `backend/src/modules/user/{user.account,user.dataCleanup}.ts`, `backend/src/app.ts`.
- Teams API: `backend/src/modules/teams/{teams.routes,teams.service}.ts`.
- Frontend: `frontend/src/app/lib/mikeApi.ts`, `frontend/src/app/components/organizations/{TeamManagement,OrganizationWorkspace,OrganizationModals,OrganizationsOverview}.tsx`.
- Tests: `backend/src/modules/teams/__tests__/*`, `backend/src/lib/__tests__/{authz,userDataCleanup.orgs}.test.ts`, `backend/src/__tests__/integration/{orgs,user}.routes.test.ts`, and organization component tests.
- Documentation: this report and `docs/FOLLOWUPS.md`.

## Tests and verification

- Before changes: backend build/test typecheck and frontend typecheck passed; frontend lint had 0 errors and 29 warnings; frontend tests passed. The backend already had two Windows fixture failures (`convertTimeout.test.ts`, `pdfText.integration.test.ts`).
- After changes: backend build and test typecheck passed; frontend typecheck passed. Frontend lint: 0 errors, 29 pre-existing warnings. Frontend full suite: 1,566 passed.
- Backend final full suite: **2,233 passed, 2 failed**. Both failures are the pre-existing Windows fixture failures above. A focused rerun of the affected routes, local auth, and team tests passed **113/113**. An earlier parallel run hit a transient Windows lock while deleting an embedded-Postgres test log; the final full run did not reproduce it.
- New real-Postgres tests cover the single-firm database constraint, settings-name sync, multi-team membership, admin CRUD, denied member/outsider operations, and cascade removal when a user leaves the firm. Route and frontend tests cover the new API/UI. The unchanged sharing/authz tests passed in the full backend run.

## Open issues

- `0004` preserves an existing zero- or one-organization installation. It intentionally aborts when legacy data contains multiple organizations. Automatically merging those tenants would expose private content; a separately reviewed migration is required for such installations.
- P6 must implement the licensed first-run firm creation and join credentials. No production firm can be created through the removed multi-org route until P6 is complete.
- P7 must implement union-of-teams model grants and explicit team sharing. This prompt establishes membership only; no team-based model or content entitlement has been added.
- Existing Windows office/PDF fixture failures and intermittent embedded-Postgres log cleanup locking remain outside P5. No `.exe` is delivered here.

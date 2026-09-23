# P0 — Standing project instructions

Date: 2026-09-23

## What changed

- Added repository-level instructions covering AXERLY's product definition, locked architecture, security invariants, AGPL handling, rebranding requirements, and working rules.
- Established this change on its own branch and commit series.

## Files touched

- `AGENTS.md` — added the standing instructions for all future work.
- `docs/reports/P0-standing-instructions.md` — added this task report.

## Tests added

- None. This change contains documentation only.

## Verification

- Before: tests, lint, and typecheck were unavailable because the repository contained no application source or package configuration.
- After: tests, lint, and typecheck remain unavailable for the same reason.

## Open issues

- The upstream AXERLY/Mike source has not yet been imported, so its AGPL license and any section 7 attribution terms have not yet been inspected in this repository.

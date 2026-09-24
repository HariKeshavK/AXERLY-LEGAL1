# AXERLY — Standing Instructions

These instructions apply to every task in this repository.

## What this is

AXERLY is a legal AI tool for one law firm. Lawyers chat with an AI grounded in their own documents, organized into a shared Library and Projects. It is a fork of an AGPL-3.0 open-source legal-AI product (upstream codename "Mike", <https://github.com/Open-Legal-Products/mike>). One install equals one firm. Users are grouped into "teams" only for permissioning (model access, and as a share target).

## Architecture (locked)

- Windows desktop app (Electron). Same installer for everyone.
- First launch asks: **Create an organization** or **Join an organization**. Creating requires a valid AXERLY license key, validated against AXERLY's own license server (a separate Supabase project we own; the app itself does not use Supabase). Joining never needs a key; the host's license governs and enforces the seat limit.
- Licensing is enforced by the backend, not just the UI, and degrades to read-only. It never blocks login, viewing, export, or backup of the firm's own data.
- Host mode: Electron main starts embedded Postgres (`127.0.0.1`, random port) and the Express backend, which serves the API and the frontend over HTTPS on the LAN port. Client mode: a thin shell pinned to the host's TLS public key.
- No Supabase, RustFS, Mailpit, Docker, or external DB. Own auth (hashed passwords, server-side sessions).
- Files live only on the host disk, AES-256-GCM envelope-encrypted, served only through the authenticated API after an authorization check.
- Built-in dark mode is the default theme.

## Security invariants

- Deny by default. Every route requires auth unless explicitly listed as public. All access decisions go through the central `authz` module.
- Enforce on the server. Hiding UI is never access control.
- Return 404 (not 403) for resources the caller may not know exist.
- No plaintext user files on disk, no secrets in the repo, logs, or client responses.
- Provider API keys are write-only from the UI and encrypted at rest.
- Model calls only via the single gated provider module.
- The license server's service-role key, the token-signing private key, and any Supabase credentials never appear in this repo, the installer, logs, or the client. The app holds only the license API URL and the public verification key.

## Legal (AGPL-3.0)

This is not legal advice; have counsel review before distributing.

Keep, never touch or delete:

- Original copyright/license headers in files we did not write. If we modify a file, add a line saying AXERLY modified it plus the date; never remove the original notice.
- The full `LICENSE`/`COPYING` (AGPL-3.0) at the repository root, and any `NOTICE` or third-party license files.
- One in-app **Source** link (About/Legal page and footer) to AXERLY's canonical repository, using the single config constant `AXERLY_SOURCE_URL`.

Rebrand everywhere: "Mike" to "AXERLY" in UI strings, titles, icons, README, docs, package names, and errors.

Delete rather than rename:

- Links to `github.com/open-legal-products/mike`.
- Upstream author names, links, and bios in UI or marketing copy.
- "Powered by Mike" credits.

Before deleting any author credit, read upstream's `LICENSE` for additional AGPL section 7 terms that require attribution. If any exist, keep those credits and report it.

The AXERLY license check gates setup and continued use of the official build. Never describe it as a restriction on AGPL rights, and never remove or obscure the AGPL notices or the Source link because of it. Flag licensing-related wording for counsel.

## Working rules

- One prompt equals one branch/commit series. Run tests, lint, and typecheck before and after. Never leave the repository red without saying so.
- Write a report for each prompt in `docs/reports/Pn-*.md`: what changed, files touched, tests added, and open issues.
- If a prompt's premise is false in the actual code, stop and report instead of improvising.
- No scope creep. Note follow-ups in `docs/FOLLOWUPS.md`.
- Windows-first: no Bash-only scripts in runtime paths; use `path`/`os` APIs; no native npm modules without prebuilt Windows x64 binaries.
- Never commit secrets, default credentials, or `.env` files. `.env.example` lists variable names only.

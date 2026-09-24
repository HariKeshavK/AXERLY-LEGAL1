<!-- AXERLY modified 2026-09-24. -->
# Local development

The recommended local setup uses Docker Compose to run the application and its
infrastructure together. No managed Supabase project or object-storage account
is required.

The stack includes:

- the Mike frontend and backend;
- Supabase Postgres, Auth, data API, and gateway;
- RustFS for S3-compatible object storage; and
- Mailpit for local authentication email.

The database schema loads automatically on first boot.

## Start the Docker stack

Copy the local environment templates:

```bash
cp .env.example .env
cp backend/.env.example backend/.env
```

Edit `backend/.env`:

- Set `DOWNLOAD_SIGNING_SECRET` and `USER_API_KEYS_ENCRYPTION_SECRET` to
  separate values generated with `openssl rand -hex 32`.
- Add an Anthropic, Gemini, or OpenAI API key, unless you plan to use Ollama
  exclusively.

Docker Compose supplies the local Supabase and object-storage settings, so
leave those values unchanged. Then start the stack:

```bash
docker compose up --build
```

Open [http://localhost:3000](http://localhost:3000) and sign up.

## Local service endpoints

| Service | Address | Notes |
| --- | --- | --- |
| Mike | `http://localhost:3000` | Main application |
| Supabase API | `http://localhost:54321` | Auth and data API gateway |
| Postgres | `localhost:54322` | Host access for database tools |
| RustFS console | `http://localhost:9001` | `rustfsadmin` / `rustfsadmin` |
## Local authentication

Start embedded PostgreSQL with `npm run dev:db --prefix backend`. In a
development build, create the first administrator once through
`POST /auth/dev/bootstrap` using an email and a password of at least 12
characters. The endpoint disappears in production and returns 404 after the
first account exists. There is no public registration or email-link flow.

## Local models with Ollama

[Ollama](https://ollama.com) models are discovered dynamically. Anything shown
by `ollama list` appears in Mike's model pickers under **Local**, without an API
key.

The Dockerized backend reaches Ollama on the host at
`http://host.docker.internal:11434/v1`. Override `OLLAMA_BASE_URL` if Ollama is
available elsewhere.

Choose a model that fits the host's available memory, pull it, then refresh
Mike. Replace `MODEL_TAG` with a tag from the Ollama library:

```bash
ollama pull MODEL_TAG
```

Models with tool-calling support can drive the full assistant. If a local model
rejects tools, Mike retries without them so plain chat can continue. Model size
has a significant effect on speed and memory use, especially during tabular
review where the model may run across many cells.

## First run

1. Sign up in the app.
2. If no provider key is configured in `backend/.env`, open
   **Settings > API Keys** and add one.
3. To use live US case-law tools, add a CourtListener token in `backend/.env`
   or under **Settings > API Keys**.
4. Create or open a project and start chatting with documents.

Use synthetic or public documents until you have reviewed the deployment and
data flows. See [Safe local testing](safe-local-testing.md) for guidance.

## Error tracking locally

Error reporting is enabled by default using Mike's community Sentry project.
Set `SENTRY_DISABLED=true` to opt out on the backend, and use
`NEXT_PUBLIC_SENTRY_DISABLED=true` or `REACT_APP_SENTRY_DISABLED=true` for the
web app or Word add-in. To watch events locally instead, run
`node scripts/sentry-sink.mjs` and point each runtime's DSN at it; see
[observability.md](observability.md).

## Running application code without Docker

To run the frontend and backend processes directly while using separately
configured infrastructure, follow [Manual and production deployment](deployment.md)
through environment setup and dependency installation. Then start each package
in a separate terminal:

```bash
npm run dev --prefix backend
```

```bash
npm run dev --prefix frontend
```

Open [http://localhost:3000](http://localhost:3000).

For common setup problems, see [Troubleshooting](troubleshooting.md).

# Family Gift Exchange

A phone-first family Christmas gift exchange being built with a blind draw and shared wishlists in English and Spanish. This branch contains the phase 0 foundation: a bilingual home page, database schema, and captured message outbox. The family exchange workflows are planned for later phases.

## Run locally

Use Node from `.nvmrc`, pnpm from `package.json`, and Docker Compose.

```sh
nvm use
pnpm install --frozen-lockfile
docker compose up -d --wait postgres
cp .env.example .env.local
```

Set `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/family_gift_exchange` in `.env.local` for this local database. Leave the remaining variables empty.

```sh
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Open [the local app](http://localhost:3000) or [captured messages](http://localhost:3000/dev/messages). Seeding adds five fictional practice families and can be run again.

## Test

```sh
pnpm exec playwright install chromium webkit
pnpm test:all
```

On Linux, add `--with-deps` to the browser install if system libraries are needed. The integration tests use the local Postgres database. Playwright builds and starts the app in production mode on port 3100.

See [Architecture](docs/architecture.md) for module ownership, database access, and migration conventions.

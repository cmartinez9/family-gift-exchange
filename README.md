# Family Gift Exchange

A phone-first family Christmas gift exchange being built with a blind draw and shared wishlists in English and Spanish. Organizers can create a family, add the people who will take part, and give each person a private sign-in key. Members return with Face ID or a four-digit PIN.

## Run locally

Use Node from `.nvmrc`, pnpm from `package.json`, and Docker Compose.

```sh
nvm use
pnpm install --frozen-lockfile
docker compose up -d --wait postgres
cp .env.example .env.local
```

Set `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/family_gift_exchange` in `.env.local` for this local database. Generate separate random values for `AUTH_SECRET` and `ORGANIZER_INVITE_CODE` (for example, run `openssl rand -hex 32` separately for each). Keep the auth secret stable across deployments. Give the organizer invitation code only to people the app owner invites to create a family.

```sh
pnpm db:migrate
pnpm db:seed
pnpm dev --experimental-https
```

Set `AUTH_ORIGIN=https://localhost:3000` for this local HTTPS server. Open [the local app](https://localhost:3000) or [captured messages](https://localhost:3000/dev/messages). Seeding adds five fictional practice rosters. Create a new family with the organizer invitation code to practice the full sign-in flow.

On Vercel, set `AUTH_ORIGIN` to the canonical HTTPS address members use. This sets the origin for personal links and the scope of passkeys. To check sharing on a real phone, use a practice family and send keys only to test recipients.

## Test

```sh
pnpm exec playwright install chromium webkit
pnpm test:all
```

On Linux, add `--with-deps` to the browser install if system libraries are needed. The integration tests use the local Postgres database. Playwright uses the same database, builds the production app, and serves it over HTTPS on port 3100. It uses OpenSSL to create a temporary local certificate and generates its own organizer invitation code.

See [Architecture](docs/architecture.md) for module ownership, database access, and migration conventions.

## Organizer recovery

A co-organizer can prepare and share a new key for the organizer from Send keys. An operator can also run `pnpm admin:organizer-key <family-id>` with `DATABASE_ADMIN_URL`, `AUTH_SECRET`, and `AUTH_ORIGIN` set for that deployment. The command prints a private recovery link; give it directly to the organizer.

Opening or sharing a replacement key leaves reset requests open. Redeeming it closes the requests, replaces the PIN, signs out all other sessions for that name, and revokes its existing passkeys. The person can then enroll Face ID again. Reporting a used key records the time and reporting device in account and organizer activity without granting access or changing any session. Phase 2 can read these records through `listKeyDisputes`.

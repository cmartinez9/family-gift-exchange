# Family Gift Exchange

A phone-first family Christmas gift exchange being built with a blind draw and shared wishlists in English and Spanish. Organizers can create a family, add the people who will take part, and give each person a private sign-in key. Members return with Face ID or a four-digit PIN.

## Join and return

Choose **Start a family exchange** with an organizer invitation code from the app owner. Creating the family adds the organizer as a participant. In **Manage my family**, add the other people, households, and any pairs to keep apart in the future draw. You can appoint one co-organizer to help manage the family and prepare keys. For someone without their own device, assign a relative as their helper before they join; the relative signs in as themselves and switches to that person's profile under **People you help**.

From **Send keys**, prepare each person's private message, show a QR code in person, or print a key card. Share privately through your phone's share menu or WhatsApp. Cards include a family address and a six-character code for anyone who prefers typing to scanning. Open the key on the person's own device, confirm their name, and choose a four-digit PIN that avoids dates, years, and easy patterns. Face ID setup is offered immediately afterward; the device may use a fingerprint or screen lock instead.

After joining, return through the app address, the original message, or a home-screen icon. The same browser remembers the family; choose your name and PIN or use Face ID. On a browser that does not remember the family, paste the family sign-in address or private key link from the organizer. A used key leads back to sign-in. Use **Switch person or sign out** before someone else signs in on a shared device.

Review **Sign-in activity** for key use, new devices, and replacement keys. Use **That wasn't me** for activity you do not recognize; see [Account recovery](#account-recovery) for the effects of reporting access.

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

## Account recovery

For a forgotten PIN, choose your name, open **Forgot my PIN**, and select **Ask the organizer for a new key**. The request appears in the family's management screen. An organizer or co-organizer confirms with the person, then prepares and privately shares a replacement from **Send keys → Reset PIN**. Face ID sign-in also offers **Make a new PIN** for an account that does not require a fresh key. Repeated wrong PIN guesses temporarily lock PIN sign-in. If PIN sign-in on new devices is blocked, use Face ID, a previously used device after the temporary lock ends, or a replacement key.

Opening or sharing a replacement key leaves reset requests open. Redeeming it closes the requests, replaces the PIN, signs out all other sessions for that name, and revokes its existing passkeys. The person can then enroll Face ID again. An existing PIN remains usable until redemption unless a security report has already cleared it or restricted access.

A co-organizer can prepare a replacement for the organizer during ordinary recovery. An operator can also run `pnpm admin:organizer-key <family-id>` with `DATABASE_ADMIN_URL`, `AUTH_SECRET`, and `AUTH_ORIGIN` set for that deployment. The command prints a private recovery link; give it directly to the organizer.

A report involving current or recorded organizer or co-organizer authority signs out the entire family, including the reporter, and voids outstanding keys. Co-organizer appointments, passkey enrollments, and PINs set or changed from the earliest disputed session onward are invalidated. Credentials directly implicated in the disputed access are also revoked even if older, and the disputed administrators' PINs are cleared even if older. The organizer must recover through the operator command, then issue a new private key for a disputed co-organizer and any other account whose PIN was cleared. Other members can return with preserved PINs or unaffected Face ID; existing restrictions on new-device PIN sign-in still apply. Returning members see a notice that everyone was signed out for safety.

Reports without administrator involvement revoke linked access and unredeemed keys issued from that access, preserving earlier independent keys and credentials. Reporting a used key from its link or code without signing in only records the time and reporting device in account and organizer activity; ask the organizer for a new private key.

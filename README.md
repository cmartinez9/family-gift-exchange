# Family Gift Exchange

A phone-first family Christmas gift exchange being built with a blind draw and shared wishlists in English and Spanish. Organizers can create a family, add the people who will take part, and give each person a private sign-in key. Members return with Face ID or a four-digit PIN.

## Join and return

Choose **Start a family exchange** with an organizer invitation code from the app owner. Creating the family adds the organizer as a participant. In **Manage my family**, add the other people, households, and any pairs to keep apart in the future draw. You can appoint one co-organizer to help manage the family and prepare keys. For someone without their own device, assign a relative as their helper before they join; the relative signs in as themselves and switches to that person's profile under **People you help**.

From **Send keys**, prepare each person's private message, show a QR code in person, or print a key card. Share privately through your phone's share menu or WhatsApp. Cards include a family address and a six-character code for anyone who prefers typing to scanning. Open the key on the person's own device, confirm their name, and choose a four-digit PIN that avoids dates, years, and easy patterns. Face ID setup is offered immediately afterward; the device may use a fingerprint or screen lock instead.

After joining, return through the app address, the original message, or a home-screen icon. The same browser remembers the family; choose your name and PIN or use Face ID. On a browser that does not remember the family, paste the family sign-in address or private key link from the organizer. A used key leads back to sign-in. Use **Switch person or sign out** before someone else signs in on a shared device.

Review **Sign-in activity** for key use, new devices, and replacement keys. Use **That wasn't me** for activity you do not recognize; see [Account recovery](#account-recovery) for the effects of reporting access.

## Wishlists and gifts

Open **Your list** from your account, then **Add an item** to paste a product link, upload a photo, or write an idea down. There is no per-list item limit. Links work without `https://`, and you can paste the text shared by a store app. **Preview link** fills in available product details; review them, add a note or your own photo, and choose **Save item**. If the store blocks previews or has no usable image, the item can still be saved with the store link and a photo you supply. Use **Edit item**, **Refresh preview**, **Move up**, **Move down**, or **Remove item** to maintain your list.

Choose **Edit sizes and About me** to add sizing, preferences, or allergies. These fields save when you leave each field; wait for **Saved** before navigating away. Select **No clothes, please** if you do not want clothing. The directory's **List ready** label requires at least one item. It also requires tops, bottoms (or waist and inseam), and shoe sizes with a shoe size system, unless **No clothes, please** is selected. When helping a relative, switch to their profile in **People you help**, then edit **Your list** for them.

**Family lists** lets you browse every active member's wishlist, even before a draw or for gifts outside the exchange. The directory currently lists people alphabetically; assigned-recipient highlighting awaits the draw integration. On that page, an organizer or co-organizer using their own profile can expand **Gift budget** to set one amount in US dollars for the exchange, or leave it blank for no budget.

On someone else's list, choose **I'm getting this** to reserve a gift. Other members see **Someone is getting this**, without a buyer's name. Claim marks are omitted when you view your own list; while helping someone, they are omitted on both that person's list and your own. Use **Things I'm getting** to track **Bought** and **Wrapped**, or return to the item and choose **Undo mark** to release it. Removing an item clears its mark. Removing a member releases that member's unpurchased reservations so others can claim those gifts; reservations already marked **Bought** remain in place.

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

Wishlist photos and preview images use a private Vercel Blob store when `BLOB_READ_WRITE_TOKEN` is set. Configure that token on Vercel; local filesystem storage is unavailable there. Without the token, local development uses temporary photo storage by default. Set `LIST_PHOTO_DIR` to a persistent local directory to retain images across temporary-directory cleanup; a local production server also requires this setting when no Blob token is provided. If photo storage is unavailable, photo uploads fail and link items can still be saved without preview images. Photo access goes through signed-in, family-scoped app routes.

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

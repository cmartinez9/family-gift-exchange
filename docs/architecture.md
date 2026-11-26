# Family Gift Exchange v2 architecture

## Module ownership

| Phase | Server entry point | Owns |
| --- | --- | --- |
| 1 | `src/server/auth/index.ts` | Sign-in, session identity, family membership, organizer and helper authorization |
| 2 | `src/server/draw/index.ts` | Constraints, draw, sealed assignments, reveal, repair, and routing questions to the assigned recipient |
| 3 | `src/server/lists/index.ts`, `link-preview/index.ts`, `claims/index.ts` | Wishlists, sizes, About me, link previews, item photos, exchange budget, and claim visibility |
| 4 | `src/server/messages/index.ts` | Message templates, queue, delivery adapters, and reminders |
| Shared | `src/app`, `src/i18n`, `src/server/db` | Routing, locale setup, database connection, and shared tables |

Use named exports for domain modules and default exports where framework or tool conventions require them. Use kebab-case for file and directory names, camelCase for TypeScript fields, and snake_case for SQL. Keep domain helpers beside their entry points. Place translated routes under `src/app/[locale]`, translation messages in `messages/{en,es}.json`, and theme variables in `src/styles/tokens.css`.

## Design system

The design is "Sweater Weather". [`design/DESIGN.md`](../design/DESIGN.md) is the product rulebook. [`design/design.json`](../design/design.json) owns the exported color, typography, card, spacing, and motion tokens; the rulebook's `rounded` front matter owns the radii. `src/styles/tokens.css` exposes these to Tailwind. [`tests/unit/design-tokens.test.ts`](../tests/unit/design-tokens.test.ts) compiles the stylesheet and checks effective custom properties, including the rulebook's front-matter colors and radii.

The reusable components and motion primitives in `src/components/ui`, global tokens, self-hosted Rubik, and the [development gallery](../README.md#run-locally) are available. Live screens use them for sign-in, onboarding (`/welcome`), account (`/account`), helping from a relative's key, the helper handoff and shared helping banner, the notification inbox and device controls, home-screen installation help, family-chat messages, and the season-close confirmation and wrap. Wishlist, family-management, and draw screens retain their existing page UI. The rulebook's remaining flows, including the draw and reveal ceremonies, describe the product direction rather than completed screens.

Build screens with `Screen` for the ground, tab roots, pushed pages, and bottom actions. Links declare navigation motion with `AppLink`'s `transition` (`push`, `back`, or `tab`). The shared layout mounts `AppChrome` once for the toast and tab-bar host; the bar stays hidden until a page renders `Screen` with `tab`. The gallery's PIN demo and authentication share the pure `pinProblem` rule in [`src/lib/pin-policy.ts`](../src/lib/pin-policy.ts). Rubik is bundled in `src/styles/fonts` under the SIL Open Font License.

## Requests and data access

Keep reads in Server Components and use feature-local `actions.ts` files with `"use server"` for mutations. Treat action input as untrusted. Validate it, resolve the caller from their server session, check authorization, and pass the trusted identity into the domain module. Choose the family from that identity. Pass only explicitly selected view data back to components or action callers, and perform mutations with related writes in the same transaction.

Use `withFamily(familyId, callback)` in server modules. It sets the database role and family scope for the duration of a transaction. Qualify record lookups with `familyId` and their record IDs. PostgreSQL row-level security applies the same tenant condition to reads and writes. Keep direct connection access limited to tooling, the local message viewer, and the reminder scheduler's discovery call in [`reminders.ts`](../src/server/messages/reminders.ts). RLS covers the family boundary. Each domain module owns person-level permissions inside the family.

Wishlist transactions use [`requireListActor`](../src/server/lists/access.ts) to acquire a shared family row lock and revalidate the live session, acting profile, and organizer role before accessing list data. Edits must target the acting profile's own list. Link fetching and photo storage happen outside these transactions; the final write must repeat authorization so a session revoked during that work cannot save changes.

Sealed draw operations use `withDrawFamily`. After acquiring the family row lock shared with account and family management, it revalidates the live session and acting profile before any draw callback runs. Practice delegates also require the live organizer-owner session and its persisted practice mapping before switching family scope. The practice loader audits decryption without reconciling the owner's real draw.

Restrict pairing data to the draw module. Store only sealed recipients in assignments and questions, with their draw version. Keep the normal app role off both tables. Phase 2 owns their privileged queries, the authorized single-person reveal and question projections, and the draw and repair summaries. Only members with current access and authorization from the sealed roster can reveal. Draw checks use the rules saved with the active draw. See [Run an exchange](../README.md#run-an-exchange) for lifecycle controls and retention. Organizer screens use summaries. Use the claim identity only for internal authorization and the caller's own actions. Enforce the [documented claim visibility](../README.md#wishlists-and-gifts) in list projections before returning data to components. Send only payloads defined by the message module's [`Message` type](../src/server/messages/index.ts), keeping pairing and claim data out of message payloads.

## PostgreSQL and migrations

The `schema` setting in [`drizzle.config.ts`](../drizzle.config.ts) owns the list of Drizzle schema files. Generate a migration with `pnpm db:generate --name <change>` and commit the SQL and Drizzle metadata together. Use a custom migration for grants and policies. Give new tenant tables a `family_id`, family-scoped foreign keys, and a fail-closed policy before granting them to a request role. Phase 1 owns schema changes for credentials and the invitation mechanism.

For deployments, `DATABASE_URL` should connect as a runtime login allowed to assume `fge_app`, with neither table ownership nor RLS bypass. Use `DATABASE_ADMIN_URL` for migrations, with privileges to manage the schema and role. For local Compose and CI, the disposable database owner can run migrations and assume the same `fge_app` role that application queries use. The local viewer uses that local owner connection to inspect the latest 100 captured rows across practice families.

`DRAW_DATABASE_URL` connects as a separate login allowed to assume `fge_draw`. Give that login and the app login only their respective request roles. Keep table ownership and RLS bypass on the migration connection. For disposable local databases, the draw connection can use the local database owner and still explicitly assumes `fge_draw` for requests. Set `ASSIGNMENT_ENCRYPTION_KEY` to a base64-encoded 32-byte secret. Existing assignments require the key they were sealed with.

Draw notifications have an optional `DrawEvents` integration contract exported by the draw module. A publisher must queue messages using the supplied transaction so a failed enqueue rolls back the draw or repair. The app actions do not supply a publisher yet, so draws and repairs currently send no notifications. The [`DrawEvent` type](../src/server/draw/events.ts) owns public event fields. Delivery destinations are private; repair destinations stay out of organizer views and exports. Both family and exchange keep-apart editors use the draw module’s exchange-scoped operation; rules can include inactive family members without enrolling them.

## Notifications

The sender uses `VERCEL_ENV` when set and otherwise `NODE_ENV`. In production, notices enter the inbox and push delivery runs after the request commits for opted-in devices. Other environments record captured content without contacting devices. The outbox backs the in-app inbox and its read state independently of push delivery status. The `/dev/messages` viewer is available when the app runs under `pnpm dev` and returns 404 on production builds, including Vercel previews.

Set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` in production to enable device notifications. Generate the pair with `pnpm exec web-push generate-vapid-keys` and set the subject to the public HTTPS app origin. Set `CRON_SECRET` in Vercel so it sends the bearer header to `/api/cron/notifications`. The daily schedule is defined in [`vercel.json`](../vercel.json). The job queues reminders a day before the list deadline and gift day using the America/Chicago calendar. It also processes pending pushes and retries.

The default [`ListEvents` adapter](../src/server/lists/list-events.ts) and sign-in PIN reset flow call the [`event hooks`](../src/server/messages/events.ts) in the originating transaction. The draw hooks await Phase 2 integration.

## Disputed-reveal recovery

Draw access consumes sign-in's recorded set of affected sessions before returning sealed data. [`privateDrawRepair`](../src/server/draw/store.ts) first searches in increasing order of changed givers for replacements of exposed recipients that remain ambiguous to each organizer represented in the sealed roster. Each organizer is considered separately, including their own and helper-managed assignments, the change count, public opened count, visible question retention, and the public one-loop result. Their own and helper-managed matches are not secrets from them. Organizer knowledge is not pooled.

If no outcome passes that per-organizer check, recovery prioritizes access: it tries a repair without the ambiguity constraint, then an ordinary valid draw. These fallbacks preserve the draw rules but may make an exposed person's replacement inferable in a small or constrained group. The confirmed full redraw uses the same recovery boundary for pending disputes. The four-person recovery, six-person disputed-organizer case, and organizer-inference regressions are covered in [`tests/integration/draw.test.ts`](../tests/integration/draw.test.ts).

Sealed access stays blocked if reconciliation fails or times out; account activity remains available. Opening evidence is invalidated only when the actual recipient changes, including across full redraws, while its history remains available. Organizer management shows a generic disputed-reveal repair notice without identifying affected people. See [Account recovery](../README.md#account-recovery) for reporting and recovery controls.

## Tests

- Put pure tests in `tests/unit`. Use fast-check for invariants that need many generated inputs.
- Put database behavior in `tests/integration`. Apply real migrations, use `withFamily` for runtime queries, and use isolated synthetic fixtures. Test permission failures through the actual transaction.
- Put user workflows in `tests/e2e`. Use mobile Chromium and WebKit, separated browser contexts for different people, and axe for accessibility.
- `tests/e2e/design.spec.ts` checks gallery interactions, accessibility, reduced motion, and narrow-viewport overflow. See [Test](../README.md#test) for the two Playwright servers and port overrides.
- `pnpm check:i18n` compares translation leaf keys in both directions. Update both catalogs with every new user-facing key.

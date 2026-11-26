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

This phase supplies the reusable components and motion primitives in `src/components/ui`, global tokens, self-hosted Rubik, and the [development gallery](../README.md#run-locally). Live sign-in, wishlist, and family flows retain their existing page UI; adopting the components belongs to later work in each area. The rulebook's full flows, including the draw and key-opening ceremonies, describe the product direction rather than completed screens.

Build screens with `Screen` for the ground, tab roots, pushed pages, and bottom actions. Links declare navigation motion with `AppLink`'s `transition` (`push`, `back`, or `tab`). The shared layout mounts `AppChrome` once for the toast and tab-bar host; the bar stays hidden until a page renders `Screen` with `tab`. The gallery's PIN demo and authentication share the pure `pinProblem` rule in [`src/lib/pin-policy.ts`](../src/lib/pin-policy.ts). Rubik is bundled in `src/styles/fonts` under the SIL Open Font License.

## Requests and data access

Keep reads in Server Components and use feature-local `actions.ts` files with `"use server"` for mutations. Treat action input as untrusted. Validate it, resolve the caller from their server session, check authorization, and pass the trusted identity into the domain module. Choose the family from that identity. Pass only explicitly selected view data back to components or action callers, and perform mutations with related writes in the same transaction.

Use `withFamily(familyId, callback)` in server modules. It sets the database role and family scope for the duration of a transaction. Qualify record lookups with `familyId` and their record IDs. PostgreSQL row-level security applies the same tenant condition to reads and writes. Keep direct connection access limited to tooling, the local message viewer, and the reminder scheduler's discovery call in [`reminders.ts`](../src/server/messages/reminders.ts). RLS covers the family boundary. Each domain module owns person-level permissions inside the family.

Restrict pairing data to the draw module. Store only sealed recipients in assignments and questions, with their draw version. Keep the normal app role off both tables. Phase 2 owns their privileged queries, the authorized single-person reveal and question projections, and the draw and repair summaries. Organizer screens use summaries. Use the claim identity only for internal authorization and the caller's own actions. Enforce the [documented claim visibility](../README.md#wishlists-and-gifts) in list projections before returning data to components. Send only payloads defined by the message module's [`Message` type](../src/server/messages/index.ts), keeping pairing and claim data out of message payloads.

## PostgreSQL and migrations

The `schema` setting in [`drizzle.config.ts`](../drizzle.config.ts) owns the list of Drizzle schema files. Generate a migration with `pnpm db:generate --name <change>` and commit the SQL and Drizzle metadata together. Use a custom migration for grants and policies. Give new tenant tables a `family_id`, family-scoped foreign keys, and a fail-closed policy before granting them to a request role. Phase 1 owns schema changes for credentials and the invitation mechanism.

For deployments, `DATABASE_URL` should connect as a runtime login allowed to assume `fge_app`, with neither table ownership nor RLS bypass. Use `DATABASE_ADMIN_URL` for migrations, with privileges to manage the schema and role. For local Compose and CI, the disposable database owner can run migrations and assume the same `fge_app` role that application queries use. The local viewer uses that local owner connection to inspect the latest 100 captured rows across practice families.

## Notifications

The sender uses `VERCEL_ENV` when set and otherwise `NODE_ENV`. In production, notices enter the inbox and push delivery runs after the request commits for opted-in devices. Other environments record captured content without contacting devices. The outbox backs the in-app inbox and its read state independently of push delivery status. The `/dev/messages` viewer is available when the app runs under `pnpm dev` and returns 404 on production builds, including Vercel previews.

Set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` in production to enable device notifications. Generate the pair with `pnpm exec web-push generate-vapid-keys` and set the subject to the public HTTPS app origin. Set `CRON_SECRET` in Vercel so it sends the bearer header to `/api/cron/notifications`. The daily schedule is defined in [`vercel.json`](../vercel.json). The job queues reminders a day before the list deadline and gift day using the America/Chicago calendar. It also processes pending pushes and retries.

The default [`ListEvents` adapter](../src/server/lists/list-events.ts) and sign-in PIN reset flow call the [`event hooks`](../src/server/messages/events.ts) in the originating transaction. The draw hooks await Phase 2 integration.

## Tests

- Put pure tests in `tests/unit`. Use fast-check for invariants that need many generated inputs.
- Put database behavior in `tests/integration`. Apply real migrations, use `withFamily` for runtime queries, and use isolated synthetic fixtures. Test permission failures through the actual transaction.
- Put user workflows in `tests/e2e`. Use mobile Chromium and WebKit, separated browser contexts for different people, and axe for accessibility.
- `tests/e2e/design.spec.ts` checks gallery interactions, accessibility, reduced motion, and narrow-viewport overflow. See [Test](../README.md#test) for the two Playwright servers and port overrides.
- `pnpm check:i18n` compares translation leaf keys in both directions. Update both catalogs with every new user-facing key.

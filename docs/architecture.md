# Family Gift Exchange v2 architecture

## Module ownership

| Phase | Server entry point | Owns |
| --- | --- | --- |
| 1 | `src/server/auth/index.ts` | Sign-in, session identity, family membership, organizer and helper authorization |
| 2 | `src/server/draw/index.ts` | Constraints, draw, sealed assignments, reveal, repair, and routing questions to the assigned recipient |
| 3 | `src/server/lists/index.ts`, `link-preview/index.ts`, `claims/index.ts` | Wishlists, sizes, About me, link preview, claim visibility, and the question interface with Phase 2 |
| 4 | `src/server/messages/index.ts` | Message templates, queue, delivery adapters, and reminders |
| Shared | `src/app`, `src/i18n`, `src/server/db` | Routing, locale setup, database connection, and shared tables |

Use named exports for domain modules and default exports where framework or tool conventions require them. Use kebab-case for file and directory names, camelCase for TypeScript fields, and snake_case for SQL. Keep domain helpers beside their entry points. Place translated routes under `src/app/[locale]`, translation messages in `messages/{en,es}.json`, and theme variables in `src/styles/tokens.css`.

## Requests and data access

Keep reads in Server Components and use feature-local `actions.ts` files with `"use server"` for mutations. Treat action input as untrusted. Validate it, resolve the caller from their server session, check authorization, and pass the trusted identity into the domain module. Choose the family from that identity. Pass only explicitly selected view data back to components or action callers, and perform mutations with related writes in the same transaction.

Use `withFamily(familyId, callback)` in server modules. It sets the database role and family scope for the duration of a transaction. Qualify record lookups with `familyId` and their record IDs. PostgreSQL row-level security applies the same tenant condition to reads and writes. Keep pool-level access limited to tooling and the local message viewer. RLS covers the family boundary. Each domain module owns person-level permissions inside the family.

Restrict pairing data to the draw module. Store only sealed recipients in assignments and questions, with their draw version. Keep the normal app role off both tables. Phase 2 owns their privileged queries, the authorized single-person reveal and question projections, and the draw and repair summaries. Organizer screens use summaries. Use the claim identity only for internal authorization and the caller's own actions. Expose anonymous claim state to other members and omit that state from the item's owner. Send only payloads defined by the message module's [`Message` type](../src/server/messages/index.ts), keeping pairing and claim data out of message payloads.

## PostgreSQL and migrations

Drizzle schemas live in `src/server/db/schema.ts` and `src/server/draw/schema.ts`. Generate a migration with `pnpm db:generate --name <change>` and commit the SQL and Drizzle metadata together. Use a custom migration for grants and policies. Give new tenant tables a `family_id`, family-scoped foreign keys, and a fail-closed policy before granting them to a request role. Phase 1 owns schema changes for credentials and the invitation mechanism.

For deployments, `DATABASE_URL` should connect as a runtime login allowed to assume `fge_app`, with neither table ownership nor RLS bypass. Use `DATABASE_ADMIN_URL` for migrations, with privileges to manage the schema and role. For local Compose and CI, the disposable database owner can run migrations and assume the same `fge_app` role that application queries use. The local viewer uses that local owner connection to inspect the latest 100 captured rows across practice families.

The sender uses `VERCEL_ENV` when set and otherwise `NODE_ENV`: `production` queues messages with status `pending`; all other environments capture them. Delivery adapters belong to Phase 4. The `/dev/messages` viewer is available when the app runs under `pnpm dev` and returns 404 on production builds, including Vercel previews.

## Tests

- Put pure tests in `tests/unit`. Use fast-check for invariants that need many generated inputs.
- Put database behavior in `tests/integration`. Apply real migrations, use `withFamily` for runtime queries, and use isolated synthetic fixtures. Test permission failures through the actual transaction.
- Put user workflows in `tests/e2e`. Use mobile Chromium and WebKit, separated browser contexts for different people, and axe for accessibility.
- `pnpm check:i18n` compares translation leaf keys in both directions. Update both catalogs with every new user-facing key.

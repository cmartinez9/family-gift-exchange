import {issueOrganizerKey} from "../src/server/auth/access";
import {authenticatorSecret} from "../src/server/auth/pin";
import {uuidPattern} from "../src/server/auth/session";
import {connectDatabase, runForFamily} from "../src/server/db/database";

async function main() {
  const [familyId, extra] = process.argv.slice(2);
  if (!familyId || extra !== undefined || !uuidPattern.test(familyId)) {
    throw new Error("Usage: pnpm admin:organizer-key <family-id>");
  }
  const databaseUrl = process.env.DATABASE_ADMIN_URL;
  if (!databaseUrl) throw new Error("DATABASE_ADMIN_URL is required for operator recovery");
  const origin = new URL(process.env.AUTH_ORIGIN ?? "");
  if (origin.protocol !== "https:" && !(origin.protocol === "http:" && origin.hostname === "localhost")) {
    throw new Error("AUTH_ORIGIN must use HTTPS or http://localhost for development");
  }
  const pepper = authenticatorSecret();
  const {db, close} = connectDatabase(databaseUrl);
  try {
    const key = await runForFamily(db, familyId, (tx) => issueOrganizerKey(tx, familyId, pepper, new Date()));
    if (key.error) throw new Error(key.error);
    const url = new URL(`/${key.language}/key/${familyId}~${key.token}`, origin).href;
    console.log(JSON.stringify({familyId, url, expiresAt: key.expiresAt.toISOString()}));
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

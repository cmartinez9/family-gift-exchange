import {migrate} from "drizzle-orm/node-postgres/migrator";
import {connectDatabase} from "../src/server/db/database";

async function main() {
  const databaseUrl = process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_ADMIN_URL or DATABASE_URL is required to migrate");
  }

  const {db, close} = connectDatabase(databaseUrl);
  try {
    await migrate(db, {migrationsFolder: "drizzle"});
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

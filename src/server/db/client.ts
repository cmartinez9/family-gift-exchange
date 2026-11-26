import "server-only";
import {connectDatabase, runForFamily, type FamilyTransaction} from "./database";

let connection: ReturnType<typeof connectDatabase> | undefined;

export function getDatabase() {
  if (!connection) {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required for database access");
    }
    connection = connectDatabase(databaseUrl);
  }
  return connection.db;
}

export function withFamily<T>(
  familyId: string,
  action: (transaction: FamilyTransaction) => Promise<T>,
): Promise<T> {
  return runForFamily(getDatabase(), familyId, action);
}

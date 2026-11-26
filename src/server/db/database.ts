import {sql} from "drizzle-orm";
import {drizzle} from "drizzle-orm/node-postgres";
import {Pool} from "pg";

export function connectDatabase(connectionString: string) {
  const pool = new Pool({connectionString, allowExitOnIdle: true});
  return {db: drizzle(pool), close: () => pool.end()};
}

type Database = ReturnType<typeof connectDatabase>["db"];
export type FamilyTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export function runForFamily<T>(
  db: Database,
  familyId: string,
  action: (transaction: FamilyTransaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (transaction) => {
    await transaction.execute(sql`SET LOCAL ROLE fge_app`);
    await transaction.execute(sql`SELECT set_config('app.family_id', ${familyId}::uuid::text, true)`);
    return action(transaction);
  });
}

import {createHash} from "node:crypto";
import {and, eq} from "drizzle-orm";
import {connectDatabase, runForFamily} from "../src/server/db/database";
import {exchanges, families, households, participants, people} from "../src/server/db/schema";
import {familySeeds} from "./seed-families";

function seedId(...parts: string[]): string {
  const hash = createHash("sha256").update(JSON.stringify(["family-gift-exchange-practice", ...parts])).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-8${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

async function main() {
  if (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production") {
    throw new Error("Seed data requires a local or test environment");
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to seed");
  }

  const {db, close} = connectDatabase(databaseUrl);
  try {
    for (const seed of familySeeds) {
      const familyId = seedId("family", seed.name);
      const practiceName = seed.language === "es" ? "Intercambio de práctica" : "Practice exchange";
      const exchangeId = seedId(familyId, "exchange", practiceName);
      const organizerId = seedId(familyId, "person", seed.households[0][0]);

      await runForFamily(db, familyId, async (transaction) => {
        await transaction.insert(families).values({
          id: familyId,
          name: seed.name,
          defaultLanguage: seed.language,
        }).onConflictDoNothing();

        for (const [index, names] of seed.households.entries()) {
          const householdName = seed.language === "es" ? `Hogar ${index + 1}` : `Household ${index + 1}`;
          const householdId = seedId(familyId, "household", String(index));
          await transaction.insert(households)
            .values({familyId, id: householdId, name: householdName})
            .onConflictDoNothing();
          await transaction.insert(people).values(names.map((displayName): typeof people.$inferInsert => {
            const id = seedId(familyId, "person", displayName);
            return {
              familyId,
              id,
              displayName,
              householdId,
              language: seed.language,
              role: id === organizerId ? "organizer" : "member",
            };
          })).onConflictDoNothing();
        }

        await transaction.update(families).set({createdBy: organizerId}).where(eq(families.id, familyId));
        for (const {person, helper} of seed.helpers ?? []) {
          await transaction.update(people).set({helperId: seedId(familyId, "person", helper)}).where(
            and(eq(people.familyId, familyId), eq(people.id, seedId(familyId, "person", person))),
          );
        }

        await transaction.insert(exchanges)
          .values({familyId, id: exchangeId, name: practiceName})
          .onConflictDoNothing();
        await transaction.insert(participants).values(seed.households.flat().map((name) => ({
          familyId,
          exchangeId,
          personId: seedId(familyId, "person", name),
        }))).onConflictDoNothing();
      });
    }
  } finally {
    await close();
  }

  console.log(`Seeded ${familySeeds.length} practice families.`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

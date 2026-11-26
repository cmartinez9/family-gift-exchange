import {randomUUID} from "node:crypto";
import {eq, sql} from "drizzle-orm";
import {afterAll, beforeAll, expect, it, vi} from "vitest";
import {withFamily} from "../../src/server/db/client";
import {families, people} from "../../src/server/db/schema";

vi.mock("server-only", () => ({}));

const familyA = randomUUID();
const familyB = randomUUID();
const personB = randomUUID();

beforeAll(async () => {
  await withFamily(familyA, async (tx) => {
    await tx.insert(families).values({id: familyA, name: "Isolation fixture A"});
  });
  await withFamily(familyB, async (tx) => {
    await tx.insert(families).values({id: familyB, name: "Isolation fixture B"});
    await tx.insert(people).values({id: personB, familyId: familyB, displayName: "Snowbit"});
  });
});

afterAll(async () => {
  for (const familyId of [familyA, familyB]) {
    await withFamily(familyId, (tx) => tx.delete(families).where(eq(families.id, familyId)).execute());
  }
});

it("lets family B read its own member and hides the same ID from family A", async () => {
  const select = (familyId: string) => withFamily(familyId, (tx) =>
    tx.select({id: people.id}).from(people).where(eq(people.id, personB)).execute()
  );

  await expect(select(familyB)).resolves.toEqual([{id: personB}]);
  await expect(select(familyA)).resolves.toEqual([]);
});

it("refuses a write into another family and a reference to a member of another family", async () => {
  await expect(withFamily(familyA, (tx) =>
    tx.insert(people).values({familyId: familyB, displayName: "Pipbit"}).execute()
  )).rejects.toMatchObject({cause: {code: "42501"}});

  await expect(withFamily(familyA, (tx) =>
    tx.insert(people).values({familyId: familyA, displayName: "Pipbit", helperId: personB}).execute()
  )).rejects.toMatchObject({cause: {code: "23503"}});
});

it.each(["assignments", "questions"])("denies the app role read access to %s", async (table) => {
  await expect(withFamily(familyA, (tx) =>
    tx.execute(sql`SELECT * FROM ${sql.identifier(table)}`)
  )).rejects.toMatchObject({cause: {code: "42501"}});
});

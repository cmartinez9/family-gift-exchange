import {randomUUID} from "node:crypto";
import {eq, sql} from "drizzle-orm";
import {afterEach, expect, it, vi} from "vitest";
import {withFamily} from "../../src/server/db/client";
import {families, outbox, people} from "../../src/server/db/schema";
import {sendMessage} from "../../src/server/messages";

vi.mock("server-only", () => ({}));

const familyId = randomUUID();
const personId = randomUUID();

afterEach(async () => {
  vi.unstubAllEnvs();
  await withFamily(familyId, (tx) => tx.delete(families).where(eq(families.id, familyId)).execute());
});

it.each([
  {deployment: "development", status: "captured"},
  {deployment: "preview", status: "captured"},
  {deployment: "production", status: "pending"},
] as const)("records a $status message in $deployment", async ({deployment, status}) => {
  vi.stubEnv("NODE_ENV", deployment === "development" ? "development" : "production");
  vi.stubEnv("VERCEL_ENV", deployment === "development" ? undefined : deployment);

  await withFamily(familyId, async (tx) => {
    await tx.insert(families).values({id: familyId, name: "Capture fixture"});
    await tx.insert(people).values({id: personId, familyId, displayName: "Bellbit"});
  });
  await sendMessage({familyId, personId, language: "es", template: "practice-reminder"});

  const channels = await withFamily(familyId, (tx) => tx.execute(sql`select unnest(enum_range(null::message_channel))::text as channel`));
  expect(channels.rows).toEqual([{channel: "push"}]);
  const messages = await withFamily(familyId, (tx) => tx.select().from(outbox).execute());
  expect(messages).toMatchObject([
    {familyId, personId, language: "es", channel: "push", template: "practice-reminder", status, sentAt: null},
  ]);
});

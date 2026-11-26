import {randomUUID} from "node:crypto";
import {and, eq} from "drizzle-orm";
import {afterEach, expect, it, vi} from "vitest";
import {requireIssuedKey} from "../helpers/issued-key";
import {withFamily} from "../../src/server/db/client";
import {families, people} from "../../src/server/db/schema";
import {disputeUsedKey, issueKey, redeemKey, signInDevice, signInWithPin, type Device} from "../../src/server/auth/access";
import {
  familyActivity, keySender, organizerName, peopleOnDevice, pinAttemptState, signedInDevices,
} from "../../src/server/auth/account";
import {createFamily, saveMember} from "../../src/server/auth/families";
import {digest, findViewer, parseSession, secret} from "../../src/server/auth/session";

vi.mock("server-only", () => ({}));

const pepper = secret();
const pin = "4268";
const cleanup = new Set<string>();
const device = (kind: Device["kind"] = "iphone"): Device => ({hash: digest(secret()), kind, network: null});

afterEach(async () => {
  for (const familyId of cleanup) {
    await withFamily(familyId, (t) => t.delete(families).where(eq(families.id, familyId)).execute());
  }
  cleanup.clear();
});

async function family() {
  const familyId = randomUUID();
  const now = new Date();
  const organizer = await withFamily(familyId, (t) => createFamily(t, {
    familyId, familyName: "Martinez family", displayName: "Christian", language: "en", pin, pepper, device: device(), now,
  }));
  cleanup.add(familyId);
  const viewer = (await withFamily(familyId, (t) => findViewer(t, parseSession(organizer.cookie)!)))!;
  const join = async (name: string, phone = device()) => {
    await withFamily(familyId, (t) => saveMember(t, viewer, null, {name, language: "en", helperId: null, householdId: null}));
    const [person] = await withFamily(familyId, (t) => t.select({id: people.id}).from(people)
      .where(and(eq(people.familyId, familyId), eq(people.displayName, name))));
    const key = requireIssuedKey(await withFamily(familyId, (t) => issueKey(t, viewer, person.id, "share", pepper, now)));
    const result = await withFamily(familyId, (t) => redeemKey(t, {
      familyId, value: key.token, typed: false, pepper, pin, confirmation: pin, device: phone, currentViewer: null, now,
    }));
    const member = (await withFamily(familyId, (t) => findViewer(t, parseSession(result.session!.cookie)!)))!;
    return {personId: person.id, keyId: key.id, token: key.token, viewer: member, phone};
  };
  return {familyId, viewer, join};
}

it("counts the tries left before the rest, then the minutes left in it", async () => {
  const {familyId, join} = await family();
  const rosa = await join("Rosa");
  const stranger = device("ipad");
  await withFamily(familyId, (t) => signInWithPin(t, familyId, rosa.personId, "1111", pepper, stranger, new Date()));
  await expect(withFamily(familyId, (t) => pinAttemptState(t, familyId, rosa.personId, new Date())))
    .resolves.toEqual({triesLeft: 4, minutes: 0});
  for (const guess of ["1112", "1113", "1114", "1115"]) {
    await withFamily(familyId, (t) => signInWithPin(t, familyId, rosa.personId, guess, pepper, stranger, new Date()));
  }
  await expect(withFamily(familyId, (t) => pinAttemptState(t, familyId, rosa.personId, new Date())))
    .resolves.toEqual({triesLeft: 0, minutes: 15});
  await expect(withFamily(familyId, (t) => pinAttemptState(t, familyId, randomUUID(), new Date()))).resolves.toBeNull();
});

it("names the organizer and the key's sender, and remembers who used this browser", async () => {
  const {familyId, join} = await family();
  const rosa = await join("Rosa");
  await expect(withFamily(familyId, (t) => organizerName(t, familyId))).resolves.toBe("Christian");
  await expect(withFamily(familyId, (t) => keySender(t, familyId, rosa.keyId))).resolves.toBe("Christian");
  await expect(withFamily(familyId, (t) => peopleOnDevice(t, familyId, rosa.phone.hash))).resolves.toEqual([rosa.personId]);
  await expect(withFamily(familyId, (t) => peopleOnDevice(t, familyId, digest(secret())))).resolves.toEqual([]);
});

it("lists only the person's own signed-in phones, the current one first", async () => {
  const {familyId, join} = await family();
  const rosa = await join("Rosa");
  await join("Beto");
  await withFamily(familyId, (t) => signInDevice(t, familyId, rosa.personId, device("ipad"), new Date(Date.now() + 1000)));
  const phones = await withFamily(familyId, (t) => signedInDevices(t, rosa.viewer, new Date()));
  expect(phones.map(({kind, current}) => [kind, current])).toEqual([["iphone", true], ["ipad", false]]);
});

it("shows family activity without naming who reset a PIN or reported a key", async () => {
  const {familyId, viewer, join} = await family();
  const rosa = await join("Rosa");
  await withFamily(familyId, (t) => disputeUsedKey(t, familyId, rosa.token, false, pepper, device("ipad"), new Date()));
  const reset = requireIssuedKey(await withFamily(familyId, (t) => issueKey(t, viewer, rosa.personId, "reset", pepper, new Date())));
  await withFamily(familyId, (t) => redeemKey(t, {
    familyId, value: reset.token, typed: false, pepper, pin: "6285", confirmation: "6285", device: rosa.phone, currentViewer: null, now: new Date(),
  }));
  const rows = await withFamily(familyId, (t) => familyActivity(t, familyId));
  expect(rows.map(({kind}) => kind).sort()).toEqual(["joined", "reset", "secondPhone"]);
  expect(rows.find(({kind}) => kind === "joined")?.name).toBe("Rosa");
  for (const row of rows.filter(({kind}) => kind !== "joined")) expect(row).not.toHaveProperty("name");
});

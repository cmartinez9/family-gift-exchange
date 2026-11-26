import {describe, expect, it} from "vitest";
import {faceIdOnDevice, signedInDevices} from "../../src/server/auth/account";
import {passkeys, sessions} from "../../src/server/auth/schema";
import type {FamilyTransaction} from "../../src/server/db/database";

const viewer = {familyId: "family", personId: "ana", actingAs: "ana", sessionId: "current", isOrganizer: false};
const now = new Date("2030-12-01T12:00:00Z");
type SessionRow = {id: string; kind: string; at: Date; deviceHash: string; passkeyId: string | null};

function activeRows(rows: SessionRow[], faces: Array<{id: string; deviceHash: string}>) {
  return {
    select: () => ({from: (table: unknown) => {
      if (table !== sessions && table !== passkeys) throw new Error("Unexpected table");
      const result = Promise.resolve(table === sessions ? rows : faces);
      return Object.assign(result, {where: () => result, orderBy: () => result});
    }}),
  } as unknown as FamilyTransaction;
}

describe("Face ID projections from active session and credential rows", () => {
  it.each([
    ["new-cookie-device", "active-key", true],
    ["enrollment-device", null, true],
    ["new-cookie-device", null, false],
    ["new-cookie-device", "revoked-key", false],
  ] as const)("recognizes device %s authenticated with %s (Face ID: %s)", async (deviceHash, passkeyId, expected) => {
    const tx = activeRows([
      {id: "current", kind: "iphone", at: now, deviceHash, passkeyId},
      {id: "other", kind: "ipad", at: now, deviceHash: "enrollment-device", passkeyId: null},
    ], [{id: "active-key", deviceHash: "enrollment-device"}]);
    const devices = await signedInDevices(tx, viewer, now);
    expect(devices.map(({id, current, faceId}) => ({id, current, faceId}))).toEqual([
      {id: "current", current: true, faceId: expected},
      {id: "other", current: false, faceId: true},
    ]);
    await expect(faceIdOnDevice(tx, viewer)).resolves.toBe(expected);
  });

  it("does not count an authenticating credential that is no longer active", async () => {
    const tx = activeRows([{id: "current", kind: "iphone", at: now, deviceHash: "enrollment-device", passkeyId: "revoked-key"}], []);
    expect((await signedInDevices(tx, viewer, now))[0].faceId).toBe(false);
    await expect(faceIdOnDevice(tx, viewer)).resolves.toBe(false);
  });

  it("does not use another session's Face ID when the current session is absent", async () => {
    const tx = activeRows([{id: "other", kind: "ipad", at: now, deviceHash: "enrollment-device", passkeyId: null}], [
      {id: "active-key", deviceHash: "enrollment-device"},
    ]);
    await expect(faceIdOnDevice(tx, viewer)).resolves.toBe(false);
  });
});

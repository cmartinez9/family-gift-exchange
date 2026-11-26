import {randomUUID} from "node:crypto";
import {beforeEach, expect, it, vi} from "vitest";
import {lockFamily} from "../../src/server/auth/access";
import {revalidateViewer} from "../../src/server/auth/session";
import type {FamilyTransaction} from "../../src/server/db/database";
import {requireListEditor} from "../../src/server/lists/access";

vi.mock("server-only", () => ({}));
vi.mock("../../src/server/auth/access", () => ({lockFamily: vi.fn()}));
vi.mock("../../src/server/auth/session", () => ({revalidateViewer: vi.fn()}));

const personId = randomUUID();
const viewer = {familyId: randomUUID(), personId, actingAs: personId, sessionId: randomUUID()};
const identity = {...viewer, isOrganizer: false, deviceHash: "test-device"};

beforeEach(() => vi.resetAllMocks());

it("rechecks the session only after acquiring the revocation lock", async () => {
  const acquired = Promise.withResolvers<boolean>();
  const select = vi.fn();
  const tx = {select} as unknown as FamilyTransaction;
  vi.mocked(lockFamily).mockReturnValue(acquired.promise);
  vi.mocked(revalidateViewer).mockResolvedValue(null);
  const authorization = requireListEditor(tx, viewer, personId, true);
  expect(revalidateViewer).not.toHaveBeenCalled();
  acquired.resolve(true);
  await expect(authorization).rejects.toMatchObject({code: "forbidden"});
  expect(lockFamily).toHaveBeenCalledWith(tx, viewer.familyId);
  expect(revalidateViewer).toHaveBeenCalledWith(tx, viewer);
  expect(select).not.toHaveBeenCalled();
});

it("rejects a request whose session switched to helping someone else", async () => {
  vi.mocked(lockFamily).mockResolvedValue(true);
  vi.mocked(revalidateViewer).mockResolvedValue({...identity, actingAs: randomUUID()});
  await expect(requireListEditor({} as FamilyTransaction, viewer, personId))
    .rejects.toMatchObject({code: "forbidden"});
});

it("allows the current owner after session revalidation", async () => {
  const owner = {id: personId, displayName: "Willow", helperId: null, noClothes: false};
  const forLock = vi.fn().mockResolvedValue([owner]);
  const tx = {select: () => ({from: () => ({where: () => ({for: forLock})})})} as unknown as FamilyTransaction;
  vi.mocked(lockFamily).mockResolvedValue(true);
  vi.mocked(revalidateViewer).mockResolvedValue(identity);
  await expect(requireListEditor(tx, viewer, personId, true)).resolves.toEqual(owner);
  expect(forLock).toHaveBeenCalledWith("no key update");
});

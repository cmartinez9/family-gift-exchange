import {randomUUID} from "node:crypto";
import {beforeEach, expect, it, vi} from "vitest";
import {lockFamily} from "../../src/server/auth/access";
import {revalidateViewer} from "../../src/server/auth/session";
import type {FamilyTransaction} from "../../src/server/db/database";
import {withFamily} from "../../src/server/db/client";
import {requireListActor, requireListEditor} from "../../src/server/lists/access";
import {setExchangeBudget} from "../../src/server/lists/budget";
import {claimItem, setClaimTick, undoClaim} from "../../src/server/lists/claims";

vi.mock("server-only", () => ({}));
vi.mock("../../src/server/auth/access", () => ({lockFamily: vi.fn()}));
vi.mock("../../src/server/auth/session", () => ({revalidateViewer: vi.fn()}));
vi.mock("../../src/server/db/client", () => ({withFamily: vi.fn()}));

const personId = randomUUID();
const viewer = {familyId: randomUUID(), personId, actingAs: personId, sessionId: randomUUID()};
const identity = {...viewer, isOrganizer: false, deviceHash: "test-device"};

beforeEach(() => vi.resetAllMocks());

it.each(["actor", "editor"])("rechecks the %s session only after acquiring the revocation lock", async (boundary) => {
  const acquired = Promise.withResolvers<boolean>();
  const select = vi.fn();
  const tx = {select} as unknown as FamilyTransaction;
  vi.mocked(lockFamily).mockReturnValue(acquired.promise);
  vi.mocked(revalidateViewer).mockResolvedValue(null);
  const authorization = boundary === "actor" ? requireListActor(tx, viewer) : requireListEditor(tx, viewer, personId, true);
  expect(revalidateViewer).not.toHaveBeenCalled();
  acquired.resolve(true);
  await expect(authorization).rejects.toMatchObject({code: "forbidden"});
  expect(lockFamily).toHaveBeenCalledWith(tx, viewer.familyId);
  expect(revalidateViewer).toHaveBeenCalledWith(tx, viewer);
  expect(select).not.toHaveBeenCalled();
});

it.each(["actor", "editor"])("rejects a stale acting profile at the %s boundary", async (boundary) => {
  vi.mocked(lockFamily).mockResolvedValue(true);
  vi.mocked(revalidateViewer).mockResolvedValue({...identity, actingAs: randomUUID()});
  const tx = {} as FamilyTransaction;
  await expect(boundary === "actor" ? requireListActor(tx, viewer) : requireListEditor(tx, viewer, personId))
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

it.each(["claim", "undo", "bought", "wrapped", "budget"] as const)("blocks %s after a session is revoked", async (command) => {
  const select = vi.fn();
  const insert = vi.fn();
  const update = vi.fn();
  const remove = vi.fn();
  const tx = {select, insert, update, delete: remove} as unknown as FamilyTransaction;
  vi.mocked(withFamily).mockImplementation((_family, action) => action(tx));
  vi.mocked(lockFamily).mockResolvedValue(true);
  vi.mocked(revalidateViewer).mockResolvedValue(null);
  const id = randomUUID();
  const mutation = command === "claim" ? claimItem(viewer, id)
    : command === "undo" ? undoClaim(viewer, id)
    : command === "budget" ? setExchangeBudget(viewer, id, "50")
    : setClaimTick(viewer, id, command, true);
  await expect(mutation).rejects.toMatchObject({code: "forbidden"});
  expect(lockFamily).toHaveBeenCalledWith(tx, viewer.familyId);
  expect(revalidateViewer).toHaveBeenCalledWith(tx, viewer);
  expect(select).not.toHaveBeenCalled();
  expect(insert).not.toHaveBeenCalled();
  expect(update).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
});

it("denies budget changes using a demoted organizer's stale viewer", async () => {
  const update = vi.fn();
  const tx = {update} as unknown as FamilyTransaction;
  vi.mocked(withFamily).mockImplementation((_family, action) => action(tx));
  vi.mocked(lockFamily).mockResolvedValue(true);
  vi.mocked(revalidateViewer).mockResolvedValue(identity);
  const stale = {...viewer, isOrganizer: true};
  await expect(setExchangeBudget(stale, randomUUID(), "50")).rejects.toMatchObject({code: "forbidden"});
  expect(update).not.toHaveBeenCalled();
});

it("allows budget changes using the current organizer role", async () => {
  let budget = "10.00";
  const tx = {
    select: () => ({from: () => ({where: () => ({for: async () => [{budgetAmount: budget, status: "setup"}]})})}),
    update: () => ({set: (values: {budgetAmount: string}) => ({where: async () => { budget = values.budgetAmount; }})}),
  } as unknown as FamilyTransaction;
  vi.mocked(withFamily).mockImplementation((_family, action) => action(tx));
  vi.mocked(lockFamily).mockResolvedValue(true);
  vi.mocked(revalidateViewer).mockResolvedValue({...identity, isOrganizer: true});
  const stale = {...viewer, isOrganizer: false};
  await setExchangeBudget(stale, randomUUID(), "50");
  expect(budget).toBe("50.00");
});

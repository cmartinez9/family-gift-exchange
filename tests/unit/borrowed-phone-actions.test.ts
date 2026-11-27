import {beforeEach, expect, it, vi} from "vitest";
import {DrawError} from "../../src/server/draw";
import {hideOnBorrowedPhone, revealOnBorrowedPhone} from "../../src/app/[locale]/welcome/borrowed/actions";

const server = vi.hoisted(() => ({getViewer: vi.fn(), requireViewer: vi.fn(), revealMyPerson: vi.fn(), hideBorrowedPerson: vi.fn(), withFamily: vi.fn()}));
vi.mock("@/server/auth", () => ({getViewer: server.getViewer, requireViewer: server.requireViewer}));
vi.mock("@/server/auth/borrowed", () => ({hideBorrowedPerson: server.hideBorrowedPerson, returnBorrowedPhone: vi.fn()}));
vi.mock("@/server/auth/request", () => ({clearBorrowedSession: vi.fn()}));
vi.mock("@/server/db/client", () => ({withFamily: server.withFamily}));
vi.mock("@/server/draw", () => ({DrawError: class extends Error {constructor(readonly code: string) {super(code);}}, revealMyPerson: server.revealMyPerson}));
vi.mock("next/cache", () => ({revalidatePath: vi.fn()}));

beforeEach(() => vi.resetAllMocks());

it.each([null, {personId: "ana"}])("closes an expired reveal when the borrowed viewer is gone (%s)", async (viewer) => {
  server.getViewer.mockResolvedValue(viewer);
  await expect(hideOnBorrowedPhone()).resolves.toEqual({hidden: true});
  expect(server.withFamily).not.toHaveBeenCalled();
});

it("does not close a live reveal until the session has been sealed", async () => {
  server.getViewer.mockResolvedValue({familyId: "family", borrowed: {lenderSessionId: "ana"}});
  server.withFamily.mockImplementation((_family, action) => action({}));
  server.hideBorrowedPerson.mockResolvedValue(false);
  await expect(hideOnBorrowedPhone()).resolves.toEqual({hidden: false});
  server.hideBorrowedPerson.mockResolvedValue(true);
  await expect(hideOnBorrowedPhone()).resolves.toEqual({hidden: true});
});

it.each(["drawChanged", "closed", "notFound", "forbidden"] as const)("refreshes borrowed reveal state after %s", async (code) => {
  server.requireViewer.mockResolvedValue({borrowed: {hidden: false}});
  server.revealMyPerson.mockRejectedValue(new DrawError(code));
  await expect(revealOnBorrowedPhone("christmas", 1)).resolves.toEqual({error: "refresh"});
});

it("keeps a timed-out borrowed reveal retryable", async () => {
  server.requireViewer.mockResolvedValue({borrowed: {hidden: false}});
  server.revealMyPerson.mockRejectedValue(new DrawError("checkTimedOut"));
  await expect(revealOnBorrowedPhone("christmas", 1)).resolves.toEqual({error: "unavailable"});
});

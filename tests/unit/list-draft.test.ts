import {afterEach, expect, it, vi} from "vitest";
import {splitFamilyLists} from "../../src/app/[locale]/lists/family-list-order";
import {readLinkDraft, signLinkDraft} from "../../src/server/lists/link-preview/draft";

vi.mock("server-only", () => ({}));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

const viewer = {personId: "person", familyId: "family", sessionId: "session", isOrganizer: false, actingAs: "person"};
const link = "shop.example.com/red-mug";
const preview = {url: `https://${link}`, title: "Red mug", price: "20.00", store: "shop.example.com", icon: "store",
  image: Buffer.from("fixture image bytes")};

it("reuses a preview only for the same session, acting person and link before it expires", () => {
  vi.stubEnv("AUTH_SECRET", "synthetic-preview-test-key");
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  const ticket = signLinkDraft(viewer, link, preview);
  expect(readLinkDraft(viewer, ` ${link} `, ticket)).toEqual(preview);
  expect(readLinkDraft({...viewer, sessionId: "new-session"}, link, ticket)).toBeUndefined();
  expect(readLinkDraft({...viewer, actingAs: "looked-after"}, link, ticket)).toBeUndefined();
  expect(readLinkDraft(viewer, "shop.example.com/green-mug", ticket)).toBeUndefined();
  expect(readLinkDraft(viewer, link, `x${ticket}`)).toBeUndefined();
  vi.advanceTimersByTime(15 * 60 * 1000);
  expect(readLinkDraft(viewer, link, ticket)).toBeUndefined();
});

it("pulls the authorized recipient to the first section while preserving the other lists in order", () => {
  const members = [{id: "one"}, {id: "two"}, {id: "three"}];
  expect(splitFamilyLists(members, "two")).toEqual({recipient: members[1], others: [members[0], members[2]]});
  expect(splitFamilyLists(members, null)).toEqual({recipient: undefined, others: members});
  expect(splitFamilyLists(members, "outside-this-family")).toEqual({recipient: undefined, others: members});
});

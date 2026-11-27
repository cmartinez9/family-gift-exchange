import {beforeEach, expect, it, vi} from "vitest";
import {removeItem} from "../../src/app/[locale]/lists/actions";
import {POST} from "../../src/app/[locale]/lists/[personId]/items/[itemId]/remove/route";

vi.mock("../../src/app/[locale]/lists/actions", () => ({removeItem: vi.fn()}));

const url = "https://gift.example/es/lists/owner/items/item/remove";
const params = Promise.resolve({personId: "owner", itemId: "item"});

beforeEach(() => vi.resetAllMocks());

it.each([{status: "saved"}, {error: "forbidden"}] as const)("returns the existing removal action's result: %o", async (result) => {
  vi.mocked(removeItem).mockResolvedValueOnce(result);
  const response = await POST(new Request(url, {method: "POST", headers: {origin: "https://gift.example"}}), {params});
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(result);
  expect(removeItem).toHaveBeenCalledExactlyOnceWith("owner", "item");
});

it.each(["https://other.example", "null", undefined])("rejects a removal from origin %s", async (origin) => {
  const response = await POST(new Request(url, {method: "POST", headers: origin ? {origin} : {}}), {params});
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({error: "forbidden"});
  expect(removeItem).not.toHaveBeenCalled();
});

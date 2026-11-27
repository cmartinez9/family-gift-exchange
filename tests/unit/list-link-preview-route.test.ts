import {beforeEach, expect, it, vi} from "vitest";
import {previewItemLink} from "../../src/app/[locale]/lists/actions";
import {POST} from "../../src/app/[locale]/lists/[personId]/link-preview/route";

vi.mock("../../src/app/[locale]/lists/actions", () => ({previewItemLink: vi.fn()}));

const url = "https://gift.example/en/lists/owner/link-preview";
const params = Promise.resolve({personId: "owner"});
const ask = (body: string, origin: string | null = "https://gift.example") =>
  POST(new Request(url, {method: "POST", body, headers: origin ? {origin} : {}}), {params});

beforeEach(() => vi.resetAllMocks());

it("returns the preview action's result for the list's owner", async () => {
  const card = {url: "https://shop.example.com/mug", title: "Mug", price: null, store: "shop.example.com", icon: "store"};
  vi.mocked(previewItemLink).mockResolvedValueOnce({card});
  const response = await ask(JSON.stringify({link: "shop.example.com/mug"}));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({card});
  expect(previewItemLink).toHaveBeenCalledExactlyOnceWith("owner", "shop.example.com/mug");
});

it.each(["https://other.example", "null", null])("rejects a preview from origin %s", async (origin) => {
  const response = await ask(JSON.stringify({link: "shop.example.com/mug"}), origin);
  expect(response.status).toBe(403);
  expect(previewItemLink).not.toHaveBeenCalled();
});

it.each(["not json", JSON.stringify({link: 4}), JSON.stringify({link: "x".repeat(9000)})])("refuses a malformed request %#", async (body) => {
  const response = await ask(body);
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({error: "invalid-link"});
  expect(previewItemLink).not.toHaveBeenCalled();
});

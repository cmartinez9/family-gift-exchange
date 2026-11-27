import {readFile} from "node:fs/promises";
import fc from "fast-check";
import sharp from "sharp";
import {describe, expect, it, vi} from "vitest";
import {linkPreviewFromUrl, resolveLinkPreview} from "../../src/server/lists/link-preview";
import {MAX_PREVIEW_BYTES, type PreviewNetwork, type PreviewResponse} from "../../src/server/lists/link-preview/http";
import {readProductMetadata} from "../../src/server/lists/link-preview/metadata";
import {cleanLink, parseLink} from "../../src/server/lists/link-preview/url";

vi.mock("server-only", () => ({}));

const fixture = (name: string) => readFile(new URL(`./fixtures/link-preview/${name}.html`, import.meta.url), "utf8");
const publicAddress = {address: "93.184.216.34", family: 4};

function fakeNetwork(handler: (url: URL) => Partial<PreviewResponse> = () => ({status: 403})) {
  return {
    lookup: vi.fn<PreviewNetwork["lookup"]>().mockResolvedValue([publicAddress]),
    request: vi.fn<PreviewNetwork["request"]>(async (url) => ({
      status: 200, contentType: "text/html", body: Buffer.alloc(0), ...handler(url),
    })),
  } satisfies PreviewNetwork;
}

describe("preview address checks", () => {
  it.each([
    "javascript:alert(1)", "data:text/plain,hello", "file:///tmp/file", "ftp://shop.example.com/gift",
    "http://localhost/a", "http://printer.local/a", "https://member:secret@shop.example.com/gift",
    "http://127.0.0.1", "http://10.0.0.1", "http://169.254.169.254", "http://168.63.129.16/",
    "http://100.100.100.200", "http://[::1]/", "http://[fd00::1]/", "http://[::ffff:192.0.2.1]/",
  ])("refuses unsafe input %s before making a request", async (input) => {
    const network = fakeNetwork();
    await expect(resolveLinkPreview(input, network)).rejects.toMatchObject({code: "unsafe-link"});
    expect(network.lookup).not.toHaveBeenCalled();
    expect(network.request).not.toHaveBeenCalled();
  });

  it("refuses markup and a URL above the input cap", async () => {
    const network = fakeNetwork();
    for (const input of ["<b>shop.example.com</b>", `https://example.com/${"x".repeat(2048)}`]) {
      await expect(resolveLinkPreview(input, network)).rejects.toMatchObject({code: "invalid-link"});
    }
    expect(network.request).not.toHaveBeenCalled();
  });

  it("checks every DNS result and passes the checked connection address to the transport", async () => {
    const network = fakeNetwork();
    network.lookup
      .mockResolvedValueOnce([publicAddress, {address: "192.168.0.2", family: 4}])
      .mockResolvedValueOnce([publicAddress]);
    await expect(resolveLinkPreview("shop.example.com", network)).rejects.toMatchObject({code: "unsafe-link"});
    expect(network.request).not.toHaveBeenCalled();
    await resolveLinkPreview("shop.example.com", network);
    expect(network.request.mock.calls[0][1]).toEqual(publicAddress);
  });

  it("refuses a redirect whose hostname resolves locally", async () => {
    const network = fakeNetwork(() => ({status: 302, location: "https://blocked.example.com/gift"}));
    network.lookup.mockResolvedValueOnce([publicAddress]).mockResolvedValueOnce([{address: "127.0.0.1", family: 4}]);
    await expect(resolveLinkPreview("https://short.example.com/gift", network)).rejects.toMatchObject({code: "unsafe-link"});
    expect(network.request).toHaveBeenCalledTimes(1);
  });

  it("checks each hop, stops after five hops and keeps the last checked URL", async () => {
    const network = fakeNetwork((url) => ({
      status: 302, location: `https://s${Number(url.hostname[1]) + 1}.example.com/gift`,
    }));
    const preview = await resolveLinkPreview("https://s0.example.com/gift", network);
    expect(network.lookup).toHaveBeenCalledTimes(6);
    expect(network.request).toHaveBeenCalledTimes(6);
    expect(preview.url).toBe("https://s5.example.com/gift");
    expect(preview.image).toBeUndefined();
  });

  it("strips tracking keys without changing an unrelated parameter", () => {
    fc.assert(fc.property(fc.string(), (value) => {
      const input = new URL("https://shop.example.com/gift");
      input.searchParams.append("item", value);
      input.searchParams.append("UTM_campaign", "winter");
      input.searchParams.append("fbclid", "tracking");
      const cleaned = new URL(cleanLink(input));
      expect([...cleaned.searchParams]).toEqual([["item", input.searchParams.get("item")]]);
      expect(cleanLink(cleaned)).toBe(cleaned.href);
    }));
  });
});

describe("preview content and fallback", () => {
  it.each([
    ["amazon.com/Wool-Scarf/dp/B123456789?tag=affiliate", "Amazon", "Wool Scarf", "B123456789"],
    ["www.etsy.com/listing/12345/woven-basket", "Etsy", "woven basket", "12345"],
    ["www.walmart.com/ip/Fuzzy-Blanket/12345", "Walmart", "Fuzzy Blanket", "12345"],
    ["www.target.com/p/Winter-Mug/-/A-12345", "Target", "Winter Mug", "12345"],
    ["www.costco.com/winter-boots.product.12345.html", "Costco", "winter boots", "12345"],
    ["www.bestbuy.com/site/music-player/12345.p", "Best Buy", "music player", "12345"],
    ["www.lego.com/en-us/product/winter-workshop-12345", "LEGO", "winter workshop", "12345"],
  ])("creates a store card for %s when the page is blocked", async (input, store, title, productId) => {
    const preview = await resolveLinkPreview(input, fakeNetwork());
    expect(preview).toMatchObject({store, title, productId, url: `https://${input.split("?")[0]}`});
    expect(preview.icon).not.toBe("store");
    expect(preview.image).toBeUndefined();
    expect(preview.price).toBeNull();
  });

  it("uses the shared title after expanding a store short link when blocked", async () => {
    const network = fakeNetwork((url) => url.hostname === "a.co"
      ? {status: 301, location: "https://www.amazon.com/dp/B123456789?ref=share"}
      : {status: 200, body: Buffer.from("<!doctype html><title>Robot Check</title><p>Automated access to Amazon data.</p>".repeat(2))});
    const result = await resolveLinkPreview("A gift from the store\nhttps://a.co/sample", network);
    expect(result).toMatchObject({
      url: "https://www.amazon.com/dp/B123456789", title: "A gift from the store", store: "Amazon",
    });
    expect(result.image).toBeUndefined();
  });

  it("reads product, Open Graph, Twitter, and page title metadata in order", async () => {
    await expect(fixture("product").then(readProductMetadata)).resolves.toMatchObject({
      title: "Frost & Flannel Scarf", image: "/scarf.png", brand: "Snowday", price: "28.50",
    });
    await expect(fixture("open-graph").then(readProductMetadata)).resolves.toMatchObject({
      title: "Cozy & Warm Throw", image: "/throw.png", price: "19.95",
    });
    await expect(fixture("twitter").then(readProductMetadata)).resolves.toMatchObject({
      title: "Tiny House Mug", image: "/mug.png",
    });
    await expect(fixture("title-icon").then(readProductMetadata)).resolves.toMatchObject({
      title: "Woven Basket & Lid", icon: "/store-icon.png",
    });
  });

  it("follows relative images safely and gives callers re-encoded bytes", async () => {
    const html = Buffer.from(await fixture("product"));
    const png = await sharp({create: {width: 16, height: 16, channels: 3, background: "#c0e8d9"}})
      .png().toBuffer();
    const network = fakeNetwork((url) => url.pathname === "/scarf.png"
      ? {body: png, contentType: "image/png"}
      : {body: html});
    const result = await resolveLinkPreview("https://shop.example.com/gift", network);
    expect(result).toMatchObject({title: "Frost & Flannel Scarf", price: "28.50"});
    expect((await sharp(result.image).metadata()).format).toBe("webp");
    expect(network.request.mock.calls.map(([url]) => url.pathname)).toEqual(["/gift", "/scarf.png"]);
  });

  it("keeps a valid card when an image points to a refused address or the page is oversized", async () => {
    const html = (await fixture("product")).replace("/scarf.png", "http://127.0.0.1/image");
    const network = fakeNetwork(() => ({body: Buffer.from(html)}));
    const result = await resolveLinkPreview("https://shop.example.com/gift", network);
    expect(result.title).toBe("Frost & Flannel Scarf");
    expect(result.image).toBeUndefined();
    expect(network.request).toHaveBeenCalledTimes(1);
    const oversized = fakeNetwork(() => ({body: Buffer.alloc(MAX_PREVIEW_BYTES + 1)}));
    await expect(resolveLinkPreview("https://shop.example.com/frosted-mug", oversized)).resolves.toMatchObject({
      title: "frosted mug", price: null,
    });
  });

  it("cleans a schemeless store address", () => {
    expect(parseLink("example.com:443/frosted-mug").url.href).toBe("https://example.com/frosted-mug");
  });
});

describe("saving a link before its page loads", () => {
  it("names the store and the item from the link alone, without requesting the page", async () => {
    const network = fakeNetwork();
    await expect(linkPreviewFromUrl("https://www.target.com/p/fleece-robe/-/A-12345?utm_source=x", network)).resolves.toEqual({
      url: "https://www.target.com/p/fleece-robe/-/A-12345", title: "fleece robe", price: null,
      store: "Target", icon: "target", productId: "12345",
    });
    await expect(linkPreviewFromUrl("Look at this mug https://shop.example.com/p/123", network))
      .resolves.toMatchObject({title: "Look at this mug", store: "shop.example.com", icon: "store"});
    expect(network.lookup).toHaveBeenCalledTimes(2);
    expect(network.request).not.toHaveBeenCalled();
  });

  it("keeps the same address rules as the page fetch", async () => {
    const network = fakeNetwork();
    for (const input of ["http://localhost/a", "http://10.0.0.1", "javascript:alert(1)"]) {
      await expect(linkPreviewFromUrl(input, network)).rejects.toMatchObject({code: "unsafe-link"});
    }
    await expect(linkPreviewFromUrl("<b>shop.example.com</b>", network)).rejects.toMatchObject({code: "invalid-link"});
    network.lookup.mockResolvedValueOnce([{address: "192.168.0.2", family: 4}]);
    await expect(linkPreviewFromUrl("https://inside.example.com/gift", network)).rejects.toMatchObject({code: "unsafe-link"});
  });

  it("does not wait on a lookup that fails or hangs", async () => {
    const network = fakeNetwork();
    network.lookup.mockRejectedValueOnce(new Error("ENOTFOUND"));
    await expect(linkPreviewFromUrl("https://gone.example.com/gift", network)).resolves.toMatchObject({store: "gone.example.com"});
    vi.useFakeTimers();
    try {
      network.lookup.mockReturnValueOnce(new Promise(() => {}));
      const saved = linkPreviewFromUrl("https://slow.example.com/gift", network);
      await vi.advanceTimersByTimeAsync(1600);
      await expect(saved).resolves.toMatchObject({store: "slow.example.com"});
    } finally {
      vi.useRealTimers();
    }
  });
});

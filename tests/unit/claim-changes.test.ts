import {describe, expect, it} from "vitest";
import {diffSeen, seenOf, seenVersion, type SeenItem} from "../../src/server/lists/claims/changes";

const base: SeenItem = {title: "Cozy slipper socks", note: "Size 7 to 8", url: null, store: null, price: "18.00"};

describe("diffSeen", () => {
  it("is empty when nothing changed or nothing was recorded yet", () => {
    expect(diffSeen(base, {...base})).toEqual([]);
    expect(diffSeen(null, {...base, note: "Size 8 to 9"})).toEqual([]);
  });

  it("lists title, note, price, then link, each old to new", () => {
    const now: SeenItem = {
      title: "Slipper socks", note: "Size 8 to 9", price: "20.00",
      url: "https://shop.example.org/socks?utm_source=x", store: "shop.example.org",
    };
    expect(diffSeen(base, now)).toEqual([
      {field: "title", before: "Cozy slipper socks", after: "Slipper socks"},
      {field: "note", before: "Size 7 to 8", after: "Size 8 to 9"},
      {field: "price", before: "18.00", after: "20.00"},
      {field: "link", before: null, after: "shop.example.org", url: "https://shop.example.org/socks"},
    ]);
  });

  it("compares prices as amounts and treats a missing note as no note", () => {
    expect(diffSeen({...base, price: "18"}, {...base, price: "18.00"})).toEqual([]);
    expect(diffSeen({...base, note: undefined as unknown as null}, {...base, note: null})).toEqual([]);
    expect(diffSeen(base, {...base, price: null})).toEqual([{field: "price", before: "18.00", after: null}]);
  });

  it("never offers an unsafe link to follow", () => {
    const [change] = diffSeen(base, {...base, url: "javascript:alert(1)", store: "evil"});
    expect(change).toEqual({field: "link", before: null, after: "evil", url: null});
  });
});

describe("seenVersion", () => {
  it("changes with any shown field and is stable otherwise", () => {
    expect(seenVersion(base)).toBe(seenVersion({...base}));
    for (const field of ["title", "note", "url", "store", "price"] as const) {
      expect(seenVersion({...base, [field]: "other"})).not.toBe(seenVersion(base));
    }
    expect(seenVersion(seenOf({...base, note: null}))).not.toBe(seenVersion(base));
  });
});

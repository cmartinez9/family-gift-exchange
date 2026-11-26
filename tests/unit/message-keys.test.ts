import {describe, expect, it} from "vitest";
import {missingMessageKeys} from "../../scripts/message-keys";

describe("translation key parity", () => {
  it("reports nested keys missing from either language", () => {
    expect(missingMessageKeys({
      en: {home: {title: "Title", name: "Name"}},
      es: {home: {title: "Título", date: "Fecha"}},
    })).toEqual(["en: home.date", "es: home.name"]);
  });

  it("accepts matching keys with different translations", () => {
    expect(missingMessageKeys({
      en: {home: {title: "Title"}},
      es: {home: {title: "Título"}},
    })).toEqual([]);
  });
});

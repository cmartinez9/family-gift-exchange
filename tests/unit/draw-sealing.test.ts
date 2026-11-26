import {randomBytes} from "node:crypto";
import {expect, it} from "vitest";
import {drawSeal, openText, sealText} from "../../src/server/draw/sealing";

it("authenticates the family, exchange, giver, version and purpose", () => {
  const key = randomBytes(32);
  const binding = {familyId: "family", exchangeId: "exchange", giverId: "giver", version: 1, field: "assignment"} as const;
  const sealed = sealText(key, binding, "Snowquill");
  expect(sealed.equals(sealText(key, binding, "Snowquill"))).toBe(false);
  expect(openText(key, binding, sealed)).toBe("Snowquill");
  expect(sealed.includes(Buffer.from("Snowquill"))).toBe(false);
  for (const invalid of [
    {...binding, familyId: "different"}, {...binding, exchangeId: "different"},
    {...binding, giverId: "different"}, {...binding, version: 2},
    {...binding, field: "question-recipient" as const, questionId: "question"},
  ]) {
    expect(() => openText(key, invalid, sealed)).toThrow();
  }
  expect(() => openText(randomBytes(32), binding, sealed)).toThrow();
  sealed[sealed.length - 1] ^= 1;
  expect(() => openText(key, binding, sealed)).toThrow();
});

it("uses separate ciphertext bindings for each question and answer", () => {
  const key = randomBytes(32);
  const binding = {
    familyId: "family", exchangeId: "exchange", giverId: "giver", version: 1,
    field: "question-text", questionId: "question",
  } as const;
  const sealed = sealText(key, binding, "Any favorite colors?");
  expect(() => openText(key, {...binding, questionId: "another"}, sealed)).toThrow();
  expect(() => openText(key, {...binding, field: "question-answer"}, sealed)).toThrow();
});

it("makes the seal independent of pair order and dependent on the version", () => {
  const key = randomBytes(32);
  const pairs = new Map([["a", "b"], ["b", "c"], ["c", "a"]]);
  const first = drawSeal(key, "family", "exchange", 1, pairs);
  expect(first).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
  expect(drawSeal(key, "family", "exchange", 1, new Map([...pairs].reverse()))).toBe(first);
  expect(drawSeal(key, "family", "exchange", 2, pairs)).not.toBe(first);
});

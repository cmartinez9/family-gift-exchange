import {randomUUID} from "node:crypto";
import fc from "fast-check";
import {describe, expect, it} from "vitest";
import {codeAlphabet, keyCodePattern, makeCode, parseLinkKey} from "../../src/server/auth/access";
import {permitCreation} from "../../src/server/auth/families";
import {clearedAttempts, failedAttempt, fifteenMinutes, hashPin, pinProblem, verifyPin} from "../../src/server/auth/pin";
import {parseSession, secret} from "../../src/server/auth/session";

describe("sign-in secrets", () => {
  it.each([
    ["0412", "0412", "pinDate"], ["3112", "3112", "pinDate"], ["0229", "0229", "pinDate"],
    ["1962", "1962", "pinDate"], ["2026", "2026", "pinDate"], ["1111", "1111", "pinPattern"],
    ["3434", "3434", "pinPattern"], ["1234", "1234", "pinPattern"], ["9876", "9876", "pinPattern"],
    ["2580", "2580", "pinPattern"], ["0852", "0852", "pinPattern"],
    ["abc1", "abc1", "pinLength"], ["4268", "4269", "pinMatch"], ["4268", "4268", null],
  ])("validates PIN %s against confirmation %s", (pin, confirmation, result) => {
    expect(pinProblem(pin, confirmation)).toBe(result);
  });

  it("rejects all month/day and day/month forms of valid dates", () => {
    fc.assert(fc.property(fc.integer({min: 1, max: 12}), fc.integer({min: 1, max: 31}), (month, date) => {
      if (date > [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]) return;
      for (const ordered of [[month, date], [date, month]]) {
        const pin = ordered.map((value) => String(value).padStart(2, "0")).join("");
        expect(pinProblem(pin, pin)).not.toBeNull();
      }
    }), {numRuns: 500});
  });

  it("uses distinct PIN salts and checks with the configured secret", async () => {
    const saltKey = secret();
    const [one, two] = await Promise.all([hashPin(saltKey, "4268"), hashPin(saltKey, "4268")]);
    expect(one).not.toEqual(two);
    await expect(verifyPin(saltKey, "4268", one)).resolves.toBe(true);
    await expect(verifyPin(saltKey, "4269", one)).resolves.toBe(false);
    await expect(verifyPin(secret(), "4268", one)).resolves.toBe(false);
  });

  it("issues codes using 30 distinct unambiguous characters and parses opaque key and session credentials", () => {
    expect(new Set(codeAlphabet).size).toBe(30);
    expect(codeAlphabet).not.toMatch(/[01ILO]/);
    const tokens = new Set(Array.from({length: 25}, () => secret()));
    expect(tokens.size).toBe(25);
    const familyId = randomUUID();
    const id = randomUUID();
    for (const token of tokens) {
      expect(makeCode()).toMatch(keyCodePattern);
      expect(parseLinkKey(`${familyId}~${token}`)).toEqual({familyId, token});
      expect(parseSession(`${familyId}.${id}.${token}`)).toEqual({familyId, id, token});
    }
    expect(parseLinkKey(`${familyId}~${makeCode()}`)).toBeNull();
    expect(parseSession(`${familyId}.${id}.${secret()}.extra`)).toBeNull();
  });

  it("permits only the configured organizer invitation code", () => {
    const invite = secret();
    const pepper = secret();
    expect(permitCreation(undefined, invite, pepper)).toBe(false);
    expect(permitCreation(invite, secret(), pepper)).toBe(false);
    expect(permitCreation(invite, invite, pepper)).toBe(true);
  });

  it("retains the daily total after a 15-minute lockout", () => {
    const time = new Date();
    let state = clearedAttempts;
    for (let i = 0; i < 5; i++) state = failedAttempt(state, time);
    expect(state.lockedUntil?.getTime()).toBe(time.getTime() + fifteenMinutes);
    for (let i = 0; i < 5; i++) state = failedAttempt(state, new Date(time.getTime() + fifteenMinutes));
    expect(state.failedToday).toBe(10);
    expect(state.newDevicesLocked).toBe(true);
  });
});

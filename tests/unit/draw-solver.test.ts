import fc from "fast-check";
import {expect, it} from "vitest";
import {insertIntoDraw, removeFromDraw, repairDraw, repairReportedPair} from "../../src/server/draw/repair";
import {possibleDraws} from "../helpers/possible-draws";
import {
  checkRules, drawRules, inspectDraw, solveDraw, type DrawPerson, type KeepApartPair, type Pairs,
} from "../../src/server/draw/solver";

function independentlyAllowed(a: DrawPerson, b: DrawPerson, excluded: readonly KeepApartPair[]) {
  return a.id !== b.id && (a.householdId === null || a.householdId !== b.householdId) &&
    a.helperId !== b.id && b.helperId !== a.id &&
    excluded.every(({personA, personB}) =>
      (a.id !== personA || b.id !== personB) && (a.id !== personB || b.id !== personA));
}

function validate(people: DrawPerson[], excluded: KeepApartPair[], pairs: Pairs) {
  const byId = new Map(people.map((person) => [person.id, person]));
  if (pairs.size !== people.length || new Set(pairs.values()).size !== people.length) return false;
  return people.every((person) => {
    const recipient = byId.get(pairs.get(person.id) ?? "");
    return recipient && independentlyAllowed(person, recipient, excluded) && pairs.get(recipient.id) !== person.id;
  });
}

function bruteForce(people: DrawPerson[], excluded: KeepApartPair[]) {
  if (people.length < 4) return {possible: false, loop: false};
  const paired: number[] = [];
  let possible = false;

  function permute(giver: number, remaining: number[]): boolean {
    if (!remaining.length) {
      if (paired.some((recipient, i) => paired[recipient] === i)) return false;
      possible = true;
      let cursor = paired[0];
      let size = 1;
      while (cursor !== 0) {
        size++;
        cursor = paired[cursor];
      }
      return size === people.length;
    }
    for (const recipient of remaining) {
      if (!independentlyAllowed(people[giver], people[recipient], excluded)) continue;
      paired.push(recipient);
      if (permute(giver + 1, remaining.filter((i) => i !== recipient))) return true;
      paired.pop();
    }
    return false;
  }

  const loop = permute(0, Array.from(people.keys()));
  return {possible, loop};
}

const profile = fc.record({
  household: fc.integer({min: 0, max: 5}),
  helper: fc.integer({min: 0, max: 15}),
  apart: fc.integer({min: 0, max: 0xffff}),
});
const family = fc.record({
  profiles: fc.array(profile, {minLength: 3, maxLength: 13}),
  density: fc.integer({min: 0, max: 2}),
  position: fc.nat(),
  seed: fc.integer({min: 1, max: 0x7fffffff}),
});

it("solves 100,000 generated families and validates local repairs", () => {
  let comparedSmall = 0;
  let repaired = 0;
  let inserted = 0;
  let reported = 0;
  fc.assert(fc.property(family, ({profiles, density, position, seed}) => {
    const all = profiles.map(({household, helper}, index): DrawPerson => ({
      id: String(index),
      householdId: household < 2 ? null : String(household),
      helperId: helper >= 12 || helper === index ? null : String(helper),
    }));
    const people = all.slice(0, -1);
    const excluded = profiles.flatMap(({apart}, a) => all.flatMap((_, b) =>
      b > a && density > 0 && (apart & (1 << b)) && (density === 2 || (a + b) % 2 === 0)
        ? [{personA: String(a), personB: String(b)}] : []));
    let state = seed;
    const random = (bound: number) => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return (state >>> 0) % bound;
    };
    const rules = drawRules(people, excluded);
    const pairs = solveDraw(rules, {random});
    if (people.length <= 6) {
      const expected = bruteForce(people, excluded);
      comparedSmall++;
      if (Boolean(pairs) !== expected.possible) return false;
      if (pairs && inspectDraw(rules, pairs, excluded).oneLoop !== expected.loop) return false;
    }
    if (!pairs) return true;
    if (!validate(people, excluded, pairs)) return false;

    const target = people[position % people.length].id;
    const remaining = people.filter(({id}) => id !== target);
    const next = removeFromDraw(drawRules(remaining, excluded), pairs, target);
    if (next) {
      repaired++;
      const changed = remaining.filter(({id}) => next.get(id) !== pairs.get(id));
      if (!validate(remaining, excluded, next) || changed.length < 1 || changed.length > remaining.length) return false;
    }

    const expanded = insertIntoDraw(drawRules(all, excluded), pairs, all.at(-1)!.id);
    if (expanded) {
      inserted++;
      if (!validate(all, excluded, expanded) || people.filter(({id}) => expanded.get(id) !== pairs.get(id)).length !== 1) {
        return false;
      }
    }

    const updated = repairReportedPair(rules, pairs, target);
    if (updated) {
      reported++;
      const changed = people.filter(({id}) => updated.get(id) !== pairs.get(id));
      if (!validate(people, excluded, updated) || changed.length < 2 || updated.get(target) === pairs.get(target)) {
        return false;
      }
    }
    return true;
  }), {numRuns: 100_000, seed: 1125});
  expect(comparedSmall).toBeGreaterThan(20_000);
  expect(repaired).toBeGreaterThan(1000);
  expect(inserted).toBeGreaterThan(1000);
  expect(reported).toBeGreaterThan(1000);
}, 45_000);

it("falls back to disjoint loops when a big loop is impossible", () => {
  const people = Array.from({length: 6}, (_, i) => ({id: String(i), householdId: null, helperId: null}));
  const excluded = people.slice(0, 3).flatMap(({id: personA}) =>
    people.slice(3).map(({id: personB}) => ({personA, personB})));
  const rules = drawRules(people, excluded);
  const pairs = solveDraw(rules);
  expect(pairs && inspectDraw(rules, pairs, excluded)).toMatchObject({valid: true, oneLoop: false});
  expect(checkRules(rules)).toEqual({possible: true, blocker: null, fewestChoices: 2, limitedChoices: 6});
});

it("identifies a majority household and a roster below four", () => {
  const people = Array.from({length: 4}, (_, i) => ({
    id: String(i), householdId: i < 3 ? "same-home" : null, helperId: null,
  }));
  expect(checkRules(drawRules(people, []))).toMatchObject({possible: false, blocker: "householdTooLarge"});
  expect(checkRules(drawRules(people.slice(0, 3), []))).toMatchObject({possible: false, blocker: "tooFew"});
});

it("tries three changed givers when removing E from A E B C D", () => {
  const people = ["A", "B", "C", "D"].map((id) => ({id, householdId: null, helperId: null}));
  const excluded = [{personA: "A", personB: "B"}];
  const previous = new Map([["A", "E"], ["E", "B"], ["B", "C"], ["C", "D"], ["D", "A"]]);
  const next = removeFromDraw(drawRules(people, excluded), previous, "E")!;
  expect(next).not.toBeNull();
  expect(validate(people, excluded, next)).toBe(true);
  expect(people.filter(({id}) => next.get(id) !== previous.get(id))).toHaveLength(3);
  expect(inspectDraw(drawRules(people, excluded), next, excluded).oneLoop).toBe(true);
});

it("keeps one-giver repairs and exhausts larger repairs before failing", () => {
  const people = ["A", "B", "C", "D"].map((id) => ({id, householdId: null, helperId: null}));
  const previous = new Map([["A", "E"], ["E", "B"], ["B", "C"], ["C", "D"], ["D", "A"]]);
  const next = removeFromDraw(drawRules(people, []), previous, "E")!;
  expect(validate(people, [], next)).toBe(true);
  expect(people.filter(({id}) => next.get(id) !== previous.get(id))).toHaveLength(1);
  expect(removeFromDraw(drawRules(people.slice(0, 3), []), previous, "E")).toBeNull();
});

it("expands a reveal repair beyond two givers when needed", () => {
  const people = ["A", "B", "C", "D"].map((id) => ({id, householdId: null, helperId: null}));
  const previous = new Map([["A", "B"], ["B", "C"], ["C", "D"], ["D", "A"]]);
  const next = repairReportedPair(drawRules(people, []), previous, "A")!;
  expect(validate(people, [], next)).toBe(true);
  expect(next.get("A")).not.toBe(previous.get("A"));
  expect(people.filter(({id}) => next.get(id) !== previous.get(id))).toHaveLength(3);
});

it("chooses the smallest private repair for A B C D E F with organizer E and a disputed B reveal", () => {
  const ids = ["A", "B", "C", "D", "E", "F"];
  const people = ids.map((id) => ({id, householdId: null, helperId: null}));
  const rules = drawRules(people, []);
  const previous = new Map(ids.map((id, i) => [id, ids[(i + 1) % ids.length]]));
  const changedCount = (pairs: Pairs) => ids.filter((id) => pairs.get(id) !== previous.get(id)).length;
  const all = possibleDraws(ids).filter((pairs) => pairs.get("B") !== "C");
  const two = all.filter((pairs) => changedCount(pairs) === 2);
  expect(two).toHaveLength(1);
  expect(two[0].get("B")).toBe("F");
  expect(two[0].get("E")).toBe("C");
  const safe = all.filter((pairs) => all.some((other) => changedCount(other) === changedCount(pairs)
    && other.get("E") === pairs.get("E") && other.get("B") !== pairs.get("B")));
  const minimum = Math.min(...safe.map(changedCount));
  expect(minimum).toBe(3);
  for (let attempt = 0; attempt < 12; attempt++) {
    const next = repairDraw(rules, previous, ["B"], undefined, {observers: ["E"]})!;
    expect(validate(people, [], next)).toBe(true);
    expect(changedCount(next)).toBe(minimum);
    expect(next.get("B")).not.toBe("C");
    const alternatives = safe.filter((pairs) => changedCount(pairs) === minimum && pairs.get("E") === next.get("E"));
    expect(new Set(alternatives.map((pairs) => pairs.get("B"))).size).toBeGreaterThan(1);
  }
});

it("does not publish a private repair when organizer observations determine the new match", () => {
  const ids = ["A", "B", "C", "D"];
  const people = ids.map((id) => ({id, householdId: null, helperId: null}));
  const previous = new Map(ids.map((id, i) => [id, ids[(i + 1) % ids.length]]));
  const rules = drawRules(people, []);
  expect(repairDraw(rules, previous, ["B"], undefined, {observers: ["A", "C"]})).toBeNull();
  expect(repairDraw(rules, previous, ["B"], undefined, {observers: ["A", "C"], fullRedraw: true})).toBeNull();
});

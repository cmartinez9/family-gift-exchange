import {randomInt} from "node:crypto";

export type DrawPerson = {
  id: string;
  householdId: string | null;
  helperId: string | null;
};
export type KeepApartPair = {personA: string; personB: string};
export type Pairs = ReadonlyMap<string, string>;
type RandomIndex = (upperBound: number) => number;

export const minimumPeople = 4;
export const maximumPeople = 60;

export function shuffled<T>(values: Iterable<T>, random: RandomIndex = randomInt): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = random(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function drawRules(people: readonly DrawPerson[], keepApart: readonly KeepApartPair[]) {
  const indices = new Map(people.map(({id}, index) => [id, index]));
  const blocked = people.map(() => new Set<number>());
  const households = new Map<string, number>();
  for (const {householdId} of people) {
    if (householdId) households.set(householdId, (households.get(householdId) ?? 0) + 1);
  }
  for (const {personA, personB} of keepApart) {
    const a = indices.get(personA);
    const b = indices.get(personB);
    if (a !== undefined && b !== undefined) {
      blocked[a].add(b);
      blocked[b].add(a);
    }
  }
  const choices = people.map((giver, i) => new Set(people.flatMap((recipient, j) => {
    if (
      i === j ||
      (giver.householdId && giver.householdId === recipient.householdId) ||
      giver.helperId === recipient.id || recipient.helperId === giver.id ||
      blocked[i].has(j)
    ) return [];
    return [j];
  })));
  return {people, indices, choices, largestHousehold: Math.max(0, ...households.values())};
}

export type DrawRules = ReturnType<typeof drawRules>;
export type DrawBlocker = "tooFew" | "householdTooLarge" | "tooFewChoices" | "conflictingRules";

type SearchOptions = {random?: RandomIndex; checkTime?: () => void};

function hasSingleCycleCandidate(choices: readonly ReadonlySet<number>[], start: number) {
  // A Hamiltonian cycle cannot cross between components or through a cut vertex.
  const discovered = new Map<number, number>();
  let time = 0;

  function visit(person: number, parent?: number): number {
    const entry = time++;
    discovered.set(person, entry);
    let earliest = entry;
    let children = 0;
    for (const next of choices[person]) {
      if (next === parent) continue;
      const seenAt = discovered.get(next);
      if (seenAt !== undefined) {
        earliest = Math.min(earliest, seenAt);
        continue;
      }
      children++;
      const reached = visit(next, person);
      if (reached === -1 || (parent !== undefined && reached >= entry)) return -1;
      earliest = Math.min(earliest, reached);
    }
    return parent === undefined && children > 1 ? -1 : earliest;
  }

  return visit(start) !== -1 && discovered.size === choices.length;
}

export function solveDraw(rules: DrawRules, {random, checkTime}: SearchOptions = {}): Pairs | null {
  const {people, choices, largestHousehold} = rules;
  const size = people.length;
  if (
    size < minimumPeople || largestHousehold > size / 2 ||
    choices.some((options) => options.size < 2)
  ) return null;

  const order = shuffled(people.keys(), random).sort((a, b) => choices[a].size - choices[b].size);
  const options = choices.map((recipients) => shuffled(recipients, random));
  const start = order[0];
  const path = [start];
  const used = new Set(path);
  const failedPaths = new Set<string>();
  const bits = people.map((_, i) => 1n << BigInt(i));

  function extendLoop(last: number, mask: bigint): boolean {
    checkTime?.();
    if (path.length === size) return choices[last].has(start);

    const state = `${last}/${mask}`;
    if (failedPaths.has(state)) return false;
    // All remaining people must have two available neighbors, counting both endpoints.
    for (const candidate of order) {
      if (used.has(candidate)) continue;
      let neighbors = 0;
      for (const neighbor of choices[candidate]) {
        if (neighbor === last || neighbor === start || !used.has(neighbor)) neighbors++;
        if (neighbors >= 2) break;
      }
      if (neighbors < 2) return false;
    }

    for (const next of options[last]) {
      if (used.has(next)) continue;
      used.add(next);
      path.push(next);
      if (extendLoop(next, mask | bits[next])) return true;
      path.pop();
      used.delete(next);
    }
    failedPaths.add(state);
    return false;
  }

  if (hasSingleCycleCandidate(choices, start) && extendLoop(start, bits[start])) {
    return new Map(path.map((giver, i) => [
      people[giver].id,
      people[path[(i + 1) % size]].id,
    ]));
  }

  // A cycle cover can still be valid when there is no Hamiltonian cycle.
  const assigned = new Map<number, number>();
  used.clear();
  function coverCycles(): boolean {
    checkTime?.();
    if (assigned.size === size) return true;
    let giver = -1;
    let candidates: number[] = [];
    for (const next of order) {
      if (assigned.has(next)) continue;
      const available = options[next].filter((recipient) =>
        !used.has(recipient) && assigned.get(recipient) !== next);
      if (available.length === 0) return false;
      if (giver === -1 || available.length < candidates.length) {
        giver = next;
        candidates = available;
      }
    }
    for (const recipient of candidates) {
      assigned.set(giver, recipient);
      used.add(recipient);
      if (coverCycles()) return true;
      assigned.delete(giver);
      used.delete(recipient);
    }
    return false;
  }

  return coverCycles()
    ? new Map([...assigned].map(([giver, recipient]) => [people[giver].id, people[recipient].id]))
    : null;
}

export function checkRules(rules: DrawRules, options?: SearchOptions) {
  const size = rules.people.length;
  const fewestChoices = Math.min(size, ...rules.choices.map((choices) => choices.size));
  const limitedChoices = rules.choices.filter((choices) => choices.size < 3).length;
  let blocker: DrawBlocker | null = null;
  if (size < minimumPeople) blocker = "tooFew";
  else if (rules.largestHousehold > size / 2) blocker = "householdTooLarge";
  else if (fewestChoices < 2) blocker = "tooFewChoices";
  else if (!solveDraw(rules, options)) blocker = "conflictingRules";

  return {possible: blocker === null, blocker, fewestChoices, limitedChoices};
}

export function inspectDraw(rules: DrawRules, pairs: Pairs, keepApart: readonly KeepApartPair[]) {
  const {people, indices} = rules;
  const size = people.length;
  const comesFrom = new Set(pairs.values());
  const paired = people.map((giver) => ({giver, recipient: people[indices.get(pairs.get(giver.id) ?? "") ?? -1]}));
  const everyoneGives = pairs.size === size && paired.every(({recipient}) => recipient !== undefined);
  const everyoneReceives = comesFrom.size === size && people.every(({id}) => comesFrom.has(id));
  const noSelf = paired.every(({giver, recipient}) => recipient?.id !== giver.id);
  const noSwaps = paired.every(({giver, recipient}) => !recipient || pairs.get(recipient.id) !== giver.id);
  const noHouseholdPairs = paired.every(({giver, recipient}) =>
    !giver.householdId || giver.householdId !== recipient?.householdId);
  const noHelperPairs = paired.every(({giver, recipient}) =>
    !recipient || (giver.helperId !== recipient.id && recipient.helperId !== giver.id));
  const noKeepApartPairs = keepApart.every(({personA, personB}) =>
    pairs.get(personA) !== personB && pairs.get(personB) !== personA);
  const visited = new Set<string>();
  let cursor: string | undefined = people[0]?.id;
  while (cursor !== undefined && !visited.has(cursor)) {
    visited.add(cursor);
    cursor = pairs.get(cursor);
  }
  const oneLoop = everyoneGives && everyoneReceives && visited.size === size;
  const enoughPeople = size >= minimumPeople;
  const valid = enoughPeople && everyoneGives && everyoneReceives && noSelf && noSwaps &&
    noHouseholdPairs && noHelperPairs && noKeepApartPairs;
  return {
    valid, enoughPeople, everyoneGives, everyoneReceives, noSelf, noSwaps,
    noHouseholdPairs, noHelperPairs, noKeepApartPairs, oneLoop,
  };
}

export function validPairs(rules: DrawRules, pairs: Pairs): boolean {
  const {people, indices, choices} = rules;
  if (
    people.length < minimumPeople || pairs.size !== people.length ||
    new Set(pairs.values()).size !== people.length
  ) return false;
  return people.every(({id}, i) => {
    const recipient = pairs.get(id);
    return recipient !== undefined && choices[i].has(indices.get(recipient) ?? -1) &&
      pairs.get(recipient) !== id;
  });
}

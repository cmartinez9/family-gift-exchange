import {shuffled, validPairs, type DrawRules, type Pairs} from "./solver";

export function removeFromDraw(rules: DrawRules, pairs: Pairs, leaving: string): Pairs | null {
  const replacement = pairs.get(leaving);
  const predecessor = [...pairs.keys()].find((giver) => pairs.get(giver) === leaving);
  if (!replacement || !predecessor) return null;

  const updated = new Map(pairs);
  updated.delete(leaving);
  updated.set(predecessor, replacement);
  if (validPairs(rules, updated)) return updated;

  for (const giver of shuffled(updated.keys())) {
    const recipient = updated.get(giver);
    if (giver === predecessor || recipient === undefined) continue;
    updated.set(predecessor, recipient);
    updated.set(giver, replacement);
    if (validPairs(rules, updated)) return updated;
    updated.set(giver, recipient);
  }
  return null;
}

export function insertIntoDraw(rules: DrawRules, pairs: Pairs, joining: string): Pairs | null {
  for (const [giver, recipient] of shuffled(pairs)) {
    const updated = new Map(pairs).set(giver, joining).set(joining, recipient);
    if (validPairs(rules, updated)) return updated;
  }
  return null;
}

export function repairReportedPair(rules: DrawRules, pairs: Pairs, requester: string): Pairs | null {
  const previous = pairs.get(requester);
  if (!previous) return null;
  // A different recipient for the requester always requires a second giver to change.
  for (const [giver, recipient] of shuffled(pairs)) {
    if (giver === requester) continue;
    const updated = new Map(pairs).set(requester, recipient).set(giver, previous);
    if (validPairs(rules, updated)) return updated;
  }
  return null;
}

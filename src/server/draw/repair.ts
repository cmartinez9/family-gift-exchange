import {minimumPeople, shuffled, validPairs, type DrawRules, type Pairs} from "./solver";

export function removeFromDraw(rules: DrawRules, pairs: Pairs, leaving: string, checkTime?: () => void): Pairs | null {
  const replacement = pairs.get(leaving);
  const predecessor = [...pairs.keys()].find((giver) => pairs.get(giver) === leaving);
  if (!replacement || !predecessor) return null;

  const updated = new Map(pairs);
  updated.delete(leaving);
  return repairDraw(rules, updated, [predecessor], checkTime);
}

export function repairDraw(
  rules: DrawRules, previous: Pairs, mustChange: readonly string[], checkTime?: () => void,
  privacy?: {observers: readonly string[]; seenGivers: readonly string[]; questionGivers: readonly string[]; fullRedraw?: boolean},
): Pairs | null {
  const {people, choices, indices} = rules;
  if (people.length < minimumPeople || mustChange.some((id) => !indices.has(id))) return null;
  const required = new Set(mustChange);
  const options = choices.map((recipients, giver) => shuffled(recipients)
    .map((recipient) => people[recipient].id)
    .filter((recipient) => !required.has(people[giver].id) || recipient !== previous.get(people[giver].id))
    .sort((a, b) => Number(b === previous.get(people[giver].id)) - Number(a === previous.get(people[giver].id))));
  const next = new Map<string, string>();
  const used = new Set<string>();
  const observers = [...new Set(privacy?.observers)].sort();
  const questionGivers = [...new Set(privacy?.questionGivers)].sort();
  const groups = new Map<string, {pairs: Pairs[]; recipients: Map<string, Set<string>>}>();
  let selected: Pairs | undefined;

  function accept(changed: number) {
    if (!validPairs(rules, next)) return false;
    if (!privacy || !required.size) return true;
    const seenCount = privacy.fullRedraw ? 0 : privacy.seenGivers.filter((id) =>
      next.has(id) && next.get(id) === previous.get(id)).length;
    const retainedQuestions = privacy.fullRedraw ? [] : questionGivers.map((id) =>
      next.has(id) && next.get(id) === previous.get(id));
    const observation = JSON.stringify([
      privacy.fullRedraw ? null : changed, observers.map((id) => next.get(id)), seenCount, retainedQuestions,
    ]);
    const group = groups.get(observation) ?? {
      pairs: [], recipients: new Map([...required].map((id) => [id, new Set<string>()])),
    };
    let novel = false;
    for (const [id, recipients] of group.recipients) {
      const recipient = next.get(id)!;
      if (!recipients.has(recipient)) novel = true;
      recipients.add(recipient);
    }
    if (novel) group.pairs.push(new Map(next));
    groups.set(observation, group);
    if ([...group.recipients.values()].some((recipients) => recipients.size < 2)) return false;
    selected = shuffled(group.pairs)[0];
    return true;
  }

  function search(changed: number, limit: number): boolean {
    checkTime?.();
    if (next.size === people.length) return accept(changed);
    let unavoidable = 0;
    let giver: string | undefined;
    let candidates: string[] = [];
    for (const {id} of people) {
      if (next.has(id)) continue;
      const available = options[indices.get(id)!].filter((recipient) =>
        !used.has(recipient) && next.get(recipient) !== id);
      if (!available.includes(previous.get(id) ?? "")) unavoidable++;
      const withinBudget = available.filter((recipient) => changed + Number(recipient !== previous.get(id)) <= limit);
      if (!withinBudget.length) return false;
      if (giver === undefined || withinBudget.length < candidates.length) {
        giver = id;
        candidates = withinBudget;
      }
    }
    if (changed + unavoidable > limit || giver === undefined) return false;
    for (const recipient of candidates) {
      next.set(giver, recipient);
      used.add(recipient);
      if (search(changed + Number(recipient !== previous.get(giver)), limit)) return true;
      next.delete(giver);
      used.delete(recipient);
    }
    return false;
  }

  for (let count = privacy?.fullRedraw ? people.length : required.size; count <= people.length; count++) {
    if (search(0, count)) return selected ?? new Map(next);
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

export function repairReportedPair(rules: DrawRules, pairs: Pairs, requester: string, checkTime?: () => void): Pairs | null {
  return pairs.has(requester) ? repairDraw(rules, pairs, [requester], checkTime) : null;
}

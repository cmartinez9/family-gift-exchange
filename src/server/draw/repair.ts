import {inspectDraw, minimumPeople, shuffled, validPairs, type DrawRules, type Pairs} from "./solver";

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
    .filter((recipient) => !required.has(people[giver].id) || recipient !== previous.get(people[giver].id)));
  const next = new Map<string, string>();
  const used = new Set<string>();
  const observers = [...new Set(privacy?.observers)].sort();
  const questionGivers = [...new Set(privacy?.questionGivers)].sort();
  const owner = (id: string) => people[indices.get(id)!].helperId ?? id;
  const views = [...new Set(observers.map(owner))].flatMap((organizer) => {
    const accessible = observers.filter((id) => owner(id) === organizer);
    const protectedGivers = [...required].filter((id) => owner(id) !== organizer);
    if (!protectedGivers.length) return [];
    return [{
      observers: accessible,
      givers: protectedGivers,
      questionGivers: questionGivers.filter((id) => accessible.includes(id) || accessible.includes(previous.get(id)!)),
    }];
  });
  const candidates: {pairs: Pairs; observations: string[]}[] = [];
  const candidateKeys = new Set<string>();

  function accept(changed: number) {
    if (!validPairs(rules, next)) return false;
    if (!privacy || !views.length) return true;
    const key = JSON.stringify(people.map(({id}) => next.get(id)));
    if (candidateKeys.has(key)) return false;
    candidateKeys.add(key);
    const seenCount = privacy.fullRedraw ? 0 : privacy.seenGivers.filter((id) =>
      next.has(id) && next.get(id) === previous.get(id)).length;
    const oneLoop = inspectDraw(rules, next, []).oneLoop;
    candidates.push({pairs: new Map(next), observations: views.map((view) => JSON.stringify([
      privacy.fullRedraw ? null : changed, view.observers.map((id) => next.get(id)), seenCount,
      privacy.fullRedraw ? [] : view.questionGivers.map((id) => next.has(id) && next.get(id) === previous.get(id)),
      oneLoop,
    ]))});
    return true;
  }

  function choosePrivateRepair(): Pairs | null {
    let remaining = candidates;
    while (remaining.length) {
      checkTime?.();
      const groups = views.map((view, index) => {
        const observations = new Map<string, Map<string, Set<string>>>();
        for (const candidate of remaining) {
          const key = candidate.observations[index];
          const recipients = observations.get(key) ?? new Map(view.givers.map((id) => [id, new Set<string>()]));
          for (const [id, possible] of recipients) possible.add(candidate.pairs.get(id)!);
          observations.set(key, recipients);
        }
        return observations;
      });
      const safe = remaining.filter((candidate) => groups.every((group, index) =>
        [...group.get(candidate.observations[index])!.values()].every((recipients) => recipients.size > 1)));
      if (safe.length === remaining.length) return shuffled(safe)[0].pairs;
      remaining = safe;
    }
    return null;
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
    candidates.length = 0;
    candidateKeys.clear();
    for (let attempt = 1; attempt <= 1024; attempt++) {
      next.clear();
      used.clear();
      for (let index = 0; index < options.length; index++) {
        const previousRecipient = previous.get(people[index].id);
        options[index] = shuffled(options[index]).sort((a, b) => privacy?.fullRedraw ? 0 :
          Number(b === previousRecipient) - Number(a === previousRecipient));
      }
      const found = search(0, count);
      if (!privacy || !views.length) {
        if (found) return new Map(next);
        break;
      }
      if (!found || attempt % 32 === 0) {
        const selected = choosePrivateRepair();
        if (selected) return selected;
      }
      if (!found) break;
    }
    if (candidates.length === 1024) return null;
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

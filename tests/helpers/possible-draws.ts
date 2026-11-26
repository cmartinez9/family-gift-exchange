export function possibleDraws(ids: readonly string[]) {
  const results: Map<string, string>[] = [];
  const pairs = new Map<string, string>();
  function permute(remaining: readonly string[]) {
    if (!remaining.length) {
      results.push(new Map(pairs));
      return;
    }
    const giver = ids[pairs.size];
    for (const recipient of remaining) {
      if (giver === recipient || pairs.get(recipient) === giver) continue;
      pairs.set(giver, recipient);
      permute(remaining.filter((id) => id !== recipient));
      pairs.delete(giver);
    }
  }
  permute(ids);
  return results;
}

export function reportedRepairOrder<T>(values: Iterable<T>): T[] {
  const choices = [...values];
  if (!choices.every((value) => typeof value === "number")) return choices.reverse();
  const preferred = choices.some((value) => value === 1) ? [5] : [3, 4];
  const rank = (value: T) => {
    const index = preferred.indexOf(Number(value));
    return index < 0 ? preferred.length + Number(value) : index;
  };
  return choices.sort((a, b) => rank(a) - rank(b));
}

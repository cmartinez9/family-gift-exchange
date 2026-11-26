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

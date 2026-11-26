type MessageTree = Readonly<{[key: string]: string | MessageTree}>;

function messageKeys(tree: MessageTree, prefix = ""): string[] {
  return Object.entries(tree).flatMap(([key, value]) => {
    const path = prefix + key;
    return typeof value === "string" ? [path] : messageKeys(value, path + ".");
  });
}

export function missingMessageKeys(
  catalogs: Readonly<Record<string, MessageTree>>,
): string[] {
  const byLocale = Object.entries(catalogs).map(
    ([locale, tree]) => [locale, new Set(messageKeys(tree))] as const,
  );
  const allKeys = [...new Set(byLocale.flatMap(([, keys]) => [...keys]))].sort();

  return byLocale.flatMap(([locale, keys]) =>
    allKeys.filter((key) => !keys.has(key)).map((key) => `${locale}: ${key}`),
  );
}

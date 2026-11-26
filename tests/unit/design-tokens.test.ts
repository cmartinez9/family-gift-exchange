// @vitest-environment jsdom
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {compile} from "tailwindcss";
import {afterAll, beforeAll, expect, it} from "vitest";
import design from "../../design/design.json" with {type: "json"};

const require = createRequire(import.meta.url);
const testDirectory = dirname(fileURLToPath(import.meta.url));
const eslintRequire = createRequire(require.resolve("eslint"));
const eslintrcRequire = createRequire(eslintRequire.resolve("@eslint/eslintrc"));
const {load} = eslintrcRequire("js-yaml") as {load(input: string): unknown};
const lines = readFileSync(resolve(testDirectory, "../../design/DESIGN.md"), "utf8").split(/\r?\n/);
if (lines.shift() !== "---" || !lines.includes("---")) throw new Error("Missing design front matter");
const front = load(lines.slice(0, lines.indexOf("---")).join("\n")) as Record<string, unknown>;

function tokenSection(name: string): Record<string, string> {
  const section = front[name];
  if (!section || typeof section !== "object" || Array.isArray(section)) throw new Error(`Invalid ${name} tokens`);
  const entries = Object.entries(section);
  if (!entries.length || entries.some(([, value]) => typeof value !== "string")) throw new Error(`Invalid ${name} values`);
  return Object.fromEntries(entries);
}

const kebab = (name: string) => name.replace(/[A-Z]/g, (letter) => "-" + letter.toLowerCase());
const normalize = (value: string | number) => String(value).trim().toLowerCase().replace(/\s+/g, " ");
const groups: Record<string, Record<string, string | number | undefined>> = {
  colours: Object.fromEntries(Object.entries(design.extensions.colorMeta).map(([name, meta]) => [`--color-${name}`, meta.canonical])),
  "yarn-block cards": design.extensions.cardTokens,
  typography: Object.fromEntries(Object.entries(design.extensions.typographyMeta).flatMap(([role, type]) => [
    [`--text-${role}`, type.fontSize],
    [`--text-${role}--line-height`, type.lineHeight],
    [`--text-${role}--font-weight`, type.fontWeight],
    ...(type.letterSpacing === "0" ? [] : [[`--text-${role}--letter-spacing`, type.letterSpacing]]),
  ])),
  font: {"--font-sans": '"Test Rubik", Rubik, system-ui, sans-serif'},
  spacing: Object.fromEntries(Object.entries(design.extensions.spacing).map(([name, value]) => [`--space-${kebab(name)}`, value])),
  motion: Object.fromEntries(design.extensions.motion.map(({name, value}) => [`--motion-${name}`, value.startsWith("cubic-bezier") ? value : undefined])),
  radii: Object.fromEntries(Object.entries(tokenSection("rounded")).map(([name, value]) => [`--radius-${name}`, value])),
  "front-matter colours": Object.fromEntries(Object.entries(tokenSection("colors")).map(([name, value]) => [name.startsWith("card-") ? `--${name}` : `--color-${name}`, value])),
};

let style: HTMLStyleElement;
let tokens: CSSStyleDeclaration;

beforeAll(async () => {
  const path = resolve(testDirectory, "../../src/styles/tokens.css");
  const properties = new Set(Object.values(groups).flatMap((group) => Object.keys(group)));
  const consumer = [...properties].map((property, index) => `--observed-${index}: var(${property});`).join("\n");
  const compiler = await compile(`${readFileSync(path, "utf8")}\n.token-consumer {${consumer}}`, {
    base: dirname(path),
    loadStylesheet: async (id, base) => {
      const path = id === "tailwindcss" ? require.resolve("tailwindcss/index.css") : resolve(base, id);
      return {path, base: dirname(path), content: readFileSync(path, "utf8")};
    },
  });
  style = document.createElement("style");
  style.textContent = compiler.build([]);
  document.documentElement.style.setProperty("--font-rubik", '"Test Rubik"');
  document.head.append(style);
  tokens = getComputedStyle(document.documentElement);
});

afterAll(() => {
  style?.remove();
  document.documentElement.style.removeProperty("--font-rubik");
});

it.each(Object.entries(groups))("exposes the %s tokens to stylesheet consumers", (_name, expected) => {
  for (const [property, value] of Object.entries(expected)) {
    const actual = tokens.getPropertyValue(property);
    expect(actual.trim(), `${property} is available`).not.toBe("");
    if (value !== undefined) expect(normalize(actual), property).toBe(normalize(value));
  }
});

it("emits no shadow tokens, as the design has none", () => {
  expect(design.extensions.shadows).toEqual([]);
  const properties = Array.from({length: tokens.length}, (_, index) => tokens.item(index));
  expect(properties.filter((property) => property.startsWith("--shadow-"))).toEqual([]);
});

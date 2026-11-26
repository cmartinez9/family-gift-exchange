import {readFileSync} from "node:fs";
import {expect, it} from "vitest";
import design from "../../design/design.json" with {type: "json"};

// Every token design/design.json defines must be declared in src/styles/tokens.css, with its value.
const css = readFileSync(new URL("../../src/styles/tokens.css", import.meta.url), "utf8");
const markdown = readFileSync(new URL("../../design/DESIGN.md", import.meta.url), "utf8");

const kebab = (name: string) => name.replace(/[A-Z]/g, (letter) => "-" + letter.toLowerCase());
const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");

function declared(property: string): string[] {
  const pattern = new RegExp(`${property.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\s*:\\s*([^;]+);`, "g");
  return [...css.matchAll(pattern)].map((match) => normalize(match[1]));
}

function expectToken(property: string, value?: string | number) {
  const values = declared(property);
  expect(values, `${property} is declared`).not.toHaveLength(0);
  if (value !== undefined) expect(values, `${property} is ${value}`).toContain(normalize(String(value)));
}

it("declares every colour", () => {
  for (const [name, meta] of Object.entries(design.extensions.colorMeta)) expectToken(`--color-${name}`, meta.canonical);
});

it("declares the yarn-block card tokens", () => {
  for (const [name, value] of Object.entries(design.extensions.cardTokens)) expectToken(name, value);
});

it("declares the type scale, with sizes, line heights, weights and letter spacing", () => {
  for (const [role, type] of Object.entries(design.extensions.typographyMeta)) {
    expectToken(`--text-${role}`, type.fontSize);
    expectToken(`--text-${role}--line-height`, type.lineHeight);
    expectToken(`--text-${role}--font-weight`, type.fontWeight);
    if (type.letterSpacing !== "0") expectToken(`--text-${role}--letter-spacing`, type.letterSpacing);
  }
  expect(css).toMatch(/--font-sans:\s*var\(--font-rubik\), Rubik, system-ui, sans-serif;/);
});

it("declares the spacing", () => {
  for (const [name, value] of Object.entries(design.extensions.spacing)) expectToken(`--space-${kebab(name)}`, value);
});

it("declares a token for every named motion, and the easings match", () => {
  for (const motion of design.extensions.motion) {
    expectToken(`--motion-${motion.name}`);
    if (motion.value.startsWith("cubic-bezier")) expectToken(`--motion-${motion.name}`, motion.value);
  }
});

it("has no shadow tokens, as the design has none", () => {
  expect(design.extensions.shadows).toEqual([]);
  expect(css).not.toMatch(/--shadow-/);
});

it("declares every radius and colour from DESIGN.md", () => {
  const front = markdown.split("---")[1];
  const section = (name: string) => {
    const block = front.split(new RegExp(`^${name}:$`, "m"))[1].split(/^\S/m)[0];
    return [...block.matchAll(/^ {2}([\w-]+): "([^"]+)"$/gm)].map((match) => [match[1], match[2]] as const);
  };
  for (const [name, value] of section("rounded")) expectToken(`--radius-${name}`, value);
  for (const [name, value] of section("colors")) {
    if (name.startsWith("card-")) expectToken(`--${name}`, value);
    else expectToken(`--color-${name}`, value);
  }
});

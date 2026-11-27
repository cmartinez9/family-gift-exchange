import {createTranslator} from "next-intl";
import {expect, it, vi} from "vitest";
import en from "../../messages/en.json";
import es from "../../messages/es.json";
import {generateMetadata} from "../../src/app/[locale]/key/[key]/page";

const preview = vi.hoisted(() => ({linkPreview: vi.fn(), locale: "en" as "en" | "es"}));
vi.mock("server-only", () => ({}));
vi.mock("../../src/app/[locale]/key/[key]/link-preview", () => ({linkPreview: preview.linkPreview}));
vi.mock("../../src/app/[locale]/sign-in/get-in", () => ({KeyWelcome: vi.fn(), KeyAlreadyOpened: vi.fn()}));
vi.mock("@/i18n/navigation", () => ({Link: vi.fn(), useRouter: vi.fn()}));
vi.mock("@/server/auth/request", () => ({appOrigin: () => new URL("https://gifts.example"), currentDeviceKind: vi.fn()}));
vi.mock("next-intl/server", () => ({
  getLocale: async () => preview.locale,
  getTranslations: async (namespace: "getIn.preview" | "home" | "getIn") =>
    createTranslator({locale: preview.locale, messages: preview.locale === "es" ? es : en, namespace}),
}));

it.each(["en", "es"] as const)("describes the image's actual stitches in %s metadata", async (locale) => {
  preview.locale = locale;
  const t = createTranslator({locale, messages: locale === "es" ? es : en, namespace: "getIn.preview"});
  for (const [name, stitched] of [
    ["Rosa", "Rosa"], ["Christian", "Christian"], ["Rosa Ramirez", "Rosa"], ["Rosa Muñoz", "Rosa"],
    ["José", null], ["W".repeat(60), null], [null, null],
  ]) {
    preview.linkPreview.mockResolvedValue(name === null ? null : {name, familyName: "Martinez", year: 2026});
    const metadata = await generateMetadata({params: Promise.resolve({locale, key: "key"})});
    const alt = stitched ? t("picture", {name: stitched}) : t("genericPicture");
    for (const images of [metadata.openGraph?.images, metadata.twitter?.images]) {
      expect(images).toEqual([expect.objectContaining({alt, width: 1200, height: 630, type: "image/png"})]);
    }
    if (name !== null) expect(metadata.openGraph?.title).toBe(t("title", {name}));
  }
});

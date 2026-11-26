import type {MetadataRoute} from "next";
import {hasLocale} from "next-intl";
import {getTranslations} from "next-intl/server";
import {routing} from "@/i18n/routing";

export async function GET(_request: Request, {params}: {params: Promise<{locale: string}>}) {
  const {locale} = await params;
  if (!hasLocale(routing.locales, locale)) return new Response(null, {status: 404});
  const t = await getTranslations({locale, namespace: "home"});
  const manifest: MetadataRoute.Manifest = {
    name: t("title"),
    short_name: t("title"),
    lang: locale,
    start_url: `/${locale}`,
    scope: "/",
    display: "standalone",
    icons: [
      {src: "/gift-192.png", sizes: "192x192", type: "image/png"},
      {src: "/gift-512.png", sizes: "512x512", type: "image/png"},
    ],
  };
  return Response.json(manifest, {headers: {"Content-Type": "application/manifest+json"}});
}

import {getTranslations} from "next-intl/server";

/** A screen's tab title: "Notices · Family Gift Exchange". */
export async function screenTitle(key: string) {
  const t = await getTranslations("getIn");
  const home = await getTranslations("home");
  return {title: `${t(key as Parameters<typeof t>[0])} · ${home("title")}`};
}

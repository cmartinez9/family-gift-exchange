import type {ReactNode} from "react";
import {getTranslations} from "next-intl/server";
import {Link} from "@/i18n/navigation";
import {requireViewer} from "@/server/auth";
import {linkClass} from "./styles";

export default async function ListLayout({children}: {children: ReactNode}) {
  const viewer = await requireViewer();
  const t = await getTranslations("lists");
  return (
    <main className="mx-auto max-w-xl space-y-5 px-5 py-6 text-lg">
      <nav className="flex flex-wrap gap-x-4" aria-label={t("navigation")}>
        <Link className={linkClass} href={`/lists/${viewer.actingAs}`}>{t("myList")}</Link>
        <Link className={linkClass} href="/lists">{t("familyLists")}</Link>
        <Link className={linkClass} href="/lists/getting">{t("getting")}</Link>
        <Link className={linkClass} href="/account">{t("account")}</Link>
      </nav>
      {children}
    </main>
  );
}

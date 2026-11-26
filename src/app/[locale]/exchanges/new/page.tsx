import {getTranslations} from "next-intl/server";
import {notFound} from "next/navigation";
import {Link} from "@/i18n/navigation";
import {requireViewer} from "@/server/auth";
import {create} from "../actions";
import {DetailsFields} from "../components";
import {DrawForm} from "../form";
import {heading, link, screen} from "../styles";

export default async function NewExchangePage() {
  const viewer = await requireViewer();
  if (!viewer.isOrganizer || viewer.actingAs !== viewer.personId) notFound();
  const t = await getTranslations("draw");
  return (
    <main className={screen}>
      <Link className={link} href="/exchanges">{t("back")}</Link>
      <h1 className={heading}>{t("new")}</h1>
      <DrawForm action={create} label={t("create")}><DetailsFields /></DrawForm>
    </main>
  );
}

import {getTranslations} from "next-intl/server";
import {Link} from "@/i18n/navigation";
import {linkClass} from "./styles";

export default async function ListNotFound() {
  const t = await getTranslations("lists");
  return (
    <>
      <h1 className="text-2xl font-semibold">{t("feedback.not-found")}</h1>
      <Link className={linkClass} href="/lists">{t("familyLists")}</Link>
    </>
  );
}

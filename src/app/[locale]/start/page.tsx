import {getTranslations} from "next-intl/server";
import {Link} from "@/i18n/navigation";
import {AuthForm, PinFields} from "../sign-in/controls";
import {inputClass, linkClass, sectionClass} from "../sign-in/styles";
import {startFamily} from "../sign-in/actions";

export default async function StartPage() {
  const t = await getTranslations("auth");
  return (
    <main className={sectionClass}>
      <h1 className="text-2xl font-semibold">{t("startFamily")}</h1>
      <AuthForm action={startFamily} label={t("createFamily")}>
        <label className="block">{t("organizerInvite")}<input name="invite" className={inputClass} maxLength={128} required /></label>
        <label className="block">{t("familyName")}<input name="familyName" className={inputClass} maxLength={80} required /></label>
        <label className="block">{t("yourName")}<input name="displayName" className={inputClass} maxLength={60} required /></label>
        <p>{t("makePin")}</p>
        <PinFields create />
      </AuthForm>
      <Link href="/" className={linkClass}>{t("back")}</Link>
    </main>
  );
}

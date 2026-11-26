import {getTranslations} from "next-intl/server";
import {Link} from "@/i18n/navigation";
import {requireViewer} from "@/server/auth";
import {FaceIdButton} from "../sign-in/controls";
import {linkClass, sectionClass} from "../sign-in/styles";

export default async function FaceIdPage({searchParams}: {searchParams: Promise<{setup?: string}>}) {
  const viewer = await requireViewer();
  const t = await getTranslations("auth");
  const next = (await searchParams).setup === "1" && viewer.isOrganizer ? "/family" : "/account";
  return (
    <main className={sectionClass}>
      <h1 className="text-2xl font-semibold">{t("facePrompt")}</h1>
      <p>{t("faceExplanation")}</p>
      <FaceIdButton enroll next={next} />
      <Link className={linkClass} href={next}>{t("notNow")}</Link>
    </main>
  );
}

import {getTranslations} from "next-intl/server";
import {Link} from "@/i18n/navigation";
import {getViewer} from "@/server/auth";
import {activePerson, inspectKey, parseLinkKey} from "@/server/auth/access";
import {withFamily} from "@/server/db/client";
import {KeyClaim} from "../../sign-in/controls";
import {linkClass, sectionClass} from "../../sign-in/styles";

export const metadata = {referrer: "no-referrer", robots: {index: false, follow: false}};

export default async function KeyPage({params}: {params: Promise<{key: string}>}) {
  const t = await getTranslations("auth");
  const key = parseLinkKey((await params).key);
  const entry = key && await withFamily(key.familyId, (tx) => inspectKey(tx, key.familyId, key.token, new Date()));
  const viewer = await getViewer();
  const other = entry && viewer && (viewer.familyId !== key.familyId || viewer.personId !== entry.personId);
  const current = other
    ? await withFamily(viewer.familyId, (tx) => activePerson(tx, viewer.familyId, viewer.personId))
    : null;
  return (
    <main className={sectionClass}>
      <h1 className="text-2xl font-semibold">{t("yourKey")}</h1>
      {!entry ? <p>{t("feedback.unavailable")}</p> : other ? (
        <p>{t("keyForSomeoneElse", {name: entry.name, current: current?.displayName ?? ""})}</p>
      ) : entry.usedAt && viewer ? (
        <Link href="/account" className={linkClass}>{t("openAccount")}</Link>
      ) : (
        <KeyClaim familyId={key.familyId} value={key.token} typed={false} entry={{...entry, usedAt: entry.usedAt?.toISOString() ?? null}} />
      )}
      <Link href="/" className={linkClass}>{t("back")}</Link>
    </main>
  );
}

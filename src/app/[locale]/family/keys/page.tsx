import {getLocale, getTranslations} from "next-intl/server";
import {notFound} from "next/navigation";
import {Link} from "@/i18n/navigation";
import {requireViewer} from "@/server/auth";
import {readiness} from "@/server/auth/families";
import {appOrigin} from "@/server/auth/request";
import {withFamily} from "@/server/db/client";
import {linkClass, sectionClass} from "../../sign-in/styles";
import {KeyRow} from "./key-row";

export const metadata = {referrer: "no-referrer", robots: {index: false, follow: false}};

export default async function KeysPage() {
  const viewer = await requireViewer();
  const board = await withFamily(viewer.familyId, (tx) => readiness(tx, viewer, new Date()));
  if (!board?.canSendKeys) notFound();
  const t = await getTranslations("auth");
  const locale = await getLocale();
  const familyLink = new URL(`/${locale}/sign-in?family=${viewer.familyId}`, appOrigin()).href;
  return (
    <main className={sectionClass}>
      <h1 className="text-2xl font-semibold print:hidden">{t("sendKeys")}</h1>
      <div className="space-y-2 print:hidden">
        <p>{t("sendKeyInstructions")}</p>
        <label className="block">
          {t("familyReturnAddress")}
          <input readOnly className="block min-h-12 w-full rounded border border-current px-3 py-2" value={familyLink} />
        </label>
        <Link href="/family" className={linkClass}>{t("back")}</Link>
      </div>
      <ul className="space-y-4">
        {board.members.filter(({helperId}) => !helperId).map(({id, name, joinedAt}) => (
          <KeyRow key={id} id={id} name={name} joined={Boolean(joinedAt)}
            initiallySent={board.sent.some(({personId}) => personId === id)}
            requestedAt={board.requests.find(({personId}) => personId === id)?.at.toISOString()} />
        ))}
      </ul>
    </main>
  );
}

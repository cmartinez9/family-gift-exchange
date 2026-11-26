import {getFormatter, getTranslations} from "next-intl/server";
import {Link} from "@/i18n/navigation";
import {requireViewer} from "@/server/auth";
import {account} from "@/server/auth/security";
import {withFamily} from "@/server/db/client";
import {changePin} from "../sign-in/actions";
import {AuthForm, PinFields} from "../sign-in/controls";
import {activityDateFormat, linkClass, sectionClass} from "../sign-in/styles";
import {reportEvent, setLanguage, signOut, switchProfile} from "./actions";

export default async function AccountPage({searchParams}: {searchParams: Promise<{reported?: string; face?: string}>}) {
  const viewer = await requireViewer();
  const t = await getTranslations("auth");
  const format = await getFormatter();
  const {name, helpers, activity} = await withFamily(viewer.familyId, (tx) => account(tx, viewer));
  const actingFor = helpers.find(({id}) => id === viewer.actingAs);
  const search = await searchParams;
  return (
    <main className={sectionClass}>
      <h1 className="text-2xl font-semibold">{t("hello", {name})}</h1>
      {actingFor && <p>{t("actingFor", {name: actingFor.name})}</p>}
      {helpers.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xl font-semibold">{t("helpHeading")}</h2>
          {actingFor && <AuthForm action={switchProfile.bind(null, viewer.personId)} label={t("backToMe")} />}
          {helpers.filter(({id}) => id !== viewer.actingAs).map(({id, name: helperName}) => (
            <AuthForm key={id} action={switchProfile.bind(null, id)} label={t("helpAs", {name: helperName})} />
          ))}
        </section>
      )}
      {viewer.isOrganizer && !actingFor && <Link className={linkClass} href="/family">{t("manageFamily")}</Link>}
      {search.face === "1" && (
        <details className="space-y-3">
          <summary className={linkClass}>{t("changePin")}</summary>
          <AuthForm action={changePin} label={t("savePin")}><PinFields create /></AuthForm>
        </details>
      )}
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">{t("activity")}</h2>
        {search.reported === "1" && <p role="status">{t("feedback.reported")}</p>}
        {!activity.length && <p>{t("noActivity")}</p>}
        <ul className="space-y-4">
          {activity.map(({id, kind, at, deviceKind, sessionId, disputed}) => (
            <li key={id} className="border-b border-current/25 pb-3">
              <p>{t(`event.${kind}`)} {deviceKind && t(`device.${deviceKind}` as Parameters<typeof t>[0])}</p>
              <time dateTime={at.toISOString()}>{format.dateTime(at, activityDateFormat)}</time>
              {disputed ? <p>{t("alreadyReported")}</p> : sessionId !== viewer.sessionId
                && kind !== "pinLocked" && kind !== "newDevicesLocked" && kind !== "keyDisputed" && (
                  <AuthForm action={reportEvent.bind(null, id)} label={t("notMe")} />
                )}
            </li>
          ))}
        </ul>
      </section>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">{t("sessionSettings")}</h2>
        <AuthForm action={signOut.bind(null, false)} label={t("switchPerson")} />
        <details className="space-y-3">
          <summary className={linkClass}>{t("signOutAll")}</summary>
          <p>{t("confirmSignOutAll")}</p>
          <AuthForm action={signOut.bind(null, true)} label={t("signOutAll")} />
        </details>
        <details className="space-y-2">
          <summary className={linkClass}>{t("homeScreen")}</summary>
          <p>{t("homeScreenHelp")}</p>
        </details>
      </section>
      <nav aria-label={t("language")} className="flex gap-4">
        <form action={setLanguage.bind(null, "en")}><button className={linkClass} lang="en">English</button></form>
        <form action={setLanguage.bind(null, "es")}><button className={linkClass} lang="es">Español</button></form>
      </nav>
    </main>
  );
}

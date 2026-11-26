import {getTranslations} from "next-intl/server";
import {Link} from "@/i18n/navigation";
import {getViewer} from "@/server/auth";
import {signInFamily} from "@/server/auth/families";
import {rememberedFamily} from "@/server/auth/request";
import {uuidPattern} from "@/server/auth/session";
import {withFamily} from "@/server/db/client";
import {AuthFeedback, AuthForm, EnterCode, FaceIdButton, PinFields, ResetButton} from "./controls";
import {inputClass, linkClass} from "./styles";
import {enterPin, openFamily} from "./actions";

type Search = {family?: string; person?: string; join?: string; safety?: string};

export async function SignInScreen({search = {}}: {search?: Search}) {
  const t = await getTranslations("auth");
  const viewer = await getViewer();
  if (viewer) return <Link href="/account" className={linkClass}>{t("openAccount")}</Link>;
  const familyId = typeof search.family === "string" && uuidPattern.test(search.family) ? search.family : await rememberedFamily();
  const family = familyId ? await withFamily(familyId, (tx) => signInFamily(tx, familyId)) : null;
  const selected = family?.names.find(({id}) => id === search.person);
  const familyUrl = `/sign-in?family=${familyId}`;

  if (search.join === "1" && familyId && family) {
    return (
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold">{family.name}</h2>
        <EnterCode familyId={familyId} />
        <Link href={familyUrl} className={linkClass}>{t("back")}</Link>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      {search.safety === "1" && <AuthFeedback state={{success: "familyLockdown"}} />}
      <FaceIdButton />
      {family && familyId ? (
        <>
          <h2 className="text-xl font-semibold">{family.name}</h2>
          {selected ? (
            <>
              {selected.needsNewKey ? <AuthFeedback state={{error: "needsNewKey"}} /> : <AuthForm action={enterPin.bind(null, familyId, selected.id)} label={t("signIn")}>
                <p>{t("enterPinFor", {name: selected.name})}</p>
                <PinFields />
              </AuthForm>}
              <ResetButton familyId={familyId} personId={selected.id} />
              <Link href={familyUrl} className={linkClass}>{t("otherName")}</Link>
            </>
          ) : (
            <>
              <p>{t("tapName")}</p>
              <ul>
                {family.names.map(({id, name}) => (
                  <li key={id}><Link href={`${familyUrl}&person=${id}`} className={linkClass}>{name}</Link></li>
                ))}
              </ul>
              <Link href={`${familyUrl}&join=1`} className={linkClass}>{t("haveCode")}</Link>
            </>
          )}
        </>
      ) : (
        <AuthForm action={openFamily} label={t("continue")}>
          <label className="block">
            {t("familyAddress")}
            <input name="address" className={inputClass} type="text" autoCapitalize="none" inputMode="url" maxLength={400} required />
          </label>
        </AuthForm>
      )}
      <Link href="/start" className={linkClass}>{t("startFamily")}</Link>
    </section>
  );
}

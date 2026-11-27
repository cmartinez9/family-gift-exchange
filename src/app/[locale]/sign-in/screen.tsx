import type {ReactNode} from "react";
import {getTranslations} from "next-intl/server";
import {Link} from "@/i18n/navigation";
import {Avatar} from "@/components/ui/avatar";
import {ErrorBlock} from "@/components/ui/blocks";
import {ButtonLink, TextLink} from "@/components/ui/button";
import {Card, Chevron, ListRow, Rows} from "@/components/ui/card";
import {KnitMotif} from "@/components/ui/knit/knit-motif";
import {AppLink} from "@/components/ui/navigation";
import {BackRow, PageTitle} from "@/components/ui/page-header";
import {Screen} from "@/components/ui/screen";
import {getViewer} from "@/server/auth";
import {organizerName, peopleOnDevice} from "@/server/auth/account";
import {signInFamily} from "@/server/auth/families";
import {currentDeviceHash, rememberedFamily} from "@/server/auth/request";
import {uuidPattern} from "@/server/auth/session";
import {withFamily} from "@/server/db/client";
import {Bullet, CodeEntry, FaceIdLink, FaceIdTile, FindFamily, Greeting, SignInWithPin} from "./get-in";
import {AskForHelp} from "./ask-for-help";
import {RefreshSession} from "./controls";
import {linkClass} from "./styles";

type Search = {family?: string; person?: string; join?: string; safety?: string; all?: string};

async function loadFamily(search: Search) {
  const familyId = typeof search.family === "string" && uuidPattern.test(search.family) ? search.family : await rememberedFamily();
  if (!familyId) return null;
  const device = await currentDeviceHash();
  const found = await withFamily(familyId, async (tx) => {
    const family = await signInFamily(tx, familyId);
    if (!family) return null;
    return {
      ...family,
      organizer: await organizerName(tx, familyId) ?? "",
      known: device ? await peopleOnDevice(tx, familyId, device) : [],
    };
  });
  return found && {familyId, ...found};
}

/**
 * The sign-in a page can embed (the bare app address): Face ID first, then the way to the PIN.
 * The full flow lives at /sign-in.
 */
export async function SignInScreen({search = {}}: {search?: Search}) {
  const t = await getTranslations("getIn.back");
  const auth = await getTranslations("auth");
  const viewer = await getViewer();
  if (viewer) return <Link href="/account" className={linkClass}>{auth("openAccount")}</Link>;
  const family = await loadFamily(search);
  const pinHref = family ? `/sign-in?family=${family.familyId}` : "/sign-in";
  return (
    <section className="flex flex-col items-center gap-2">
      <RefreshSession />
      <FaceIdTile />
      <TextLink href={pinHref}>{t("usePin")}</TextLink>
    </section>
  );
}

/** Everything about getting back in: 10.1, 10.2 to 10.4, 10.7 and 11.8. */
export async function SignInFlow({search = {}}: {search?: Search}) {
  const viewer = await getViewer();
  const auth = await getTranslations("auth");
  if (viewer) {
    return (
      <Screen actions={<ButtonLink href="/account" transition="push">{auth("openAccount")}</ButtonLink>}>
        <PageTitle title={auth("signIn")} lead={auth("feedback.otherPerson")} className="pt-10" />
      </Screen>
    );
  }
  return <><RefreshSession /><UnauthenticatedSignIn search={search} /></>;
}

async function UnauthenticatedSignIn({search}: {search: Search}) {
  const family = await loadFamily(search);
  if (search.safety === "1") return <Paused familyId={family?.familyId ?? null} organizer={family?.organizer ?? ""} />;
  if (!family) return <FindFamily />;

  const {familyId, names, organizer, known} = family;
  const familyUrl = `/sign-in?family=${familyId}`;
  if (search.join === "1") return <CodeEntry familyId={familyId} backHref={familyUrl} sender={null} organizer={organizer} />;

  const selected = names.find(({id}) => id === search.person);
  if (selected) {
    if (selected.needsNewKey) {
      return <NeedsKey familyId={familyId} personId={selected.id} name={selected.name} organizer={organizer} backHref={`${familyUrl}&all=1`} />;
    }
    return <SignInWithPin familyId={familyId} personId={selected.id} name={selected.name} organizer={organizer} backHref={`${familyUrl}&all=1`} />;
  }

  // welcome back (10.1): this browser has only ever been one person here
  const mine = names.filter(({id}) => known.includes(id));
  if (mine.length === 1 && search.all !== "1") {
    const [me] = mine;
    return <WelcomeBack name={me.name} pinHref={`${familyUrl}&person=${me.id}`} othersHref={`${familyUrl}&all=1`}
      help={<AskForHelp organizer={organizer} asker={{familyId, personId: me.id}} />} />;
  }
  return <WhoIsUsing names={names} familyUrl={familyUrl} />;
}

async function WelcomeBack({name, pinHref, othersHref, help}: {name: string; pinHref: string; othersHref: string; help: ReactNode}) {
  const t = await getTranslations("getIn.back");
  const hello = await getTranslations("getIn.hello");
  return (
    <Screen actions={<>
      <TextLink href={pinHref} className="self-center">{t("usePin")}</TextLink>
      <TextLink href={othersHref} className="self-center">{t("notMe", {name})}</TextLink>
      {help}
    </>}>
      <div className="pt-10"><Greeting heading top={t("hi")} bottom={hello("name", {name})} /></div>
      <FaceIdTile />
    </Screen>
  );
}

async function WhoIsUsing({names, familyUrl}: {names: Array<{id: string; name: string}>; familyUrl: string}) {
  const t = await getTranslations("getIn.who");
  const auth = await getTranslations("auth");
  return (
    <Screen actions={<>
      <TextLink href={`${familyUrl}&join=1`} transition="push" className="self-center">{t("ownKey")}</TextLink>
      <FaceIdLink label={auth("signInFaceId")} />
    </>}>
      <PageTitle title={t("title")} lead={t("lead")} className="pt-10" />
      <div className="px-edge pt-5">
        <Card flush className="px-[18px] py-1">
          <Rows as="ul">
            {names.map(({id, name}) => (
              <li key={id}>
                <AppLink href={`${familyUrl}&person=${id}`} transition="push" className="fge-press block rounded-[20px]">
                  <ListRow as="span" lead={<Avatar name={name} />} title={name} trail={<Chevron />} />
                </AppLink>
              </li>
            ))}
          </Rows>
        </Card>
      </div>
    </Screen>
  );
}

async function NeedsKey({familyId, personId, name, organizer, backHref}: {
  familyId: string; personId: string; name: string; organizer: string; backHref: string;
}) {
  const t = await getTranslations("getIn.enter");
  const back = await getTranslations("getIn.back");
  return (
    <Screen back={backHref} actions={<AskForHelp organizer={organizer} asker={{familyId, personId}} />}>
      <BackRow href={backHref} parent={back("notMe", {name})} />
      <PageTitle title={name} className="pt-6" />
      <div className="px-edge pt-6">
        <ErrorBlock title={t("newKey")}>{t("newKeySub", {organizer})}</ErrorBlock>
      </div>
    </Screen>
  );
}

/** The exchange is paused (11.8): after a family lockdown, what is safe and what happens next. */
async function Paused({familyId, organizer}: {familyId: string | null; organizer: string}) {
  const t = await getTranslations("getIn.paused");
  return (
    <Screen actions={<ButtonLink href={familyId ? `/sign-in?family=${familyId}` : "/sign-in"}>{t("ok")}</ButtonLink>}>
      <div aria-hidden="true" className="flex justify-center pt-9"><KnitMotif name="lock" cell={11} /></div>
      <PageTitle title={t("title")} lead={t("lead")} className="pt-6" />
      <div className="px-edge pt-5">
        <Card className="px-5 py-[18px]">
          <ul className="flex flex-col gap-3.5">
            <Bullet icon="lock">{t("safe")}</Bullet>
            {organizer && <Bullet icon="share">{t("keys", {organizer})}</Bullet>}
            <Bullet icon="check">{t("next")}</Bullet>
          </ul>
        </Card>
      </div>
    </Screen>
  );
}

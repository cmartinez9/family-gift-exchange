import {getLocale, getTranslations} from "next-intl/server";
import {Avatar} from "@/components/ui/avatar";
import {ButtonLink} from "@/components/ui/button";
import {Card, NoteTrack} from "@/components/ui/card";
import {KnitMotif} from "@/components/ui/knit/knit-motif";
import {PageTitle} from "@/components/ui/page-header";
import {Screen} from "@/components/ui/screen";
import {getViewer} from "@/server/auth";
import {activePerson, inspectKey, parseLinkKey} from "@/server/auth/access";
import {keySender, organizerName} from "@/server/auth/account";
import {currentDeviceKind} from "@/server/auth/request";
import {withFamily} from "@/server/db/client";
import {KeyAlreadyOpened, KeyWelcome} from "../../sign-in/get-in";
import {screenTitle} from "../../sign-in/title";

export async function generateMetadata() {
  return {...await screenTitle("hello.title"), referrer: "no-referrer" as const, robots: {index: false, follow: false}};
}

export default async function KeyPage({params}: {params: Promise<{key: string}>}) {
  const t = await getTranslations("getIn.other");
  const auth = await getTranslations("auth");
  const locale = await getLocale();
  const raw = (await params).key;
  const key = parseLinkKey(raw);
  const found = key && await withFamily(key.familyId, async (tx) => {
    const entry = await inspectKey(tx, key.familyId, key.token, new Date());
    if (!entry) return null;
    return {entry, sender: await keySender(tx, key.familyId, entry.id), organizer: await organizerName(tx, key.familyId)};
  });
  const viewer = await getViewer();

  if (!key || !found) {
    return (
      <Screen actions={<ButtonLink href="/sign-in" transition="push">{t("toSignIn")}</ButtonLink>}>
        <div aria-hidden="true" className="flex justify-center pt-12"><KnitMotif name="lock" cell={10} /></div>
        <PageTitle title={t("missing")} lead={t("missingLead")} className="pt-6" />
        <p role="alert" className="sr-only">{auth("feedback.unavailable")}</p>
      </Screen>
    );
  }

  const {entry, sender, organizer} = found;
  const other = viewer && (viewer.familyId !== key.familyId || viewer.personId !== entry.personId);
  if (other) {
    // a forwarded key, refused (10.6): this phone stays signed in as someone else, and nothing changes
    const current = await withFamily(viewer.familyId, (tx) => activePerson(tx, viewer.familyId, viewer.personId));
    const currentName = current?.displayName ?? "";
    const device = auth(`device.${await currentDeviceKind()}`);
    return (
      <Screen actions={<ButtonLink href="/" icon="home">{t("home", {current: currentName})}</ButtonLink>}>
        <div aria-hidden="true" className="flex justify-center pt-12"><KnitMotif name="lock" cell={10} /></div>
        <PageTitle title={t("title", {name: entry.name})} lead={t("lead", {name: entry.name, current: currentName})} className="pt-6" />
        <div className="px-edge pt-5">
          <Card className="p-[18px]">
            <div className="flex items-center gap-3">
              <Avatar name={currentName} />
              <div className="flex min-w-0 flex-col">
                <p className="text-card-title">{t("signedInAs", {current: currentName})}</p>
                <p className="text-body text-muted-ink">{t("onDevice", {device})}</p>
              </div>
            </div>
            <NoteTrack className="mt-3">{t("note", {name: entry.name})}</NoteTrack>
          </Card>
        </div>
      </Screen>
    );
  }

  const view = {...entry, usedAt: entry.usedAt?.toISOString() ?? null};
  if (entry.usedAt && viewer) {
    // already yours, on this phone
    return (
      <Screen actions={<ButtonLink href="/account" transition="push">{auth("openAccount")}</ButtonLink>}>
        <PageTitle title={auth("yourKey")} lead={auth("feedback.usedKey")} className="pt-10" />
      </Screen>
    );
  }
  if (entry.usedAt) {
    return <KeyAlreadyOpened familyId={key.familyId} value={key.token} typed={false} entry={view} organizer={organizer ?? ""} />;
  }
  if (!entry.available) {
    return (
      <Screen actions={<ButtonLink href="/sign-in" transition="push">{t("toSignIn")}</ButtonLink>}>
        <div aria-hidden="true" className="flex justify-center pt-12"><KnitMotif name="lock" cell={10} /></div>
        <PageTitle title={t("missing")} lead={t("missingLead")} className="pt-6" />
        <p role="alert" className="sr-only">{auth("feedback.unavailable")}</p>
      </Screen>
    );
  }
  const otherLocale = locale === "es" ? "en" : "es";
  return (
    <KeyWelcome familyId={key.familyId} value={key.token} typed={false} entry={view} sender={sender}
      otherLanguage={{href: `/key/${raw}`, locale: otherLocale}} />
  );
}

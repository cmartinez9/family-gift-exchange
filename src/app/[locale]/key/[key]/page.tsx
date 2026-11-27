import type {Metadata} from "next";
import {getLocale, getTranslations} from "next-intl/server";
import {Avatar} from "@/components/ui/avatar";
import {ButtonLink} from "@/components/ui/button";
import {Card, NoteTrack} from "@/components/ui/card";
import {KnitMotif} from "@/components/ui/knit/knit-motif";
import {PageTitle} from "@/components/ui/page-header";
import {Screen} from "@/components/ui/screen";
import {getViewer} from "@/server/auth";
import {activePerson, inspectKey, parseLinkKey} from "@/server/auth/access";
import {keySender, organizerContacts} from "@/server/auth/account";
import {PREVIEW_SIZE, previewPieces} from "@/server/auth/key-preview-svg";
import {appOrigin, currentDeviceKind} from "@/server/auth/request";
import {withFamily} from "@/server/db/client";
import {KeyAlreadyOpened, KeyWelcome} from "../../sign-in/get-in";
import {SignInHelp} from "../../sign-in/screen";
import {OrganizerHelpProvider} from "../../sign-in/ask-for-help";
import {screenTitle} from "../../sign-in/title";
import {UsedKeyOpening} from "../../sign-in/used-key-opening";
import {linkPreview} from "./link-preview";

/** Chat metadata must use linkPreview's read-only projection rather than the sign-in actions. */
export async function generateMetadata({params}: {params: Promise<{locale: string; key: string}>}): Promise<Metadata> {
  const {locale, key} = await params;
  const t = await getTranslations("getIn.preview");
  const home = await getTranslations("home");
  const preview = await linkPreview(key);
  const title = preview ? t("title", {name: preview.name}) : home("title");
  // "Martinez" reads "Martinez family"; a name that already says family is kept as it is
  const family = preview && (/\bfamil(?:y|ia)\b/i.test(preview.familyName) ? preview.familyName : t("family", {family: preview.familyName}));
  const description = preview ? `${family} · ${t("season", {year: preview.year})}` : t("generic");
  const stitchedName = previewPieces(preview?.name ?? null).find(({text}) => text)?.text;
  const images = [{
    url: new URL(`/${locale}/key/${key}/preview`, appOrigin()).toString(),
    ...PREVIEW_SIZE, type: "image/png", alt: stitchedName ? t("picture", {name: stitchedName}) : t("genericPicture"),
  }];
  return {
    ...await screenTitle("hello.title"),
    referrer: "no-referrer", robots: {index: false, follow: false},
    openGraph: {type: "website", title, description, images},
    twitter: {card: "summary_large_image", title, description, images},
  };
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
    return {entry, sender: await keySender(tx, key.familyId, entry.id), organizers: await organizerContacts(tx, key.familyId)};
  });
  const viewer = await getViewer();

  if (!key || !found) {
    return (
      <Screen actions={<>
        <ButtonLink href="/sign-in" transition="push">{t("toSignIn")}</ButtonLink>
        <SignInHelp familyId={viewer?.familyId ?? key?.familyId} personId={viewer?.personId} />
      </>}>
        {/* A used key for someone with a helper gets the same screen as an unknown key. */}
        {key && <UsedKeyOpening link={raw} />}
        <div aria-hidden="true" className="flex justify-center pt-12"><KnitMotif name="lock" cell={10} /></div>
        <PageTitle title={t("missing")} lead={t("missingLead")} className="pt-6" />
        <p role="alert" className="sr-only">{auth("feedback.unavailable")}</p>
      </Screen>
    );
  }

  const {entry, sender, organizers} = found;
  const organizer = organizers[0]?.name ?? "";
  const help = <SignInHelp familyId={key.familyId} personId={entry.personId} />;
  const other = viewer && (viewer.familyId !== key.familyId || viewer.personId !== entry.personId);
  if (other) {
    // A forwarded key keeps the current sign-in. A used key still generates a notice for its owner.
    const current = await withFamily(viewer.familyId, (tx) => activePerson(tx, viewer.familyId, viewer.personId));
    const currentName = current?.displayName ?? "";
    const device = auth(`device.${await currentDeviceKind()}`);
    return (
      <Screen actions={<>
        <ButtonLink href="/" icon="home">{t("home", {current: currentName})}</ButtonLink>
        {help}
      </>}>
        {entry.usedAt && <UsedKeyOpening link={raw} />}
        <div aria-hidden="true" className="flex justify-center pt-12"><KnitMotif name="lock" cell={10} /></div>
        <PageTitle title={t("title", {name: entry.name})} lead={t(entry.usedAt ? "usedLead" : "lead", {name: entry.name, current: currentName})} className="pt-6" />
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
      <Screen actions={<>
        <ButtonLink href="/account" transition="push">{auth("openAccount")}</ButtonLink>
        {help}
      </>}>
        <PageTitle title={auth("yourKey")} lead={auth("feedback.usedKey")} className="pt-10" />
      </Screen>
    );
  }
  if (entry.usedAt) {
    return <OrganizerHelpProvider organizers={organizers}>
      <KeyAlreadyOpened familyId={key.familyId} value={key.token} typed={false} entry={view} organizer={organizer} />
    </OrganizerHelpProvider>;
  }
  if (!entry.available) {
    return (
      <Screen actions={<>
        <ButtonLink href="/sign-in" transition="push">{t("toSignIn")}</ButtonLink>
        {help}
      </>}>
        <div aria-hidden="true" className="flex justify-center pt-12"><KnitMotif name="lock" cell={10} /></div>
        <PageTitle title={t("missing")} lead={t("missingLead")} className="pt-6" />
        <p role="alert" className="sr-only">{auth("feedback.unavailable")}</p>
      </Screen>
    );
  }
  const otherLocale = locale === "es" ? "en" : "es";
  return (
    <OrganizerHelpProvider organizers={organizers}>
      <KeyWelcome familyId={key.familyId} value={key.token} typed={false} entry={view} sender={sender} organizer={organizer}
        otherLanguage={{href: `/key/${raw}`, locale: otherLocale}} />
    </OrganizerHelpProvider>
  );
}

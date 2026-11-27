import {getTranslations} from "next-intl/server";
import {ModeBanner, modeActionClass} from "@/components/ui/mode-banner";
import {getViewer} from "@/server/auth";
import {activePerson} from "@/server/auth/access";
import {withFamily} from "@/server/db/client";
import {stopHelping} from "./actions";

/**
 * "You're helping Tito": the one ink banner under the status bar on every screen while you act for someone
 * you help, with Done to go back to being yourself. Nothing shows otherwise.
 */
export async function HelpingBanner() {
  const viewer = await getViewer();
  if (!viewer || viewer.actingAs === viewer.personId) return null;
  const [t, person] = await Promise.all([
    getTranslations("helping"),
    withFamily(viewer.familyId, (tx) => activePerson(tx, viewer.familyId, viewer.actingAs)),
  ]);
  if (!person) return null;
  return (
    <ModeBanner icon="user" label={t("label")} action={(
      <form action={stopHelping}>
        <button type="submit" className={modeActionClass}>{t("done")}</button>
      </form>
    )}>
      {t("banner", {name: person.displayName})}
    </ModeBanner>
  );
}

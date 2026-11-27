import {getTranslations} from "next-intl/server";
import {CloseSeasonSheet} from "./close-season-sheet";
import {closeSeason} from "./season-actions";

/**
 * Closing the season cannot be undone and changes it for everyone, so it asks in a sheet. Once closed,
 * the organizer lands on the season's wrap.
 */
export async function CloseSeason({exchangeId, name}: {exchangeId: string; name: string}) {
  const [t, draw, ui] = await Promise.all([getTranslations("season"), getTranslations("draw"), getTranslations("ui")]);
  return (
    <CloseSeasonSheet action={closeSeason.bind(null, exchangeId)} labels={{
      open: draw("close"), title: t("closeTitle", {name}), close: ui("close"), lists: t("closeLists"),
      sealed: t("closeSealed"), marks: t("closeMarks"), confirm: t("closeConfirm", {name}), notYet: t("notYet"),
    }} />
  );
}

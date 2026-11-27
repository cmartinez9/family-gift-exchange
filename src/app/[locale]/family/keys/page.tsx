import {getLocale, getTranslations} from "next-intl/server";
import {notFound} from "next/navigation";
import {ButtonLink} from "@/components/ui/button";
import {Card} from "@/components/ui/card";
import {BackRow, PageTitle} from "@/components/ui/page-header";
import {Screen} from "@/components/ui/screen";
import {requireViewer} from "@/server/auth";
import {readiness} from "@/server/auth/families";
import {appOrigin} from "@/server/auth/request";
import {withFamily} from "@/server/db/client";
import {SetupSteps} from "../../exchanges/setup";
import {KeysList} from "./key-row";

export const metadata = {referrer: "no-referrer", robots: {index: false, follow: false}};

export default async function KeysPage() {
  const viewer = await requireViewer();
  const board = await withFamily(viewer.familyId, (tx) => readiness(tx, viewer, new Date()));
  if (!board?.canSendKeys) notFound();
  const [t, draw, ui, locale] = await Promise.all([getTranslations("auth"), getTranslations("draw"), getTranslations("ui"), getLocale()]);
  const familyLink = new URL(`/${locale}/sign-in?family=${viewer.familyId}`, appOrigin()).href;
  const names = new Map(board.members.map(({id, name}) => [id, name]));
  const own = board.members.filter(({helperId}) => !helperId);
  // the last setup step: names are drawn and someone still has a key to open
  const setup = !board.constraintsOpen && own.some(({joinedAt}) => !joinedAt);
  return (
    <Screen back="/family" className="print:min-h-0 print:bg-white print:text-black print:[&>[data-actions]]:hidden"
      actions={<ButtonLink href="/family/group-chat" transition="push" icon="share">{draw("keys.tellFamily")}</ButtonLink>}>
      <div className="print:hidden">
        {setup ? <SetupSteps step={5} /> : <BackRow href="/family" parent={draw("season.peopleAndHouses")} backLabel={ui("back")} />}
        <PageTitle title={t("sendKeys")} lead={draw("keys.lead")} />
      </div>
      <div id="requests" />
      <KeysList people={own.map(({id, name, joinedAt}) => ({
        id, name, joined: Boolean(joinedAt), sent: board.sent.some(({personId}) => personId === id),
        requestedAt: board.requests.find(({personId}) => personId === id)?.at.toISOString(),
      }))} helped={board.members.filter(({helperId}) => helperId).map(({id, name, helperId}) => ({id, name, helper: names.get(helperId!) ?? ""}))} />
      <div className="px-edge pt-3 pb-6 print:hidden">
        <Card className="flex flex-col gap-1.5">
          <label htmlFor="family-address" className="text-body font-bold text-muted-ink">{t("familyReturnAddress")}</label>
          <input id="family-address" readOnly value={familyLink}
            className="h-14 w-full rounded-pill bg-card-track px-5 text-body font-semibold text-ink focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-ink" />
          <p className="text-body text-muted-ink">{draw("keys.addressHint")}</p>
        </Card>
      </div>
    </Screen>
  );
}

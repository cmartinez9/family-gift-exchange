import {getTranslations} from "next-intl/server";
import {Card, IconDisc, stackRow, stackWords} from "@/components/ui/card";
import {cn} from "@/components/ui/cn";
import {KnitField} from "@/components/ui/knit/knit-svg";
import {ModeBanner, modeActionClass} from "@/components/ui/mode-banner";
import {KnitIn} from "@/components/ui/motion/knit-in";
import {AppLink} from "@/components/ui/navigation";
import {PageTitle} from "@/components/ui/page-header";
import {Screen} from "@/components/ui/screen";
import {requireViewer} from "@/server/auth";
import {DrawError, previewAsMember} from "@/server/draw";
import {DrawRecovery, drawPage, ExchangeFacts} from "../../../components";

/** Preview as someone: their screens with everything about the draw left blank, even here. */
export default async function PreviewPage({params}: {params: Promise<{exchangeId: string; personId: string}>}) {
  const viewer = await requireViewer();
  const {exchangeId, personId} = await params;
  const t = await getTranslations("draw");
  const preview = await drawPage(previewAsMember(viewer, exchangeId, personId));
  if (preview instanceof DrawError) return <DrawRecovery error={preview} manageId={exchangeId} />;
  const manage = `/exchanges/${exchangeId}/manage`;
  return (
    <Screen back={manage}>
      <ModeBanner icon="eye" label={t("setup.mode")}
        action={<AppLink href={manage} transition="back" prefetch={false} className={modeActionClass}>{t("setup.stop")}</AppLink>}>
        {t("setup.seeingAs", {name: preview.displayName})}
      </ModeBanner>
      <PageTitle title={t("previewTitle", {name: preview.displayName})} lead={`${preview.exchange.name}. ${t("previewNote")}`} />
      <KnitIn className="flex flex-col gap-3 px-edge pt-6 pb-8">
        <Card className="flex flex-col gap-3">
          <div className={cn("flex items-center gap-3.5", stackRow)}>
            <IconDisc icon="lock" />
            <div className={cn("flex min-w-0 flex-col", stackWords)}>
              <h2 className="text-card-title">{t("setup.hiddenPerson", {name: preview.displayName})}</h2>
              <p className="text-body text-muted-ink">{t(preview.draw)}</p>
            </div>
          </div>
          <div aria-hidden="true" className="relative h-[68px] overflow-hidden rounded-track bg-card-track">
            <KnitField stitch="#E5D8C3" cell={11} className="absolute inset-0" />
          </div>
        </Card>
        <Card className={cn("flex flex-row items-center gap-3.5", stackRow)}>
          <IconDisc icon="message" />
          <div className={cn("flex min-w-0 flex-col", stackWords)}>
            <h2 className="text-card-title">{t("questions")}</h2>
            <p className="text-body text-muted-ink">{t(preview.draw)}</p>
          </div>
        </Card>
        <ExchangeFacts details={preview.exchange} />
      </KnitIn>
    </Screen>
  );
}

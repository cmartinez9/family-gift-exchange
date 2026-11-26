import {getTranslations} from "next-intl/server";
import {Card} from "@/components/ui/card";
import {Icon, type IconName} from "@/components/ui/icon";
import {KnitMotif} from "@/components/ui/knit/knit-motif";
import {StitchedText} from "@/components/ui/knit/stitched-text";
import {BackRow, PageTitle} from "@/components/ui/page-header";
import {Screen} from "@/components/ui/screen";

function Fact({icon, children}: {icon: IconName; children: string}) {
  return (
    <li className="flex items-start gap-3.5">
      <Icon name={icon} size={24} strokeWidth={2.3} className="mt-0.5 text-pine" />
      <p className="min-w-0 flex-1 text-body font-semibold">{children}</p>
    </li>
  );
}

/** That's a wrap: a closed season. What stays, and that the draw stays sealed. */
export async function SeasonWrap({name}: {name: string}) {
  const [t, draw, ui] = await Promise.all([getTranslations("season"), getTranslations("draw"), getTranslations("ui")]);
  return (
    <Screen back="/exchanges">
      <BackRow href="/exchanges" parent={draw("title")} backLabel={ui("back")} />
      <div className="flex flex-col items-center gap-4 px-edge pt-4" aria-hidden="true">
        <StitchedText text={t("stitched")} cell={9} knit className="max-w-full [&>svg]:h-auto [&>svg]:max-w-full" />
        <KnitMotif name="tree" cell={5.5} />
      </div>
      <PageTitle title={t("wrapTitle")} lead={t("wrapLead", {name})} className="pt-6" />
      <div className="px-edge pt-5 pb-8">
        <Card>
          <ul className="flex flex-col gap-3.5">
            <Fact icon="list">{t("wrapList")}</Fact>
            <Fact icon="lock">{t("wrapSealed")}</Fact>
          </ul>
        </Card>
      </div>
    </Screen>
  );
}

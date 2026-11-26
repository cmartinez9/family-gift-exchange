import {getTranslations} from "next-intl/server";
import {FairIsleBand} from "@/components/ui/knit/knit-svg";
import {KnitMotif} from "@/components/ui/knit/knit-motif";
import {PageTitle} from "@/components/ui/page-header";
import {StartForm} from "./form";

export default async function StartPage() {
  const setup = await getTranslations("draw.setup");
  return (
    <StartForm hero={<>
      <div className="flex justify-center pt-12"><KnitMotif name="gift" cell={9.5} /></div>
      <FairIsleBand kind="trees" cell={5} className="mt-5" />
      <PageTitle title={setup("startTitle")} lead={setup("startLead")} className="pt-6" />
    </>} />
  );
}

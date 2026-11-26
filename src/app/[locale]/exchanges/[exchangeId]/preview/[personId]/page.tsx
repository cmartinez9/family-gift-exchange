import {getTranslations} from "next-intl/server";
import {Link} from "@/i18n/navigation";
import {requireViewer} from "@/server/auth";
import {DrawError, previewAsMember} from "@/server/draw";
import {DrawRecovery, drawPage, ExchangeFacts} from "../../../components";
import {heading, link, panel, screen, subheading} from "../../../styles";

export default async function PreviewPage({params}: {params: Promise<{exchangeId: string; personId: string}>}) {
  const viewer = await requireViewer();
  const {exchangeId, personId} = await params;
  const t = await getTranslations("draw");
  const preview = await drawPage(previewAsMember(viewer, exchangeId, personId));
  if (preview instanceof DrawError) return <main className={screen}><DrawRecovery error={preview} manageId={exchangeId} /></main>;
  return (
    <main className={screen}>
      <Link className={link} href={`/exchanges/${exchangeId}/manage`} prefetch={false}>{t("backToManage")}</Link>
      <h1 className={heading}>{t("previewTitle", {name: preview.displayName})}</h1>
      <p>{t("previewNote")}</p>
      <h2 className={subheading}>{preview.exchange.name}</h2>
      <section className={panel}>
        <h3 className={subheading}>{t("yourPerson")}</h3>
        <p>{t(preview.draw)}</p>
      </section>
      <section className={panel}>
        <h3 className={subheading}>{t("questions")}</h3>
        <p>{t(preview.draw)}</p>
      </section>
      <section className={panel}>
        <h3 className={subheading}>{t("detailsTitle")}</h3>
        <ExchangeFacts details={preview.exchange} />
      </section>
    </main>
  );
}

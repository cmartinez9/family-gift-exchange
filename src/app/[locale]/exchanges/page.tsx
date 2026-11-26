import {getTranslations} from "next-intl/server";
import {ButtonLink} from "@/components/ui/button";
import {Card, Chevron, IconDisc, ListRow, Rows} from "@/components/ui/card";
import {FairIsleBand} from "@/components/ui/knit/knit-svg";
import {KnitMotif} from "@/components/ui/knit/knit-motif";
import {KnitIn} from "@/components/ui/motion/knit-in";
import {AppLink} from "@/components/ui/navigation";
import {BackRow, PageTitle, SectionHeading} from "@/components/ui/page-header";
import {Screen} from "@/components/ui/screen";
import {requireViewer} from "@/server/auth";
import {DrawError, listExchanges} from "@/server/draw";
import {DrawRecovery, drawPage} from "./components";

export default async function ExchangesPage() {
  const viewer = await requireViewer();
  const [t, ui] = await Promise.all([getTranslations("draw"), getTranslations("ui")]);
  const exchanges = await drawPage(listExchanges(viewer));
  if (exchanges instanceof DrawError) return <DrawRecovery error={exchanges} />;
  const active = exchanges.find(({status}) => status !== "closed");
  const past = exchanges.filter(({status}) => status === "closed");
  const organizer = viewer.isOrganizer && viewer.actingAs === viewer.personId;

  // the organizer with nothing running: the start screen, with a practice family to try first
  if (organizer && !active) {
    return (
      <Screen back="/account" actions={<>
        <ButtonLink href="/exchanges/new" transition="push" icon="arrow">{t("new")}</ButtonLink>
        <ButtonLink href="/exchanges/practice" transition="push" variant="outline" prefetch={false}>{t("setup.practiceFirst")}</ButtonLink>
      </>}>
        <BackRow href="/account" parent={t("account")} backLabel={ui("back")} />
        <div className="flex justify-center pt-6"><KnitMotif name="gift" cell={9.5} /></div>
        <FairIsleBand kind="trees" cell={5} className="mt-5" />
        <PageTitle title={t("setup.startTitle")} lead={t("setup.startLead")} className="pt-6" />
        <PastExchanges past={past} />
      </Screen>
    );
  }

  return (
    <Screen back="/account">
      <BackRow href="/account" parent={t("account")} backLabel={ui("back")} />
      <PageTitle title={t("title")} />
      <KnitIn className="flex flex-col gap-3 px-edge pt-6">
        {active ? (
          <AppLink href={`/exchanges/${active.id}${organizer ? "/manage" : ""}`} transition="push" prefetch={false}
            className="fge-press block rounded-card">
            <Card as="span" tone="next" className="flex flex-row items-center gap-3.5 py-4">
              <IconDisc icon="gift" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-card-title">{active.name}</span>
                <span className="text-body text-gold-ink">{t(organizer ? "manage" : "yourPerson")}</span>
              </span>
              <Chevron />
            </Card>
          </AppLink>
        ) : <Card><p className="text-body">{t("noExchanges")}</p></Card>}
        {organizer && (
          <AppLink href="/exchanges/practice" transition="push" prefetch={false} className="fge-press block rounded-card">
            <Card as="span" className="flex flex-row items-center gap-3.5 py-4">
              <IconDisc icon="family" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-card-title">{t("practiceTitle")}</span>
                <span className="text-body text-muted-ink">{t("setup.practiceRow")}</span>
              </span>
              <Chevron />
            </Card>
          </AppLink>
        )}
      </KnitIn>
      <PastExchanges past={past} />
    </Screen>
  );
}

async function PastExchanges({past}: {past: Array<{id: string; name: string}>}) {
  if (!past.length) return null;
  const t = await getTranslations("draw");
  return (
    <section className="pb-8">
      <SectionHeading title={t("past")} />
      <div className="px-edge">
        <Card flush className="px-5 py-1">
          <Rows as="ul">
            {past.map(({id, name}) => (
              <li key={id}>
                <AppLink href={`/exchanges/${id}`} transition="push" prefetch={false} className="fge-press block">
                  <ListRow as="span" title={name} trail={<Chevron />} />
                </AppLink>
              </li>
            ))}
          </Rows>
        </Card>
      </div>
    </section>
  );
}

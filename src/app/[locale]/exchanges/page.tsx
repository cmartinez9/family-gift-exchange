import {getTranslations} from "next-intl/server";
import {Link} from "@/i18n/navigation";
import {requireViewer} from "@/server/auth";
import {listExchanges} from "@/server/draw";
import {drawPage} from "./components";
import {button, heading, link, panel, screen, subheading} from "./styles";

export default async function ExchangesPage() {
  const viewer = await requireViewer();
  const t = await getTranslations("draw");
  const exchanges = await drawPage(listExchanges(viewer));
  const active = exchanges.find(({status}) => status !== "closed");
  const past = exchanges.filter(({status}) => status === "closed");
  const organizer = viewer.isOrganizer && viewer.actingAs === viewer.personId;

  return (
    <main className={screen}>
      <Link className={link} href="/account">{t("account")}</Link>
      <h1 className={heading}>{t("title")}</h1>
      {active ? (
        <section aria-labelledby="current-exchange" className="space-y-2">
          <h2 id="current-exchange" className={subheading}>{t("current")}</h2>
          <Link className={button} href={`/exchanges/${active.id}${organizer ? "/manage" : ""}`} prefetch={false}>
            {active.name}
          </Link>
        </section>
      ) : organizer ? (
        <Link className={button} href="/exchanges/new">{t("new")}</Link>
      ) : !past.length && <p>{t("noExchanges")}</p>}
      {organizer && <p><Link className={link} href="/exchanges/practice" prefetch={false}>{t("practiceTitle")}</Link></p>}
      {past.length > 0 && (
        <section className={panel}>
          <h2 className={subheading}>{t("past")}</h2>
          <ul>
            {past.map(({id, name}) => <li key={id}><Link className={link} href={`/exchanges/${id}`} prefetch={false}>{name}</Link></li>)}
          </ul>
        </section>
      )}
    </main>
  );
}

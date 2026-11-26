import {getFormatter, getTranslations} from "next-intl/server";
import {Link} from "@/i18n/navigation";
import {requireViewer} from "@/server/auth";
import {getListExchangeCard, listFamilyWishlists} from "@/server/lists";
import {getListRecipient} from "@/server/lists/my-person";
import {saveBudget} from "./actions";
import {ListForm} from "./controls";
import {splitFamilyLists} from "./family-list-order";
import {inputClass, linkClass, panelClass} from "./styles";

export default async function FamilyListsPage() {
  const viewer = await requireViewer();
  const [members, exchange, t, format] = await Promise.all([
    listFamilyWishlists(viewer), getListExchangeCard(viewer), getTranslations("lists"), getFormatter(),
  ]);
  const recipientId = await getListRecipient(viewer, exchange?.id);
  const {recipient, others} = splitFamilyLists(members, recipientId);
  const canSetBudget = viewer.isOrganizer && viewer.actingAs === viewer.personId;
  return (
    <>
      <h1 className="text-2xl font-semibold">{t("familyLists")}</h1>
      {recipient && (
        <section className={panelClass} aria-labelledby="recipient-heading">
          <h2 id="recipient-heading" className="text-xl font-semibold">{t("givingTo", {name: recipient.name})}</h2>
          <p>{t("itemCount", {count: recipient.itemCount})}</p>
          <Link className={linkClass} href={`/lists/${recipient.id}`}>{t("openList")}</Link>
        </section>
      )}
      <section className="space-y-2">
        {recipient && <h2 className="text-xl font-semibold">{t("otherLists")}</h2>}
        <ul className="divide-y divide-current/25">
          {others.map(({id, name, itemCount, ready}) => (
            <li key={id} className="pb-3">
              <Link className={`${linkClass} font-medium`} href={`/lists/${id}`}>{name}</Link>
              <p>{t("itemCount", {count: itemCount})} · {t(ready ? "ready" : "notReady")}</p>
            </li>
          ))}
        </ul>
      </section>
      {exchange && (
        <section className={panelClass} aria-labelledby="exchange-heading">
          <h2 id="exchange-heading" className="text-xl font-semibold">{exchange.name}</h2>
          {exchange.giftDay && <p>{t("giftDay", {day: format.dateTime(new Date(exchange.giftDay), {dateStyle: "long", timeZone: "UTC"})})}</p>}
          {exchange.place && <p className="break-words">{exchange.place}</p>}
          <p>{exchange.budgetAmount === null ? t("noBudget") : t("budgetAmount", {
            amount: format.number(Number(exchange.budgetAmount), {style: "currency", currency: "USD"}),
          })}</p>
          {canSetBudget && (
            <details className="space-y-3">
              <summary className={linkClass}>{t("budget")}</summary>
              <ListForm action={saveBudget.bind(null, exchange.id)} label={t("saveBudget")}>
                <label className="block">
                  {t("budget")}
                  <input name="budget" className={inputClass} defaultValue={exchange.budgetAmount ?? ""}
                    inputMode="decimal" maxLength={11} aria-describedby="budget-help" />
                </label>
                <p id="budget-help">{t("budgetHelp")}</p>
              </ListForm>
            </details>
          )}
        </section>
      )}
    </>
  );
}

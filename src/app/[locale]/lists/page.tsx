import {getFormatter, getTranslations} from "next-intl/server";
import {Avatar} from "@/components/ui/avatar";
import {Card, Chevron, ListRow, Rows} from "@/components/ui/card";
import {TextField} from "@/components/ui/inputs";
import {KnitIn} from "@/components/ui/motion/knit-in";
import {AppLink} from "@/components/ui/navigation";
import {PageTitle, SectionHeading} from "@/components/ui/page-header";
import {Pass} from "@/components/ui/pass";
import {Screen} from "@/components/ui/screen";
import {requireViewer} from "@/server/auth";
import {getListExchangeCard, listFamilyWishlists} from "@/server/lists";
import {getListRecipient} from "@/server/lists/my-person";
import {saveBudget} from "./actions";
import {ListForm} from "./controls";
import {splitFamilyLists} from "./family-list-order";
import {tabHrefs} from "./tabs";

/**
 * Family: your person first, on the pass, then everyone else. Your own list is the My list tab, so it is
 * not repeated here.
 */
export default async function FamilyListsPage() {
  const viewer = await requireViewer();
  const [members, exchange, t, format] = await Promise.all([
    listFamilyWishlists(viewer), getListExchangeCard(viewer), getTranslations("lists"), getFormatter(),
  ]);
  const recipientId = await getListRecipient(viewer, exchange?.id);
  const names = new Map(members.map(({id, name}) => [id, name]));
  const family = members.filter(({id}) => id !== viewer.actingAs);
  const {recipient, others} = splitFamilyLists(family, recipientId);
  const canSetBudget = viewer.isOrganizer && viewer.actingAs === viewer.personId;
  const money = (amount: string) => format.number(Number(amount), {style: "currency", currency: "USD"});
  const sub = ({helperId, itemCount, ready}: (typeof members)[number]) => {
    // a list with things but no sizes yet says so; an empty one already does
    const things = itemCount && !ready ? `${t("itemCount", {count: itemCount})} · ${t("notReady")}` : t("itemCount", {count: itemCount});
    if (helperId === viewer.personId) return `${t("helpedByYou")} · ${things}`;
    const helper = helperId ? names.get(helperId) : undefined;
    return helper ? `${t("helpedBy", {name: helper})} · ${things}` : things;
  };
  return (
    <Screen tab="family" tabHrefs={tabHrefs(viewer)}>
      <PageTitle title={t("familyLists")} count={t("peopleCount", {count: family.length})} />
      <KnitIn className="flex flex-col">
        {recipient && (
          <div className="px-edge pt-4">
            <Pass name={recipient.name} lead={t("passLead")} onlyYou={t("onlyYou")} href={`/lists/${recipient.id}`}
              openLabel={t("openPerson", {name: recipient.name})}
              budget={exchange?.budgetAmount ? money(exchange.budgetAmount) : undefined} />
          </div>
        )}
        {recipient && others.length > 0 && <SectionHeading title={t("restOfFamily")} />}
        {others.length > 0 && (
          <div className={recipient ? "px-edge" : "px-edge pt-4"}>
            <Card flush className="px-[18px] py-1">
              <Rows as="ul">
                {others.map((member) => (
                  <li key={member.id}>
                    <AppLink href={`/lists/${member.id}`} transition="push" className="fge-press block rounded-[24px]">
                      <ListRow as="span" lead={<Avatar name={member.name} />} title={member.name} sub={sub(member)}
                        trail={<Chevron />} className="min-h-[76px]" />
                    </AppLink>
                  </li>
                ))}
              </Rows>
            </Card>
          </div>
        )}
        {exchange && (canSetBudget || exchange.budgetAmount !== null) && (
          <section aria-label={exchange.name} className="flex flex-col">
            <SectionHeading title={exchange.name} className="[&_h2]:break-words" />
            <div className="px-edge pb-6">
              <Card>
                <p className="text-card-title">{exchange.budgetAmount === null ? t("noBudget") : t("budgetAmount", {amount: money(exchange.budgetAmount)})}</p>
                {canSetBudget && (
                  <ListForm action={saveBudget.bind(null, exchange.id)} label={t("saveBudget")} className="pt-3">
                    <TextField name="budget" label={t("budget")} hint={t("budgetHelp")} defaultValue={exchange.budgetAmount ?? ""}
                      inputMode="decimal" maxLength={11} />
                  </ListForm>
                )}
              </Card>
            </div>
          </section>
        )}
      </KnitIn>
    </Screen>
  );
}

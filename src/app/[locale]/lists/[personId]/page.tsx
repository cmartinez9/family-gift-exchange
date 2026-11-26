import {getFormatter, getTranslations} from "next-intl/server";
import {Link} from "@/i18n/navigation";
import {requireViewer} from "@/server/auth";
import {getListExchangeCard} from "@/server/lists";
import {getListRecipient} from "@/server/lists/my-person";
import {itemKinds} from "@/server/lists/validation";
import {loadWishlist} from "../data";
import {buttonClass, linkClass, panelClass} from "../styles";
import {ItemCard} from "./item-card";
import {ProfileSummary} from "./profile-summary";

const kindLabel = {link: "newLink", photo: "newPhoto", note: "newNote"} as const;

export default async function PersonListPage({params}: {params: Promise<{personId: string}>}) {
  const viewer = await requireViewer();
  const {personId} = await params;
  const [list, exchange, t, format] = await Promise.all([
    loadWishlist(viewer, personId), getListExchangeCard(viewer), getTranslations("lists"), getFormatter(),
  ]);
  const recipientId = await getListRecipient(viewer, exchange?.id);
  const yourPerson = recipientId === list.owner.id;
  const budget = yourPerson ? exchange?.budgetAmount ?? null : null;
  return (
    <>
      <h1 className="text-2xl font-semibold">{list.owner.id === viewer.personId
        ? t("myList") : t("namedList", {name: list.owner.name})}</h1>
      {list.canEdit && list.owner.id !== viewer.personId && <p>{t("helping", {name: list.owner.name})}</p>}
      {yourPerson && <p className="font-semibold">{t("yourPerson")}</p>}
      {yourPerson && <p>{budget === null ? t("noBudget") : t("budgetAmount", {
        amount: format.number(Number(budget), {style: "currency", currency: "USD"}),
      })}</p>}
      {list.canEdit && (
        <details className={panelClass} open={!list.items.length}>
          <summary className="min-h-12 cursor-pointer py-2 font-semibold">{t("addItem")}</summary>
          <ul className="flex flex-wrap gap-2">
            {itemKinds.map((kind) => (
              <li key={kind}>
                <Link className={buttonClass} href={`/lists/${list.owner.id}/items/new?kind=${kind}`}>{t(kindLabel[kind])}</Link>
              </li>
            ))}
          </ul>
        </details>
      )}
      {!list.items.length && <p>{t(list.canEdit ? "noItemsOwn" : "noItemsOther")}</p>}
      <ul className="space-y-4">
        {list.items.map((item, index) => (
          <li key={item.id}>
            <ItemCard item={item} ownerId={list.owner.id} actingAs={viewer.actingAs} canEdit={list.canEdit} canClaim={list.canClaim}
              first={index === 0} last={index === list.items.length - 1} budget={budget} />
          </li>
        ))}
      </ul>
      <ProfileSummary list={list} />
      {list.canEdit && <Link className={linkClass} href={`/lists/${list.owner.id}/profile`}>{t("editProfile")}</Link>}
    </>
  );
}

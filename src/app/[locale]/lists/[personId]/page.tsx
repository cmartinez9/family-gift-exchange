import {getLocale, getTranslations} from "next-intl/server";
import {Avatar} from "@/components/ui/avatar";
import {BackRow, PageTitle} from "@/components/ui/page-header";
import {KnitIn} from "@/components/ui/motion/knit-in";
import {Screen} from "@/components/ui/screen";
import {requireViewer} from "@/server/auth";
import {getListExchangeCard, type getWishlist} from "@/server/lists";
import {getListRecipient} from "@/server/lists/my-person";
import {FlashToast} from "../controls";
import {loadWishlist} from "../data";
import {toItemView} from "../item-view";
import {sizeLabel, tabHrefs} from "../tabs";
import {ClaimItem} from "./claim-item";
import {OwnList} from "./own-list";
import {ProfileSummary} from "./profile-summary";

type Wishlist = Awaited<ReturnType<typeof getWishlist>>;

/** "Tops M · Bottoms M · Shoe size 7½": the line on your own list's "My sizes" row. */
async function sizesLine(list: Wishlist) {
  const t = await getTranslations("lists");
  if (list.owner.noClothes) return t("noClothes");
  const sizes = new Map(list.sizes.map(({kind, value}) => [kind, value]));
  const parts = (["tops", "bottoms", "shoes"] as const).flatMap((kind) => {
    const value = sizes.get(kind);
    return value ? [t("sizeSummary", {label: t(`size.${kind}`), value: sizeLabel(value)})] : [];
  });
  return parts.length ? parts.join(" · ") : null;
}

export default async function PersonListPage({params, searchParams}: {
  params: Promise<{personId: string}>;
  searchParams: Promise<{done?: string}>;
}) {
  const viewer = await requireViewer();
  const [{personId}, {done}] = await Promise.all([params, searchParams]);
  const [list, exchange, t, ui, locale] = await Promise.all([
    loadWishlist(viewer, personId), getListExchangeCard(viewer), getTranslations("lists"), getTranslations("ui"), getLocale(),
  ]);
  const items = list.items.map((item) => toItemView(item, locale));

  if (list.canEdit) {
    const own = list.owner.id === viewer.personId;
    return (
      <Screen tab="list" tabHrefs={tabHrefs(viewer)}>
        <FlashToast message={done === "added" ? t("added") : done === "saved" ? t("saved") : null} />
        <PageTitle title={own ? t("myList") : t("namedList", {name: list.owner.name})} count={t("itemCount", {count: items.length})}
          lead={own ? t("myListLead") : t("helping", {name: list.owner.name})} />
        <OwnList ownerId={list.owner.id} items={items} sizes={await sizesLine(list)} closeLabel={ui("close")} />
      </Screen>
    );
  }

  const recipientId = await getListRecipient(viewer, exchange?.id);
  const budget = recipientId === list.owner.id ? exchange?.budgetAmount ?? null : null;
  return (
    <Screen back="/lists">
      <BackRow href="/lists" parent={t("familyLists")} backLabel={ui("back")} />
      <div className="flex items-center gap-4 px-edge pt-4 text-snow-white">
        <Avatar name={list.owner.name} on="ground" size={56} />
        <h1 className="min-w-0 break-words text-title">{t("namedList", {name: list.owner.name})}</h1>
      </div>
      <p className="px-edge pt-3 text-lead text-snow-white">{t("otherLead", {name: list.owner.name})}</p>
      <div className="flex flex-col gap-card-gap px-edge pt-5 pb-8">
        {items.length === 0
          ? <p className="text-body text-snow-white">{t("noItemsOther")}</p>
          : (
            <KnitIn as="ul" className="flex flex-col gap-card-gap">
              {items.map((item) => (
                <li key={item.id}><ClaimItem actingAs={viewer.actingAs} item={item} ownerName={list.owner.name} budget={budget} canClaim={list.canClaim} /></li>
              ))}
            </KnitIn>
          )}
        <ProfileSummary list={list} />
      </div>
    </Screen>
  );
}

import {getFormatter, getLocale, getTranslations} from "next-intl/server";
import {ItemCard} from "@/components/ui/item-card";
import {KnitIn} from "@/components/ui/motion/knit-in";
import {AppLink} from "@/components/ui/navigation";
import {BackRow, PageTitle} from "@/components/ui/page-header";
import {Screen} from "@/components/ui/screen";
import {requireViewer} from "@/server/auth";
import {getListExchangeCard} from "@/server/lists";
import {getGettingList} from "@/server/lists/claims";
import {getListRecipient} from "@/server/lists/my-person";
import {claimCommand} from "../actions";
import {ChecklistTick} from "../controls";
import {ItemThumb, photoPath} from "../item-view";
import {ChangedItem} from "./changed-item";

/**
 * Private Bought and Wrapped checklist. Uses ChangedItem for unacknowledged owner edits;
 * the user workflow is documented in README.md#wishlists-and-gifts.
 */
export default async function GettingPage() {
  const viewer = await requireViewer();
  const [items, exchange, t, ui, home, format, locale] = await Promise.all([
    getGettingList(viewer), getListExchangeCard(viewer), getTranslations("lists"), getTranslations("ui"),
    getTranslations("ui.tabs"), getFormatter(), getLocale(),
  ]);
  const recipientId = await getListRecipient(viewer, exchange?.id);
  // one gold card per screen: the first changed gift
  const firstChanged = items.find((item) => item.changes.length)?.itemId;
  return (
    <Screen back="/">
      <BackRow href="/" parent={home("home")} backLabel={ui("back")} />
      <PageTitle title={t("getting")} lead={t("gettingLead")} />
      <div className="px-edge pt-5 pb-8">
        {!items.length && <p className="text-body text-snow-white">{t("emptyGetting")}</p>}
        <KnitIn as="ul" className="flex flex-col gap-card-gap">
          {items.map((item) => {
            const yours = item.ownerId === recipientId;
            const forWhom = yours ? t("gettingForPerson", {name: item.ownerName}) : t("gettingFor", {name: item.ownerName});
            const photo = item.hasPhoto ? photoPath(locale, item.itemId, item.updatedAt) : undefined;
            const gold = item.itemId === firstChanged;
            const settled = (
                <ItemCard tone={yours ? "mine" : "info"} titleAs="h2"
                  picture={<ItemThumb item={{kind: item.kind, photo}} />}
                  title={<span className="break-words">{item.title}</span>}
                  store={<AppLink href={`/lists/${item.ownerId}`} transition="push" className="underline decoration-1 underline-offset-4">{forWhom}</AppLink>}
                  price={item.price !== null ? format.number(Number(item.price), {style: "currency", currency: "USD"}) : undefined}
                  after={(
                    <div className="flex flex-wrap gap-2 pt-3.5">
                      <ChecklistTick label={t("bought")} checked={item.bought} onPine={yours}
                        action={claimCommand.bind(null, viewer.actingAs, item.itemId, "bought")} />
                      <ChecklistTick label={t("wrapped")} checked={item.wrapped} onPine={yours}
                        action={claimCommand.bind(null, viewer.actingAs, item.itemId, "wrapped")} />
                    </div>
                  )} />
            );
            return (
              <li key={item.itemId}>
                <article aria-label={item.title}>
                  {item.changes.length
                    ? (
                      <ChangedItem actingAs={viewer.actingAs} itemId={item.itemId} title={item.title} ownerName={item.ownerName}
                        version={item.version} changes={item.changes} gold={gold} settled={settled}
                        picture={<ItemThumb item={{kind: item.kind, photo}} on={gold ? "next" : "info"} />} />
                    )
                    : settled}
                </article>
              </li>
            );
          })}
        </KnitIn>
      </div>
    </Screen>
  );
}

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

/**
 * Things I'm getting: every gift you marked, with Bought and Wrapped. Only you see this page and these
 * ticks. Gifts for your person are pine, as everything only you may see is.
 */
export default async function GettingPage() {
  const viewer = await requireViewer();
  const [items, exchange, t, ui, home, format, locale] = await Promise.all([
    getGettingList(viewer), getListExchangeCard(viewer), getTranslations("lists"), getTranslations("ui"),
    getTranslations("ui.tabs"), getFormatter(), getLocale(),
  ]);
  const recipientId = await getListRecipient(viewer, exchange?.id);
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
            return (
              <li key={item.itemId}>
                <article aria-label={item.title}>
                <ItemCard tone={yours ? "mine" : "info"} titleAs="h2"
                  picture={<ItemThumb item={{kind: item.kind, photo: item.hasPhoto ? photoPath(locale, item.itemId, item.updatedAt) : undefined}} />}
                  title={<span className="break-words">{item.title}</span>}
                  store={<AppLink href={`/lists/${item.ownerId}`} transition="push" className="underline decoration-1 underline-offset-4">{forWhom}</AppLink>}
                  price={item.price !== null ? format.number(Number(item.price), {style: "currency", currency: "USD"}) : undefined}
                  after={(
                    <div className="flex gap-2 pt-3.5">
                      <ChecklistTick key={`bought-${item.bought}`} label={t("bought")} checked={item.bought} onPine={yours}
                        action={claimCommand.bind(null, viewer.actingAs, item.itemId, "bought")} />
                      <ChecklistTick key={`wrapped-${item.wrapped}`} label={t("wrapped")} checked={item.wrapped} onPine={yours}
                        action={claimCommand.bind(null, viewer.actingAs, item.itemId, "wrapped")} />
                    </div>
                  )} />
                </article>
              </li>
            );
          })}
        </KnitIn>
      </div>
    </Screen>
  );
}

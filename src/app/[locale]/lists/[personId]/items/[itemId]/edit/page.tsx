import {getLocale, getTranslations} from "next-intl/server";
import {notFound} from "next/navigation";
import {Card} from "@/components/ui/card";
import {BackRow, PageTitle} from "@/components/ui/page-header";
import {Screen} from "@/components/ui/screen";
import {requireViewer} from "@/server/auth";
import {itemCommand} from "../../../../actions";
import {ListForm} from "../../../../controls";
import {loadWishlist} from "../../../../data";
import {ItemForm} from "../../../../item-form";
import {photoPath} from "../../../../item-view";

/**
 * Editing one thing as its own page. The list opens the same form in a sheet; this page is where a direct
 * link, or a phone without scripts, lands.
 */
export default async function EditItemPage({params}: {params: Promise<{personId: string; itemId: string}>}) {
  const viewer = await requireViewer();
  const {personId, itemId} = await params;
  const [list, t, ui, locale] = await Promise.all([
    loadWishlist(viewer, personId, true), getTranslations("lists"), getTranslations("ui"), getLocale(),
  ]);
  const item = list.items.find(({id}) => id === itemId.toLowerCase());
  if (!item) notFound();
  const back = `/lists/${list.owner.id}`;
  const parent = list.owner.id === viewer.personId ? t("myList") : t("namedList", {name: list.owner.name});
  return (
    <Screen back={back}>
      <BackRow href={back} parent={parent} backLabel={ui("back")} />
      <PageTitle title={t("editItem")} />
      <div className="flex flex-col gap-4 px-edge pt-5 pb-8">
        <Card>
          <ItemForm ownerId={list.owner.id} kind={item.kind} initial={{
            id: item.id, title: item.title, note: item.note, price: item.price, starred: item.starred, url: item.url,
            store: item.store, photo: item.hasPhoto ? photoPath(locale, item.id) : undefined,
          }} />
        </Card>
        <ListForm action={itemCommand.bind(null, list.owner.id, item.id, "delete")} label={t("deleteItem")} variant="outline" />
      </div>
    </Screen>
  );
}

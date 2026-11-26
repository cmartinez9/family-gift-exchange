import {getLocale, getTranslations} from "next-intl/server";
import {notFound} from "next/navigation";
import {Link} from "@/i18n/navigation";
import {requireViewer} from "@/server/auth";
import {loadWishlist} from "../../../../data";
import {ItemForm} from "../../../../item-form";
import {linkClass} from "../../../../styles";

export default async function EditItemPage({params}: {params: Promise<{personId: string; itemId: string}>}) {
  const viewer = await requireViewer();
  const {personId, itemId} = await params;
  const [list, t, locale] = await Promise.all([loadWishlist(viewer, personId, true), getTranslations("lists"), getLocale()]);
  const item = list.items.find(({id}) => id === itemId.toLowerCase());
  if (!item) notFound();
  return (
    <>
      <Link className={linkClass} href={`/lists/${list.owner.id}`}>{t("backToList")}</Link>
      <h1 className="text-2xl font-semibold">{t("editItem")}</h1>
      <ItemForm ownerId={list.owner.id} kind={item.kind} initial={{
        id: item.id, title: item.title, note: item.note, price: item.price, starred: item.starred, url: item.url,
        photo: item.hasPhoto ? `/${locale}/lists/photo/${item.id}/photo` : undefined,
      }} />
    </>
  );
}

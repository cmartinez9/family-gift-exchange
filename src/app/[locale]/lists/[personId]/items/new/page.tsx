import {getTranslations} from "next-intl/server";
import {notFound} from "next/navigation";
import {Link} from "@/i18n/navigation";
import {requireViewer} from "@/server/auth";
import {loadWishlist} from "../../../data";
import {ItemForm} from "../../../item-form";
import {linkClass} from "../../../styles";

export default async function NewItemPage({params, searchParams}: {
  params: Promise<{personId: string}>;
  searchParams: Promise<{kind?: string}>;
}) {
  const viewer = await requireViewer();
  const {personId} = await params;
  const {kind} = await searchParams;
  if (kind !== "link" && kind !== "photo" && kind !== "note") notFound();
  const [list, t] = await Promise.all([loadWishlist(viewer, personId, true), getTranslations("lists")]);
  return (
    <>
      <Link className={linkClass} href={`/lists/${list.owner.id}`}>{t("backToList")}</Link>
      <h1 className="text-2xl font-semibold">{t(kind === "link" ? "newLink" : kind === "photo" ? "newPhoto" : "newNote")}</h1>
      <ItemForm ownerId={list.owner.id} kind={kind} />
    </>
  );
}

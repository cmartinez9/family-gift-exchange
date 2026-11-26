import {getTranslations} from "next-intl/server";
import {notFound} from "next/navigation";
import {Card} from "@/components/ui/card";
import {BackRow, PageTitle} from "@/components/ui/page-header";
import {Screen} from "@/components/ui/screen";
import {requireViewer} from "@/server/auth";
import {loadWishlist} from "../../../data";
import {ItemForm} from "../../../item-form";

const TITLES = {link: "newLink", photo: "addPhotoTitle", note: "newNote"} as const;
const LEADS = {link: "addLinkSub", photo: "addPhotoSub", note: "addNoteSub"} as const;

export default async function NewItemPage({params, searchParams}: {
  params: Promise<{personId: string}>;
  searchParams: Promise<{kind?: string}>;
}) {
  const viewer = await requireViewer();
  const {personId} = await params;
  const {kind} = await searchParams;
  if (kind !== "link" && kind !== "photo" && kind !== "note") notFound();
  const [list, t, ui] = await Promise.all([loadWishlist(viewer, personId, true), getTranslations("lists"), getTranslations("ui")]);
  const back = `/lists/${list.owner.id}`;
  const parent = list.owner.id === viewer.personId ? t("myList") : t("namedList", {name: list.owner.name});
  return (
    <Screen back={back}>
      <BackRow href={back} parent={parent} backLabel={ui("back")} />
      <PageTitle title={t(TITLES[kind])} lead={t(LEADS[kind])} />
      <div className="px-edge pt-5 pb-8">
        <Card>
          <ItemForm ownerId={list.owner.id} kind={kind} />
        </Card>
      </div>
    </Screen>
  );
}

import {getTranslations} from "next-intl/server";
import {BackRow, PageTitle} from "@/components/ui/page-header";
import {Screen} from "@/components/ui/screen";
import {requireViewer} from "@/server/auth";
import {loadWishlist} from "../../data";
import {ProfileForm} from "./profile-form";

export default async function ProfilePage({params}: {params: Promise<{personId: string}>}) {
  const viewer = await requireViewer();
  const {personId} = await params;
  const [list, t, ui] = await Promise.all([loadWishlist(viewer, personId, true), getTranslations("lists"), getTranslations("ui")]);
  const own = list.owner.id === viewer.personId;
  const back = `/lists/${list.owner.id}`;
  return (
    <Screen back={back}>
      <BackRow href={back} parent={own ? t("myList") : t("namedList", {name: list.owner.name})} backLabel={ui("back")} />
      <PageTitle title={t("profile")} lead={own ? t("profileLead") : `${t("helping", {name: list.owner.name})} ${t("profileLead")}`} />
      <ProfileForm ownerId={list.owner.id} initialSizes={Object.fromEntries(list.sizes.map(({kind, value}) => [kind, value]))}
        initialAbout={list.about} initialNoClothes={list.owner.noClothes} />
    </Screen>
  );
}

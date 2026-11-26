import {getTranslations} from "next-intl/server";
import {Link} from "@/i18n/navigation";
import {requireViewer} from "@/server/auth";
import {loadWishlist} from "../../data";
import {linkClass} from "../../styles";
import {ProfileForm} from "./profile-form";

export default async function ProfilePage({params}: {params: Promise<{personId: string}>}) {
  const viewer = await requireViewer();
  const {personId} = await params;
  const [list, t] = await Promise.all([loadWishlist(viewer, personId, true), getTranslations("lists")]);
  return (
    <>
      <Link className={linkClass} href={`/lists/${list.owner.id}`}>{t("backToList")}</Link>
      <h1 className="text-2xl font-semibold">{t("profile")}</h1>
      {list.owner.id !== viewer.personId && <p>{t("helping", {name: list.owner.name})}</p>}
      <ProfileForm ownerId={list.owner.id} initialSizes={Object.fromEntries(list.sizes.map(({kind, value}) => [kind, value]))}
        initialAbout={list.about} initialNoClothes={list.owner.noClothes} />
    </>
  );
}

import {getTranslations} from "next-intl/server";
import {PageTitle} from "@/components/ui/page-header";
import {TextLink} from "@/components/ui/button";
import {Screen} from "@/components/ui/screen";
import {requireViewer} from "@/server/auth";
import {loadWishlist} from "../../../lists/data";
import {ProfileForm} from "../../../lists/[personId]/profile/profile-form";
import {WelcomeSteps} from "../../../sign-in/get-in";

export default async function WelcomeMoreSizesPage() {
  const viewer = await requireViewer({borrowed: "help"});
  const [list, t, sizes, ui] = await Promise.all([
    loadWishlist(viewer, viewer.actingAs, true), getTranslations("lists"),
    getTranslations("getIn.sizes"), getTranslations("ui"),
  ]);
  return (
    <Screen>
      <WelcomeSteps step={3} waitingStep={2} />
      <TextLink href="/welcome/sizes" replace className="self-start px-edge">{ui("back")} {sizes("title")}</TextLink>
      <PageTitle title={t("profile")} lead={t("profileLead")} />
      <ProfileForm ownerId={list.owner.id} initialSizes={Object.fromEntries(list.sizes.map(({kind, value}) => [kind, value]))}
        initialAbout={list.about} initialNoClothes={list.owner.noClothes} />
    </Screen>
  );
}

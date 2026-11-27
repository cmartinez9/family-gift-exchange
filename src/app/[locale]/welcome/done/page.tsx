import {getTranslations} from "next-intl/server";
import {ButtonLink} from "@/components/ui/button";
import {Card} from "@/components/ui/card";
import {Tick} from "@/components/ui/inputs";
import {KnitIn} from "@/components/ui/motion/knit-in";
import {Screen} from "@/components/ui/screen";
import {requireViewer} from "@/server/auth";
import {faceIdOnDevice, listCount, mySizes, organizerName} from "@/server/auth/account";
import {activePerson} from "@/server/auth/access";
import {phoneOwnerName} from "@/server/auth/borrowed";
import {withFamily} from "@/server/db/client";
import {Greeting, WelcomeSteps} from "../../sign-in/get-in";
import {BorrowedAllSet} from "../borrowed/hand-back";
import {screenTitle} from "../../sign-in/title";

function Row({done, title, sub}: {done: boolean; title: string; sub?: string}) {
  return (
    <li className="flex min-h-14 items-center gap-3.5 py-2">
      <Tick done={done} />
      <span className="flex min-w-0 flex-col">
        <span className="text-row-title">{title}</span>
        {sub && <span className="text-body text-muted-ink">{sub}</span>}
      </span>
    </li>
  );
}

export async function generateMetadata() {
  return screenTitle("done.home");
}

/** All set (2.10): the step bar knits up, ALL SET! knits in, and what you did is ticked. */
export default async function WelcomeDonePage() {
  const viewer = await requireViewer({borrowed: "help"});
  if (viewer.borrowed) {
    // on someone else's phone (9.5): the owner signs the relative out of it
    const names = await withFamily(viewer.familyId, async (tx) => ({
      name: (await activePerson(tx, viewer.familyId, viewer.personId))?.displayName ?? "",
      owner: await phoneOwnerName(tx, viewer) ?? "",
      organizer: await organizerName(tx, viewer.familyId) ?? "",
    }));
    return <BorrowedAllSet {...names} />;
  }
  const t = await getTranslations("getIn.done");
  const {sizes, things, face} = await withFamily(viewer.familyId, async (tx) => {
    const mine = await mySizes(tx, viewer.familyId, viewer.actingAs);
    return {
      sizes: mine.noClothes || Object.keys(mine.sizes).length > 0,
      things: await listCount(tx, viewer.familyId, viewer.actingAs),
      face: await faceIdOnDevice(tx, viewer),
    };
  });
  return (
    <Screen actions={<ButtonLink href="/" icon="arrow">{t("home")}</ButtonLink>}>
      <WelcomeSteps step={4} done allDone={sizes && things > 0} waitingStep={2} />
      <Greeting heading top={t("top")} bottom={t("bottom")} />
      <div className="px-edge pt-7">
        <Card flush className="px-5 py-2">
          <KnitIn as="ul" className="fge-rows flex flex-col">
            <Row done title={t("backIn")} sub={face ? t("backInFace") : t("backInPin")} />
            <Row done={sizes} title={sizes ? t("sizes") : t("sizesLater")} />
            <Row done={things > 0} title={things > 0 ? t("list", {count: things}) : t("listLater")} sub={things > 0 ? t("listSub") : undefined} />
          </KnitIn>
        </Card>
      </div>
    </Screen>
  );
}

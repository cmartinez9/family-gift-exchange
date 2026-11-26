import {getLocale, getTranslations} from "next-intl/server";
import {redirect} from "next/navigation";
import {ButtonLink} from "@/components/ui/button";
import {Card} from "@/components/ui/card";
import {Screen} from "@/components/ui/screen";
import {requireViewer} from "@/server/auth";
import {listFamilyWishlists} from "@/server/lists";
import {reveal} from "../exchanges/actions";
import {Reveal} from "../exchanges/reveal";
import {WelcomeSteps} from "../sign-in/get-in";
import {welcomeAssignment} from "./assignment";

export default async function WelcomePage() {
  const viewer = await requireViewer();
  const assignment = await welcomeAssignment(viewer);
  if (!assignment) redirect(`/${await getLocale()}/welcome/sizes`);
  const [t, sizes] = await Promise.all([getTranslations("draw"), getTranslations("getIn.sizes")]);
  const recipient = assignment.recipientId
    ? (await listFamilyWishlists(viewer)).find(({id}) => id === assignment.recipientId)
    : undefined;
  const context = {id: assignment.exchangeId, subject: viewer.actingAs, version: assignment.version};
  return (
    <Screen actions={<ButtonLink href="/welcome/sizes" icon="arrow" prefetch={false}>{sizes("title")}</ButtonLink>}>
      <WelcomeSteps step={2} />
      <div className="px-edge pt-6">
        <h1 className="pb-4 text-title">{t("yourPerson")}</h1>
        <Card><Reveal key={assignment.version} action={reveal.bind(null, context)}
          initial={recipient && {personName: recipient.name, personId: recipient.id}} /></Card>
      </div>
    </Screen>
  );
}

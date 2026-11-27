import {getLocale, getTranslations} from "next-intl/server";
import {redirect} from "next/navigation";
import {ButtonLink} from "@/components/ui/button";
import {requireViewer} from "@/server/auth";
import {MemberPerson} from "../exchanges/person";
import {WelcomeSteps} from "../sign-in/get-in";
import {welcomeAssignment} from "./assignment";

export default async function WelcomePage() {
  const viewer = await requireViewer();
  const assignment = await welcomeAssignment(viewer);
  if (!assignment) redirect(`/${await getLocale()}/welcome/sizes`);
  const [t, sizes] = await Promise.all([getTranslations("draw"), getTranslations("getIn.sizes")]);
  const context = {id: assignment.exchangeId, subject: viewer.actingAs, version: assignment.version};
  return (
    <MemberPerson key={`${context.subject}/${context.version}`} context={context} seen={Boolean(assignment.recipientId)}
      canReport={false} canAsk={false} budget={assignment.budgetAmount === null ? null : Number(assignment.budgetAmount)}
      outgoing={[]} incoming={[]} back="/" backLabel={t("person.backHome")} answerHref={`/exchanges/${context.id}?answer=1`}
      steps={<WelcomeSteps step={2} />}
      continuation={<ButtonLink href="/welcome/sizes" icon="arrow" prefetch={false}>{sizes("title")}</ButtonLink>} />
  );
}

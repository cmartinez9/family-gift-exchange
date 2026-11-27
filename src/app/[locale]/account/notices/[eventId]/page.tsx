import {getFormatter, getLocale, getTranslations} from "next-intl/server";
import {redirect} from "next/navigation";
import {ButtonLink} from "@/components/ui/button";
import {Card, IconDisc, stackRow, stackWords} from "@/components/ui/card";
import {cn} from "@/components/ui/cn";
import {Tick} from "@/components/ui/inputs";
import {PageTitle} from "@/components/ui/page-header";
import {Screen} from "@/components/ui/screen";
import {requireViewer} from "@/server/auth";
import {account} from "@/server/auth/security";
import {uuidPattern} from "@/server/auth/session";
import {withFamily} from "@/server/db/client";
import {Bullet} from "../../../sign-in/get-in";
import {noticeText} from "../../notice-text";
import {NotMeButton} from "../../rows";
import {screenTitle} from "../../../sign-in/title";

const LONG = {weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago"} as const;

export async function generateMetadata() {
  return screenTitle("wasThat.title");
}

/** Was that you? (11.5), and after "That wasn't me" (11.6). */
export default async function NoticePage({params}: {params: Promise<{eventId: string}>}) {
  const viewer = await requireViewer();
  const {eventId} = await params;
  const locale = await getLocale();
  if (!uuidPattern.test(eventId)) redirect(`/${locale}/account/notices`);
  const {activity} = await withFamily(viewer.familyId, (tx) => account(tx, viewer));
  const event = activity.find(({id}) => id === eventId);
  if (!event) redirect(`/${locale}/account/notices`);
  const t = await getTranslations("getIn.wasThat");
  const safe = await getTranslations("getIn.safe");
  const feedback = await getTranslations("auth.feedback");
  const format = await getFormatter();
  const text = await noticeText(event, viewer);

  if (event.disputed) {
    return (
      <Screen actions={<ButtonLink href="/account/notices" transition="back">{safe("back")}</ButtonLink>}>
        <PageTitle title={safe("title")} className="pt-10" />
        <div className="flex flex-col gap-3 px-edge pt-5">
          <Card className="fge-drop px-[18px] py-4" role="status">
            <div className={cn("flex items-center gap-3", stackRow)}>
              <Tick done />
              <div className={cn("flex min-w-0 flex-col", stackWords)}>
                <p className="text-card-title">{text.issuance ? safe("keyOff") : safe("signedOut", {device: text.device})}</p>
                <p className="text-body text-muted-ink">{text.issuance ? safe("keyOffSub") : safe("signedOutSub")}</p>
                <p className="sr-only">{feedback("reported")}</p>
              </div>
            </div>
          </Card>
          <Card className="px-[18px] py-4">
            <ul><Bullet icon="eye">{safe("told")}</Bullet></ul>
          </Card>
        </div>
      </Screen>
    );
  }
  if (!text.askable) redirect(`/${locale}/account/notices`);

  return (
    <Screen actions={<>
      <NotMeButton eventId={event.id} />
      <ButtonLink href="/account/notices" transition="back" variant="outline">{t("yes")}</ButtonLink>
    </>}>
      <PageTitle title={text.issuance ? t("expected") : t("title")} className="pt-10" />
      <div className="px-edge pt-5">
        <Card tone="next">
          <div className={cn("flex items-center gap-3.5", stackRow)}>
            <IconDisc icon={text.icon} />
            <div className={cn("flex min-w-0 flex-col", stackWords)}>
              <h2 className="text-card-title">{text.title}</h2>
              <p className="text-body text-gold-ink">{format.dateTime(event.at, LONG)}</p>
            </div>
          </div>
          <p className="pt-3.5 text-body">{text.issuance || event.kind === "keyUsed" ? t("bodyKey") : t("body", {device: text.device})}</p>
        </Card>
      </div>
    </Screen>
  );
}

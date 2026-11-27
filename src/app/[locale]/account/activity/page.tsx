import {getFormatter, getTranslations} from "next-intl/server";
import {Card, ListRow, Rows} from "@/components/ui/card";
import {BackRow, PageTitle} from "@/components/ui/page-header";
import {Screen} from "@/components/ui/screen";
import {requireViewer} from "@/server/auth";
import {familyActivity, organizerName} from "@/server/auth/account";
import {withFamily} from "@/server/db/client";
import {RowDisc} from "../rows";
import {screenTitle} from "../../sign-in/title";

const SHORT = {month: "short", day: "numeric", timeZone: "America/Chicago"} as const;

export async function generateMetadata() {
  return screenTitle("activity.title");
}

export default async function FamilyActivityPage() {
  const viewer = await requireViewer();
  const t = await getTranslations("getIn.activity");
  const you = await getTranslations("getIn.you");
  const ui = await getTranslations("ui");
  const format = await getFormatter();
  const {rows, organizer} = await withFamily(viewer.familyId, async (tx) => ({
    rows: await familyActivity(tx, viewer.familyId), organizer: await organizerName(tx, viewer.familyId) ?? "",
  }));
  return (
    <Screen back="/account">
      <BackRow href="/account" parent={you("label")} backLabel={ui("back")} />
      <PageTitle title={t("title")} lead={t("lead")} />
      <div className="px-edge pt-4 pb-8">
        <Card flush className="px-[18px] py-0.5">
          {rows.length === 0 ? <p className="py-4 text-body">{t("none")}</p> : (
            <Rows as="ul">
              {rows.map((row) => {
                const date = format.dateTime(row.at, SHORT);
                const [icon, title, sub] = row.kind === "joined" ? ["plus", t("joined", {name: row.name ?? ""}), date] as const
                  : row.kind === "reset" ? ["lock", t("reset"), t("resetSub", {date, organizer})] as const
                    : row.kind === "secondPhone" ? ["phone", t("secondPhone"), t("secondPhoneSub", {date})] as const
                      : row.kind === "signedOut" ? ["phone", t("signedOut"), t("signedOutSub", {date})] as const
                        : row.kind === "faceOff" ? ["faceid", t("faceOff"), t("faceOffSub", {date})] as const
                          : ["alert", t("paused"), date] as const;
                return <ListRow key={row.id} as="li" lead={<RowDisc icon={icon} tone="track" />} title={title} sub={sub} />;
              })}
            </Rows>
          )}
        </Card>
      </div>
    </Screen>
  );
}

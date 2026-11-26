import {getFormatter, getTranslations} from "next-intl/server";
import {Card, ListRow, Rows} from "@/components/ui/card";
import {BackRow, PageTitle} from "@/components/ui/page-header";
import {Screen} from "@/components/ui/screen";
import {requireViewer} from "@/server/auth";
import {signedInDevices} from "@/server/auth/account";
import {account} from "@/server/auth/security";
import {withFamily} from "@/server/db/client";
import {Bullet} from "../../sign-in/get-in";
import {RowDisc, SignOutEverywhere} from "../rows";
import {screenTitle} from "../../sign-in/title";

const WHEN = {month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago"} as const;

export async function generateMetadata() {
  return screenTitle("phones.title");
}

/** Your phones (11.3): where you are signed in, and the way to sign out of all of them. */
export default async function PhonesPage() {
  const viewer = await requireViewer();
  const t = await getTranslations("getIn.phones");
  const you = await getTranslations("getIn.you");
  const auth = await getTranslations("auth");
  const ui = await getTranslations("ui");
  const format = await getFormatter();
  const [devices, {name}] = await withFamily(viewer.familyId, async (tx) => [
    await signedInDevices(tx, viewer, new Date()), await account(tx, viewer),
  ] as const);
  return (
    <Screen back="/account" actions={<SignOutEverywhere name={name} />}>
      <BackRow href="/account" parent={you("label")} backLabel={ui("back")} />
      <PageTitle title={t("title")} lead={t("lead", {name})} />
      <div className="flex flex-col gap-3 px-edge pt-4">
        <Card flush className="px-[18px] py-0.5">
          <Rows as="ul">
            {devices.map((device) => {
              const label = auth(`device.${device.kind}` as Parameters<typeof auth>[0]);
              const sub = device.current
                ? [t("now"), device.faceId && t("faceOn")].filter(Boolean).join(" · ")
                : [t("since", {date: format.dateTime(device.at, WHEN)}), device.faceId && t("faceOn")].filter(Boolean).join(" · ");
              return (
                <ListRow key={device.id} as="li" lead={<RowDisc icon="phone" tone="track" />} title={label} sub={sub}
                  trail={device.current ? <span className="text-label text-pine uppercase">{t("thisOne")}</span> : undefined} />
              );
            })}
          </Rows>
        </Card>
        <Card className="px-[18px] py-4">
          <ul><Bullet icon="alert">{t("tip")}</Bullet></ul>
        </Card>
      </div>
    </Screen>
  );
}

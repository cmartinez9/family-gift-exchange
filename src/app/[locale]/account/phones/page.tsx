import {getFormatter, getTranslations} from "next-intl/server";
import {Card, ListRow, Rows} from "@/components/ui/card";
import {BackRow, PageTitle} from "@/components/ui/page-header";
import {Screen} from "@/components/ui/screen";
import {requireViewer} from "@/server/auth";
import {signedInDevices} from "@/server/auth/account";
import {account} from "@/server/auth/security";
import {withFamily} from "@/server/db/client";
import {Bullet} from "../../sign-in/get-in";
import {PhoneRow, RowDisc, SignOutEverywhere} from "../rows";
import {screenTitle} from "../../sign-in/title";
import styles from "../rows.module.css";

const KINDS = new Set(["iphone", "ipad", "android", "computer"]);
const WHEN = {month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago"} as const;

export async function generateMetadata() {
  return screenTitle("phones.title");
}

/** Your phones (11.3): where you are signed in and when each was last used; sign out one, or all of them. */
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
      <div className={`${styles.settings} flex flex-col gap-3 px-edge pt-4`}>
        <Card flush className="px-[18px] py-0.5">
          <Rows as="ul">
            {devices.map((device) => {
              const kind = KINDS.has(device.kind) ? device.kind : "other";
              const lead = <RowDisc icon="phone" tone="track" />;
              const face = device.faceId && t("faceOn");
              if (device.current) {
                return (
                  <ListRow key={device.id} as="li" className={styles.row} lead={lead} title={t("thisDevice", {kind})}
                    sub={[t("now"), face].filter(Boolean).join(" · ")}
                    trail={<span className="text-label text-pine uppercase">{t("thisOne")}</span>} />
                );
              }
              return (
                <PhoneRow key={device.id} sessionId={device.id} kind={kind} lead={lead} className={`${styles.row} ${styles.rowAction}`}
                  title={auth(`device.${kind}` as Parameters<typeof auth>[0])}
                  sub={[t("lastUsed", {date: format.dateTime(device.lastUsed, WHEN)}), face].filter(Boolean).join(" · ")} />
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

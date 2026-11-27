import {getTranslations} from "next-intl/server";
import type {IconName} from "@/components/ui/icon";
import type {account} from "@/server/auth/security";
import type {Viewer} from "@/server/auth";

export type AuthEvent = Awaited<ReturnType<typeof account>>["activity"][number];

// what you did on Your phones or with the Face ID switch is a record, not something to report
const NOT_DISPUTABLE = new Set(["pinLocked", "newDevicesLocked", "keyDisputed", "familyLockdown", "deviceSignedOut", "faceIdOff"]);
const ISSUANCE = new Set(["keyPrepared", "keySent", "resetPrepared", "resetPreparedWithoutRequest", "resetSent"]);
const DEVICES = new Set(["iphone", "ipad", "android", "computer", "other"]);

const ICONS: Record<AuthEvent["kind"], IconName> = {
  keyPrepared: "share", keySent: "share", keyUsed: "phone", keyDisputed: "alert", familyLockdown: "lock",
  signIn: "phone", newDevice: "phone", pinLocked: "alert", newDevicesLocked: "alert",
  resetPrepared: "lock", resetPreparedWithoutRequest: "lock", resetSent: "lock", resetUsed: "lock",
  deviceSignedOut: "phone", faceIdOff: "faceid",
};

/** Whether "That wasn't me" can act on this event: never your own session, never a safety event. */
export function disputable(event: AuthEvent, viewer: Viewer) {
  return !event.disputed && event.sessionId !== viewer.sessionId && !NOT_DISPUTABLE.has(event.kind);
}

/** The words and icon of a notice. */
export async function noticeText(event: AuthEvent, viewer: Viewer) {
  const t = await getTranslations("getIn.notices");
  const expected = await getTranslations("getIn.wasThat");
  const deviceKey = event.deviceKind && DEVICES.has(event.deviceKind) ? event.deviceKind : "unknown";
  const device = t(`device.${deviceKey}` as Parameters<typeof t>[0]);
  const deviceTitle = t(`deviceTitle.${deviceKey}` as Parameters<typeof t>[0]);
  const title = t(`kind.${event.kind}` as Parameters<typeof t>[0], {device: event.kind === "newDevice" || event.kind === "deviceSignedOut" ? deviceTitle : device});
  const askable = disputable(event, viewer);
  const issuance = ISSUANCE.has(event.kind);
  const sub = event.disputed ? t("reported")
    : askable ? (issuance ? expected("expected") : t("wasThatYou"))
      : t.has(`sub.${event.kind}` as Parameters<typeof t>[0]) ? t(`sub.${event.kind}` as Parameters<typeof t>[0]) : undefined;
  return {title, sub, icon: ICONS[event.kind], askable, issuance, device: device.replace(/^(an?|un|una) /, "")};
}

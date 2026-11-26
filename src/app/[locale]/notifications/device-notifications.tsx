"use client";

import {useTranslations} from "next-intl";
import {useState, useSyncExternalStore} from "react";
import {Button} from "@/components/ui/button";
import {Card} from "@/components/ui/card";
import {Icon} from "@/components/ui/icon";
import {disableDeviceNotifications, enableDeviceNotifications} from "./actions";

function ignoreBrowserChanges() {
  return () => {};
}

function supportsPush() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export function DeviceNotifications({publicKey, initiallyEnabled}: {
  publicKey: string | null;
  initiallyEnabled: boolean;
}) {
  const t = useTranslations("notify.device");
  const browserSupportsPush = useSyncExternalStore(ignoreBrowserChanges, supportsPush, () => false);
  const [enabled, setEnabled] = useState(initiallyEnabled);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<"enabled" | "disabled" | "denied" | "error">();

  async function toggle() {
    setPending(true);
    setFeedback(undefined);
    let createdSubscription: PushSubscription | undefined;
    try {
      if (enabled) {
        await disableDeviceNotifications();
        setEnabled(false);
        setFeedback("disabled");
        if ("serviceWorker" in navigator) {
          const registration = await navigator.serviceWorker.getRegistration();
          const subscription = await registration?.pushManager?.getSubscription();
          await subscription?.unsubscribe().catch(() => {});
        }
        return;
      }

      if (!publicKey || !browserSupportsPush) return;
      // Request permission during the button tap, before awaiting service-worker work.
      if (await Notification.requestPermission() !== "granted") {
        setFeedback("denied");
        return;
      }

      await navigator.serviceWorker.register("/sw.js");
      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      // A subscription is shared by the browser origin. Rotate it when a
      // different account or an earlier login previously used this browser.
      await existing?.unsubscribe();
      createdSubscription = await registration.pushManager.subscribe({
        userVisibleOnly: true, applicationServerKey: publicKey,
      });
      if (!await enableDeviceNotifications(createdSubscription.toJSON())) {
        await createdSubscription.unsubscribe().catch(() => {});
        setFeedback("error");
        return;
      }
      setEnabled(true);
      setFeedback("enabled");
    } catch {
      await createdSubscription?.unsubscribe().catch(() => {});
      setFeedback("error");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card as="section" aria-labelledby="device-notifications-title" className="gap-3">
      <div className="flex items-start gap-3.5 max-[299px]:flex-col">
        <span aria-hidden="true" className="inline-flex size-12 shrink-0 items-center justify-center rounded-full bg-[var(--track)]">
          <Icon name="bell" size={22} strokeWidth={2.3} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 pt-0.5">
          <h2 id="device-notifications-title" className="text-card-title">{t("title")}</h2>
          <p className="text-body text-[var(--fg-muted)]">{t("lead")}</p>
        </div>
      </div>
      {enabled || (publicKey && browserSupportsPush) ? (
        <Button variant={enabled ? "soft" : "card"} icon={enabled ? undefined : "bell"} onClick={toggle} disabled={pending}>
          {t(enabled ? "disable" : "enable")}
        </Button>
      ) : (
        <p className="text-body font-semibold">{t(publicKey ? "unsupported" : "unavailable")}</p>
      )}
      <p role="status" className="text-body font-semibold empty:hidden">{feedback ? t(feedback) : ""}</p>
    </Card>
  );
}

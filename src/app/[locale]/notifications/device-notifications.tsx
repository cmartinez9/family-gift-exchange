"use client";

import {useTranslations} from "next-intl";
import {useState, useSyncExternalStore} from "react";
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
    <section aria-labelledby="device-notifications-title" className="space-y-2">
      <h2 id="device-notifications-title" className="text-xl font-semibold">{t("title")}</h2>
      {enabled || (publicKey && browserSupportsPush) ? (
        <button type="button" className="min-h-12 rounded border border-current px-3" onClick={toggle} disabled={pending}>
          {t(enabled ? "disable" : "enable")}
        </button>
      ) : (
        <p>{t(publicKey ? "unsupported" : "unavailable")}</p>
      )}
      <p role="status">{feedback ? t(feedback) : ""}</p>
    </section>
  );
}

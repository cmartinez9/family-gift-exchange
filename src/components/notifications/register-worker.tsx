"use client";

import {useEffect} from "react";
import {useRouter} from "next/navigation";

export function RegisterNotificationWorker() {
  const router = useRouter();
  useEffect(() => {
    let disposed = false;
    let channel: MessageChannel | undefined;
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js").then(() => navigator.serviceWorker.ready).then((registration) => {
        if (disposed || !registration.active) return;
        // The previous document may send a removal after this page was rendered.
        // Reconcile only after that exit-time work has settled in the worker.
        channel = new MessageChannel();
        channel.port1.onmessage = ({data}) => {
          if (!disposed && data === true) router.refresh();
          channel?.port1.close();
        };
        registration.active.postMessage("settle-list-removals", [channel.port2]);
      }).catch(() => {});
    }
    return () => {
      disposed = true;
      channel?.port1.close();
    };
  }, [router]);
  return null;
}

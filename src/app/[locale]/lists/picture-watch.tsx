"use client";

import {useRouter} from "next/navigation";
import {useEffect} from "react";
import {PICTURE_WAIT_MS} from "@/server/lists/validation";

const EVERY_MS = 1500;

/**
 * While a new link's picture is on its way (4.4), reloads the list's data every moment or so, so the
 * picture, title and price appear without a manual reload. It stops once nothing is waiting, when the
 * wait runs out, and while the page is in the background.
 */
export function PictureWatch({waiting}: {waiting: boolean}) {
  const router = useRouter();
  useEffect(() => {
    if (!waiting) return;
    const until = Date.now() + PICTURE_WAIT_MS + EVERY_MS;
    const timer = window.setInterval(() => {
      if (Date.now() > until) {
        window.clearInterval(timer);
        return;
      }
      if (document.visibilityState === "visible") router.refresh();
    }, EVERY_MS);
    return () => window.clearInterval(timer);
  }, [waiting, router]);
  return null;
}

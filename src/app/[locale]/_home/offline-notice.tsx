"use client";

import {useEffect} from "react";
import {toast} from "@/components/ui/toast";

/** No connection: the toast drops in under the status bar, and you can still look around. */
export function OfflineNotice({message, back}: {message: string; back: string}) {
  useEffect(() => {
    const offline = () => toast({message, icon: "alert", placement: "top"});
    const online = () => toast({message: back, placement: "top"});
    if (!navigator.onLine) offline();
    window.addEventListener("offline", offline);
    window.addEventListener("online", online);
    return () => {
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", online);
    };
  }, [message, back]);
  return null;
}

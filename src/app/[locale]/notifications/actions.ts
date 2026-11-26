"use server";

import {revalidatePath} from "next/cache";
import {requireViewer} from "@/server/auth";
import {markNotificationRead} from "@/server/messages/inbox";
import {subscribePush, unsubscribePush} from "@/server/messages/subscriptions";

export async function readNotification(id: string) {
  const viewer = await requireViewer();
  await markNotificationRead(viewer, id);
  revalidatePath("/[locale]/notifications", "page");
}

export async function enableDeviceNotifications(subscription: unknown) {
  return subscribePush(await requireViewer(), subscription);
}

export async function disableDeviceNotifications() {
  await unsubscribePush(await requireViewer());
}

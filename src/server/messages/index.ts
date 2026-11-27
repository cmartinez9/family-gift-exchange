import "server-only";
import {withFamily} from "../db/client";
import {schedulePushDelivery} from "./delivery";
import {drawEvents, listEvents, requestPinReset} from "./events";
import {enqueueMessages, type Message} from "./queue";

export type {Message} from "./queue";
export {drawEvents, listEvents, requestPinReset};
export {noteEmptyListViewed, nudgedToday, nudgeList, type NudgeResult} from "./nudges";

export const notify = {drawEvents, listEvents, requestPinReset};

/** Store the in-app notification and arrange delivery to opted-in devices in production. */
export async function sendMessage(message: Message): Promise<void> {
  await withFamily(message.familyId, (tx) => enqueueMessages(tx, [message]));
  schedulePushDelivery(message.familyId);
}

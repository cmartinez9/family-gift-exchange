import "server-only";
import type {Viewer} from "../auth";
import {myPerson} from "../draw";

export async function getListRecipient(viewer: Viewer, exchangeId: string | undefined): Promise<string | null> {
  return exchangeId ? (await myPerson(viewer, exchangeId))?.recipientId ?? null : null;
}

import "server-only";
import {and, eq, gt, isNull, or} from "drizzle-orm";
import type {Viewer} from "../auth";
import {sessions} from "../auth/schema";
import {withFamily} from "../db/client";
import {families} from "../db/schema";
import {parseSubscription} from "./push";
import {pushSubscriptions} from "./schema";

type Device = Pick<Viewer, "familyId" | "personId" | "sessionId">;

export function subscribePush(device: Device, input: unknown) {
  const subscription = parseSubscription(input);
  if (!subscription) return Promise.resolve(false);

  return withFamily(device.familyId, async (tx) => {
    // The same browser can be used to sign in as someone else. Reassign the
    // endpoint and replace the session's old subscription in one transaction.
    await tx.select({id: families.id}).from(families).where(eq(families.id, device.familyId)).for("update");
    const [session] = await tx.select({id: sessions.id}).from(sessions).where(and(
      eq(sessions.familyId, device.familyId), eq(sessions.id, device.sessionId), eq(sessions.personId, device.personId),
      isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date()),
    ));
    if (!session) return false;
    await tx.delete(pushSubscriptions).where(and(
      eq(pushSubscriptions.familyId, device.familyId),
      or(eq(pushSubscriptions.sessionId, device.sessionId), eq(pushSubscriptions.endpoint, subscription.endpoint)),
    ));
    await tx.insert(pushSubscriptions).values({
      familyId: device.familyId, personId: device.personId, sessionId: device.sessionId, ...subscription,
    });
    return true;
  });
}

export async function unsubscribePush(device: Device) {
  await withFamily(device.familyId, (tx) => tx.delete(pushSubscriptions).where(and(
    eq(pushSubscriptions.familyId, device.familyId),
    eq(pushSubscriptions.personId, device.personId),
    eq(pushSubscriptions.sessionId, device.sessionId),
  )));
}

export async function hasPushSubscription(device: Device) {
  const [subscription] = await withFamily(device.familyId, (tx) => tx.select({sessionId: pushSubscriptions.sessionId})
    .from(pushSubscriptions).where(and(
      eq(pushSubscriptions.familyId, device.familyId),
      eq(pushSubscriptions.personId, device.personId),
      eq(pushSubscriptions.sessionId, device.sessionId),
    )));
  return Boolean(subscription);
}

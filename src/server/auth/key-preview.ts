import {asc, desc, eq, sql} from "drizzle-orm";
import type {FamilyTransaction} from "../db/database";
import {exchanges} from "../db/schema";
import {inspectKey, keyTokenPattern} from "./access";

/**
 * What a chat app's link preview may say about a personal key (1.1): whose key it is, the family and the season.
 * Nothing else, and only while the key can still be opened: a revoked, used, expired or unknown key gets the
 * generic preview. Chat apps fetch links on their own, so this only reads. It never opens, claims, uses up or
 * rate-limits the key, and it records nothing.
 */
export type KeyPreview = {name: string; familyName: string; year: number};

export async function keyPreview(tx: FamilyTransaction, familyId: string, token: string, now: Date): Promise<KeyPreview | null> {
  if (!keyTokenPattern.test(token)) return null;
  const entry = await inspectKey(tx, familyId, token, now);
  if (!entry?.available) return null;
  return {name: entry.name, familyName: entry.familyName, year: await seasonYear(tx, familyId, now)};
}

/** The season's year: the current exchange's gift day, or this year when it has none yet. */
async function seasonYear(tx: FamilyTransaction, familyId: string, now: Date) {
  const [exchange] = await tx.select({giftDay: exchanges.giftDay}).from(exchanges)
    .where(eq(exchanges.familyId, familyId))
    .orderBy(sql`(${exchanges.status} = 'closed')`, desc(exchanges.giftDay), asc(exchanges.id)).limit(1);
  const year = Number(exchange?.giftDay?.slice(0, 4));
  return Number.isInteger(year) && year > 2000 ? year : now.getUTCFullYear();
}

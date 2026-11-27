import "server-only";
import {isIP} from "node:net";
import {cookies, headers} from "next/headers";
import {authenticatorSecret, keyedHash} from "./pin";
import {borrowedCookie, digest, seasonSeconds, secret, sessionCookie, uuidPattern} from "./session";
import type {Device, DeviceKind} from "./access";

const familyCookie = "__Host-fge-family";
const deviceCookie = "__Host-fge-device";
export const privateCookie = {httpOnly: true, secure: true, sameSite: "lax", path: "/"} as const;

export async function rememberedFamily() {
  const value = (await cookies()).get(familyCookie)?.value;
  return value && uuidPattern.test(value) ? value : null;
}

export async function setSession(familyId: string, value: string) {
  const jar = await cookies();
  jar.set(sessionCookie, value, {...privateCookie, maxAge: seasonSeconds});
  jar.set(familyCookie, familyId, {...privateCookie, maxAge: seasonSeconds});
  jar.set(borrowedCookie, "", {...privateCookie, maxAge: 0});
}

export async function clearSession() {
  const jar = await cookies();
  jar.set(sessionCookie, "", {...privateCookie, maxAge: 0});
  jar.set(borrowedCookie, "", {...privateCookie, maxAge: 0});
}

/**
 * A relative's session on this phone, beside the owner's. No max age: it also ends when the browser does,
 * and the server ends it within the hour anyway.
 */
export async function setBorrowedSession(value: string) {
  (await cookies()).set(borrowedCookie, value, privateCookie);
}

/** The phone is its owner's again. */
export async function clearBorrowedSession() {
  (await cookies()).set(borrowedCookie, "", {...privateCookie, maxAge: 0});
}

export function identifyDevice(agent: string): DeviceKind {
  if (/iPad|Macintosh.*Mobile/i.test(agent)) return "ipad";
  if (/iPhone|iPod/i.test(agent)) return "iphone";
  if (/Android/i.test(agent)) return "android";
  if (/Windows|Macintosh|Linux|CrOS/i.test(agent)) return "computer";
  return "other";
}

/** This browser's device hash, read only: pages may not set the cookie, so a new browser has none yet. */
export async function currentDeviceHash() {
  const id = (await cookies()).get(deviceCookie)?.value;
  return id && /^[A-Za-z0-9_-]{43}$/.test(id) ? digest(id) : null;
}

/** The kind of phone this request comes from, for "On this iPhone". */
export async function currentDeviceKind(): Promise<DeviceKind> {
  return identifyDevice((await headers()).get("user-agent") ?? "");
}

export async function requestDevice(): Promise<Device> {
  const jar = await cookies();
  const request = await headers();
  let id = jar.get(deviceCookie)?.value;
  if (!id || !/^[A-Za-z0-9_-]{43}$/.test(id)) {
    id = secret();
    jar.set(deviceCookie, id, {...privateCookie, maxAge: seasonSeconds});
  }
  const ip = process.env.VERCEL === "1" ? request.get("x-vercel-forwarded-for")?.trim() : null;
  return {
    hash: digest(id),
    kind: identifyDevice(request.get("user-agent") ?? ""),
    network: ip && isIP(ip) ? keyedHash(authenticatorSecret(), "network", ip) : null,
  };
}

export function appOrigin() {
  const url = new URL(process.env.AUTH_ORIGIN
    ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000"));
  if (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "localhost")) {
    throw new Error("AUTH_ORIGIN must use HTTPS or http://localhost for development");
  }
  return url;
}

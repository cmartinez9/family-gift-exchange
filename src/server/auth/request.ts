import "server-only";
import {isIP} from "node:net";
import {cookies, headers} from "next/headers";
import {authenticatorSecret, keyedHash} from "./pin";
import {digest, seasonSeconds, secret, sessionCookie, uuidPattern} from "./session";
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
}

export async function clearSession() {
  (await cookies()).set(sessionCookie, "", {...privateCookie, maxAge: 0});
}

export function identifyDevice(agent: string): DeviceKind {
  if (/iPad|Macintosh.*Mobile/i.test(agent)) return "ipad";
  if (/iPhone|iPod/i.test(agent)) return "iphone";
  if (/Android/i.test(agent)) return "android";
  if (/Windows|Macintosh|Linux|CrOS/i.test(agent)) return "computer";
  return "other";
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

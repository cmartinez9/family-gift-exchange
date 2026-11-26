import {createHmac, randomBytes, scrypt, timingSafeEqual} from "node:crypto";
import {promisify} from "node:util";

export {pinProblem} from "../../lib/pin-policy";

const derive = promisify(scrypt);
export const fifteenMinutes = 15 * 60_000;
export const day = 24 * 60 * 60_000;

export function authenticatorSecret() {
  const pepper = process.env.AUTH_SECRET;
  if (!pepper || Buffer.byteLength(pepper) < 32) throw new Error("AUTH_SECRET must contain at least 32 bytes");
  return pepper;
}

export function keyedHash(pepper: string, purpose: string, value: string) {
  return createHmac("sha256", pepper).update(purpose).update("\0").update(value).digest("hex");
}

export async function hashPin(pepper: string, pin: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = await derive(keyedHash(pepper, "pin", pin), salt, 32) as Buffer;
  return `${salt}.${hash.toString("hex")}`;
}

export async function verifyPin(pepper: string, pin: string, stored: string) {
  const [salt, hash] = stored.split(".");
  const candidate = await derive(keyedHash(pepper, "pin", pin), salt, 32) as Buffer;
  return timingSafeEqual(candidate, Buffer.from(hash, "hex"));
}

type Attempts = {
  failedInWindow: number;
  failedToday: number;
  windowStartedAt: Date | null;
  lockedUntil: Date | null;
  newDevicesLocked: boolean;
};

export const clearedAttempts: Attempts = {
  failedInWindow: 0, failedToday: 0, windowStartedAt: null, lockedUntil: null, newDevicesLocked: false,
};

export function failedAttempt(previous: Attempts, now: Date): Attempts {
  const sameDay = previous.windowStartedAt && now.getTime() - previous.windowStartedAt.getTime() < day;
  const lockElapsed = previous.lockedUntil && previous.lockedUntil <= now;
  const failedInWindow = lockElapsed || !sameDay ? 1 : previous.failedInWindow + 1;
  const failedToday = sameDay ? previous.failedToday + 1 : 1;
  return {
    failedInWindow, failedToday,
    windowStartedAt: sameDay ? previous.windowStartedAt : now,
    lockedUntil: failedInWindow >= 5 ? new Date(now.getTime() + fifteenMinutes) : null,
    newDevicesLocked: previous.newDevicesLocked || failedToday >= 10,
  };
}

import "server-only";
import {ECDH} from "node:crypto";
import {generateRequestDetails} from "web-push";

export type BrowserSubscription = {endpoint: string; p256dh: string; auth: string};

export type PushPayload = {title: string; body: string; url: string; tag: string};
export type PushResult = "sent" | "gone" | "retry" | "failed";
export type PushSender = (subscription: BrowserSubscription, payload: PushPayload, ttlSeconds?: number) => Promise<PushResult>;

export function isPushEndpoint(endpoint: string): boolean {
  if (endpoint.length > 2048) return false;
  const url = URL.parse(endpoint);
  if (!url || url.protocol !== "https:" || url.port || url.username || url.password || url.hash ||
    url.pathname === "/") return false;

  // Only send to browser push providers. These are capabilities supplied by the client.
  return url.hostname === "fcm.googleapis.com"
    || url.hostname === "updates.push.services.mozilla.com"
    || url.hostname === "web.push.apple.com"
    || url.hostname.endsWith(".push.apple.com")
    || url.hostname.endsWith(".notify.windows.com");
}

function decodeKey(value: unknown, bytes: number): Buffer | null {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]+={0,2}$/.test(value) || value.length > 90) return null;
  const key = Buffer.from(value, "base64url");
  return key.length === bytes ? key : null;
}

export function parseSubscription(value: unknown): BrowserSubscription | null {
  if (!value || typeof value !== "object" || !("endpoint" in value) || !("keys" in value)) return null;
  const {endpoint, keys} = value;
  if (typeof endpoint !== "string" || !isPushEndpoint(endpoint)) return null;
  if (!keys || typeof keys !== "object" || !("p256dh" in keys) || !("auth" in keys)) return null;
  const p256dh = decodeKey(keys.p256dh, 65);
  const auth = decodeKey(keys.auth, 16);
  if (!p256dh || p256dh[0] !== 4 || !auth) return null;
  try {
    ECDH.convertKey(p256dh, "prime256v1");
  } catch {
    return null;
  }
  return {endpoint: new URL(endpoint).href, p256dh: p256dh.toString("base64url"), auth: auth.toString("base64url")};
}

export function pushConfig() {
  const {VAPID_SUBJECT: subject, VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey} = process.env;
  if (!subject || URL.parse(subject)?.protocol !== "https:" || !publicKey || !privateKey) return null;
  return {subject, publicKey, privateKey};
}

export function createPushSender(
  vapidDetails: NonNullable<ReturnType<typeof pushConfig>>,
  send: typeof fetch = fetch,
): PushSender {
  return async (subscription, payload, ttlSeconds = 24 * 60 * 60) => {
    if (!isPushEndpoint(subscription.endpoint)) return "failed";
    const request = generateRequestDetails(
      {endpoint: subscription.endpoint, keys: {p256dh: subscription.p256dh, auth: subscription.auth}},
      JSON.stringify(payload),
      {vapidDetails, TTL: ttlSeconds},
    );

    try {
      const response = await send(request.endpoint, {
        method: request.method,
        headers: Object.fromEntries(Object.entries(request.headers).map(([key, value]) => [key, String(value)])),
        body: request.body ? new Uint8Array(request.body) : undefined,
        redirect: "error",
        signal: AbortSignal.timeout(3000),
      });
      if (response.body) await response.body.cancel();
      if (response.ok) return "sent";
      if (response.status === 404 || response.status === 410) return "gone";
      if (response.status === 408 || response.status === 429 || response.status >= 500) return "retry";
      return "failed";
    } catch {
      return "retry";
    }
  };
}

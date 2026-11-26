import {createECDH, randomBytes} from "node:crypto";
import {generateVAPIDKeys} from "web-push";
import {expect, it, vi} from "vitest";
import {createPushSender, parseSubscription} from "../../src/server/messages/push";

vi.mock("server-only", () => ({}));

const ecdh = createECDH("prime256v1");
const subscription = {
  endpoint: "https://fcm.googleapis.com/fcm/send/fake-subscription",
  keys: {p256dh: ecdh.generateKeys().toString("base64url"), auth: randomBytes(16).toString("base64url")},
};

it.each([
  "http://fcm.googleapis.com/send/key",
  "https://127.0.0.1/send/key",
  "https://fcm.googleapis.com.example.com/send/key",
  "https://someone@fcm.googleapis.com/send/key",
  "https://fcm.googleapis.com:444/send/key",
])("rejects an untrusted push endpoint %s", (endpoint) => {
  expect(parseSubscription({...subscription, endpoint})).toBeNull();
});

it("rejects truncated and off-curve subscription keys", () => {
  const invalid = Buffer.alloc(65);
  invalid[0] = 4;
  expect(parseSubscription({...subscription, keys: {...subscription.keys, p256dh: "AA"}})).toBeNull();
  expect(parseSubscription({...subscription, keys: {...subscription.keys, p256dh: invalid.toString("base64url")}}))
    .toBeNull();
});

it.each([
  [201, "sent"], [404, "gone"], [410, "gone"], [429, "retry"], [503, "retry"], [403, "failed"],
] as const)("encrypts the payload and handles push response %d", async (status, result) => {
  const receiver = parseSubscription(subscription);
  expect(receiver).not.toBeNull();
  const payload = {title: "Names are drawn!", body: "Open the app.", url: "/en/notifications", tag: "test-tag"};
  const fetchEndpoint = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, {status}));
  const vapidDetails = {subject: "https://gifts.example", ...generateVAPIDKeys()};
  expect(await createPushSender(vapidDetails, fetchEndpoint)(receiver!, payload)).toBe(result);
  const [[url, request]] = fetchEndpoint.mock.calls;
  expect(url).toBe(subscription.endpoint);
  expect(request?.method).toBe("POST");
  expect(request?.redirect).toBe("error");
  const headers = new Headers(request?.headers);
  expect(headers.get("Authorization")).toMatch(/^vapid /i);
  expect(headers.get("Content-Encoding")).toBe("aes128gcm");
  expect(request?.body).toBeInstanceOf(Uint8Array);
  expect(Buffer.from(request?.body as Uint8Array).toString("utf8")).not.toContain(payload.title);
});

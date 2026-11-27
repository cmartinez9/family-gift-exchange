import {isValid, parse} from "ipaddr.js";

const MAX_URL_LENGTH = 2048;
const trackingKeys = new Set([
  "fbclid", "gclid", "dclid", "msclkid", "igshid", "mc_cid", "mc_eid", "srsltid",
  "ref", "ref_", "tag", "linkcode", "ascsubtag", "camp", "creative", "creativeasin",
]);

export class LinkError extends Error {
  constructor(readonly code: "invalid-link" | "unsafe-link") {
    super(code);
  }
}

export function isPublicAddress(address: string): boolean {
  if (!isValid(address) || address.includes("%")) return false;
  const ip = parse(address);
  if (ip.kind() === "ipv4") {
    return ip.range() === "unicast" && address !== "168.63.129.16";
  }
  // Only global unicast IPv6. Reject transition, special-use and documentation ranges.
  const words = ip.toByteArray();
  return ip.range() === "unicast" && (words[0] & 0xe0) === 0x20 &&
    !(words[0] === 0x20 && words[1] === 0x01 && words[2] <= 0x01) &&
    !(words[0] === 0x3f && words[1] === 0xff && words[2] < 0x10);
}

export const urlHostname = (url: URL) => url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");

function checkUrl(url: URL) {
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new LinkError("unsafe-link");
  if (url.username || url.password) throw new LinkError("unsafe-link");
  if (url.href.length > MAX_URL_LENGTH) throw new LinkError("invalid-link");
  const hostname = urlHostname(url);
  if (isValid(hostname)) {
    if (!isPublicAddress(hostname)) throw new LinkError("unsafe-link");
    return url;
  }
  if (!hostname.includes(".") || /(?:^|\.)(local|localhost|internal|home|lan|localdomain|onion)$/.test(hostname)) {
    throw new LinkError("unsafe-link");
  }
  if (hostname.split(".").some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
    throw new LinkError("invalid-link");
  }
  return url;
}

export function parseLink(input: string) {
  const text = input.trim();
  if (!text || text.length > 3000) throw new LinkError("invalid-link");
  const shared = /(?:^|\s)(https?:\/\/[^\s<>]+)(?=\s|$)/i.exec(text);
  const rawUrl = shared?.[1] ?? text;
  if (/[\s\u0000-\u001f\u007f<>"\\]/.test(rawUrl)) throw new LinkError("invalid-link");
  if (rawUrl.length > MAX_URL_LENGTH) throw new LinkError("invalid-link");
  const scheme = /^[a-z][a-z\d+.-]*:/i.exec(rawUrl)?.[0].toLowerCase();
  const hasPort = /^[a-z0-9.-]+\.[a-z0-9.-]+:\d+(?:[/?#]|$)/i.test(rawUrl);
  if (scheme && !hasPort && !/^https?:\/\//i.test(rawUrl)) throw new LinkError("unsafe-link");
  const candidate = scheme && !hasPort ? rawUrl : `https://${rawUrl}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new LinkError("invalid-link");
  }
  const sharedTitle = shared
    ? `${text.slice(0, shared.index)} ${text.slice(shared.index + shared[0].length)}`.trim()
    : "";
  return {url: checkUrl(url), sharedTitle};
}

export function relatedLink(input: string, parent: URL) {
  if (/[\u0000-\u001f\u007f<>"\\]/.test(input)) throw new LinkError("invalid-link");
  let url: URL;
  try {
    url = new URL(input, parent);
  } catch {
    throw new LinkError("invalid-link");
  }
  return checkUrl(url);
}

export function cleanLink(input: URL) {
  const url = new URL(input);
  for (const key of Array.from(url.searchParams.keys())) {
    if (key.toLowerCase().startsWith("utm_") || trackingKeys.has(key.toLowerCase())) {
      url.searchParams.delete(key);
    }
  }
  return url.href;
}

export function safeStoredLink(value: string | null) {
  if (!value || !/^https?:\/\//i.test(value)) return null;
  try {
    return cleanLink(parseLink(value).url);
  } catch {
    return null;
  }
}

import "server-only";
import {lookup} from "node:dns/promises";
import {request as requestHttp} from "node:http";
import {request as requestHttps} from "node:https";
import {isIP} from "node:net";
import {isPublicAddress, LinkError, relatedLink, urlHostname} from "./url";

export const MAX_PREVIEW_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const redirectStatuses = new Set([301, 302, 303, 307, 308]);

type Address = {address: string; family: number};

export type PreviewResponse = {
  status: number;
  contentType?: string;
  location?: string;
  body: Buffer;
};

export interface PreviewNetwork {
  lookup(hostname: string): Promise<Address[]>;
  request(url: URL, address: Address, signal: AbortSignal, accept: string): Promise<PreviewResponse>;
}

const defaultNetwork: PreviewNetwork = {
  lookup: (hostname) => lookup(hostname, {all: true}),
  request(url, address, signal, accept) {
    return new Promise((resolve, reject) => {
      const secure = url.protocol === "https:";
      const request = secure ? requestHttps : requestHttp;
      const hostname = urlHostname(url);
      // Connect to the checked IP while preserving the site's Host and TLS identity.
      const outgoing = request({
        agent: false,
        hostname: address.address,
        family: address.family,
        port: url.port || (secure ? 443 : 80),
        path: url.pathname + url.search,
        servername: isIP(hostname) ? "" : hostname,
        signal,
        headers: {
          Host: url.host,
          Accept: accept,
          "Accept-Encoding": "identity",
          "User-Agent": "Family-Gift-Exchange-Link-Preview/2.0",
        },
      }, (response) => {
        const headers = {
          status: response.statusCode ?? 0,
          location: response.headers.location,
          contentType: response.headers["content-type"],
        };
        if (headers.status !== 200) {
          response.destroy();
          resolve({...headers, body: Buffer.alloc(0)});
          return;
        }
        response.on("error", reject);
        if (Number(response.headers["content-length"]) > MAX_PREVIEW_BYTES) {
          response.destroy();
          reject(new Error("Preview response exceeds the byte limit"));
          return;
        }
        const chunks: Buffer[] = [];
        let length = 0;
        response.on("data", (chunk: Buffer) => {
          length += chunk.length;
          if (length > MAX_PREVIEW_BYTES) {
            response.destroy();
            reject(new Error("Preview response exceeds the byte limit"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => resolve({...headers, body: Buffer.concat(chunks, length)}));
      });
      outgoing.on("error", reject);
      outgoing.end();
    });
  },
};

function beforeAbort<T>(signal: AbortSignal, start: () => Promise<T>) {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, {once: true});
    Promise.resolve().then(start).then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", abort);
    });
  });
}

async function checkedAddress(url: URL, signal: AbortSignal, network: PreviewNetwork) {
  const hostname = urlHostname(url);
  const literal = isIP(hostname);
  const addresses = literal
    ? [{address: hostname, family: literal}]
    : await beforeAbort(signal, () => network.lookup(hostname));
  if (addresses.some(({address, family}) => isIP(address) !== family || !isPublicAddress(address))) {
    throw new LinkError("unsafe-link");
  }
  const address = addresses.find((entry) => entry.family === 4) ?? addresses[0];
  if (!address) throw new Error("Preview hostname has no address");
  return address;
}

export async function fetchPreview(
  initial: URL, signal: AbortSignal, accept: string, network = defaultNetwork,
): Promise<{url: URL; response?: PreviewResponse}> {
  let url = initial;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let response;
    try {
      const address = await checkedAddress(url, signal, network);
      response = await beforeAbort(signal, () => network.request(url, address, signal, accept));
    } catch (error) {
      if (error instanceof LinkError) throw error;
      return {url};
    }
    if (!redirectStatuses.has(response.status) || !response.location) {
      return {url, response: response.body.length <= MAX_PREVIEW_BYTES ? response : undefined};
    }
    if (hop === MAX_REDIRECTS) return {url};
    url = relatedLink(response.location, url);
  }
  return {url};
}

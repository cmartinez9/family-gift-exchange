import "server-only";
import {processListPhoto} from "../photo-storage";
import {TITLE_LIMIT} from "../validation";
import {checkLinkHost, fetchPreview, type PreviewNetwork} from "./http";
import {isBotWall, readProductMetadata} from "./metadata";
import {storeFor} from "./store";
import {cleanLink, parseLink, relatedLink} from "./url";

export {LinkError} from "./url";

export type LinkPreview = {
  url: string;
  title: string | null;
  price: string | null;
  store: string;
  icon: string;
  productId?: string;
  brand?: string;
  image?: Buffer;
  favicon?: Buffer;
};

function previewText(value: string | undefined) {
  const cleaned = value?.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return cleaned ? [...cleaned].slice(0, TITLE_LIMIT).join("") : null;
}

async function copyImage(source: string | undefined, page: URL, signal: AbortSignal, network?: PreviewNetwork) {
  if (!source || signal.aborted) return undefined;
  try {
    const image = relatedLink(source, page);
    const {response} = await fetchPreview(image, signal, "image/*", network);
    if (response?.status === 200 && !response.contentType?.startsWith("text/")) {
      return await processListPhoto(response.body);
    }
  } catch {
    // A missing, unsafe or unreadable image leaves an otherwise valid card intact.
  }
}

export async function resolveLinkPreview(input: string, network?: PreviewNetwork): Promise<LinkPreview> {
  const {url, sharedTitle} = parseLink(input);
  const signal = AbortSignal.timeout(5000);
  const page = await fetchPreview(url, signal, "text/html, application/xhtml+xml", network);
  const store = storeFor(page.url);
  const html = page.response?.body.toString("utf8") ?? "";
  const readable = page.response?.status === 200 && html.length >= 100 &&
    (!page.response.contentType || /(?:html|xhtml)/i.test(page.response.contentType)) &&
    !isBotWall(page.response.status, html);
  const metadata = readable ? readProductMetadata(html) : undefined;
  const image = await copyImage(metadata?.image, page.url, signal, network);
  const favicon = !image && store.icon === "store"
    ? await copyImage(metadata?.icon, page.url, signal, network)
    : undefined;
  return {
    url: cleanLink(page.url),
    title: previewText(metadata?.title) ?? previewText(sharedTitle) ?? previewText(store.title),
    price: metadata?.price ?? null,
    store: store.name,
    icon: store.icon,
    productId: store.productId,
    brand: previewText(metadata?.brand) ?? undefined,
    image,
    favicon,
  };
}

/**
 * What a link says before its page loads: the store, and a name from the link itself. The page fetch fills
 * in the rest later (see `fillLinkPreview` in ../items.ts), so saving never waits on a store's page.
 */
export async function linkPreviewFromUrl(input: string, network?: PreviewNetwork): Promise<LinkPreview> {
  const {url, sharedTitle} = parseLink(input);
  await checkLinkHost(url, AbortSignal.timeout(1500), network);
  const store = storeFor(url);
  return {
    url: cleanLink(url),
    title: previewText(sharedTitle) ?? previewText(store.title),
    price: null,
    store: store.name,
    icon: store.icon,
    productId: store.productId,
  };
}

import {parse, type DefaultTreeAdapterTypes} from "parse5";
import {usdAmount} from "../validation";

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue =>
  value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
const first = (value: unknown) => Array.isArray(value) ? value[0] : value;
const asText = (value: unknown) => typeof value === "string" ? value.trim() || undefined : undefined;

function productIn(value: unknown, depth = 0): RecordValue | undefined {
  if (!value || typeof value !== "object" || depth > 8) return;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const product = productIn(entry, depth + 1);
      if (product) return product;
    }
    return;
  }
  const node = record(value);
  const types = Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]];
  if (types.some((type) => typeof type === "string" && /(?:^|[/#])Product$/.test(type))) return node;
  return productIn(node["@graph"], depth + 1) ?? productIn(node.mainEntity, depth + 1);
}

function imageUrl(value: unknown) {
  const image = first(value);
  return asText(image) ?? asText(record(image).url) ?? asText(record(image).contentUrl);
}

function displayPrice(value: unknown, currency: unknown) {
  if (currency && currency !== "USD") return undefined;
  const price = String(value ?? "").trim().replace(/^\$\s*/, "");
  const amount = /^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(price) ? price.replaceAll(",", "") : price;
  return usdAmount(amount) ?? undefined;
}

function textIn(element: DefaultTreeAdapterTypes.Element) {
  return element.childNodes.map((node) => "value" in node ? node.value : "").join("").trim();
}

export function isBotWall(status: number, html: string) {
  return status === 403 || status === 429 ||
    /<title>\s*(?:just a moment|access denied|robot check|attention required)|automated access to amazon data|api-js\.datadome\.co\/tags\.js|datadome captcha|kasada challenge|\/cdn-cgi\/challenge-platform|validatecaptcha|enter the characters you see below/i.test(html);
}

export function readProductMetadata(html: string) {
  const document = parse(html);
  const meta = new Map<string, string>();
  const microProduct = new Map<string, string>();
  let product: RecordValue | undefined;
  let title: string | undefined;
  let icon: string | undefined;

  const pending: {node: DefaultTreeAdapterTypes.Node; insideProduct: boolean}[] = [
    {node: document, insideProduct: false},
  ];
  while (pending.length) {
    const {node, insideProduct: inheritedProduct} = pending.pop()!;
    let insideProduct = inheritedProduct;
    if ("tagName" in node) {
      const attrs = Object.fromEntries(node.attrs.map(({name, value}) => [name, value]));
      if ("itemscope" in attrs && attrs.itemtype) {
        insideProduct = /(?:^|[/#])Product$/.test(attrs.itemtype) ||
          (insideProduct && /(?:^|[/#])(?:Offer|AggregateOffer|Brand|ImageObject)$/.test(attrs.itemtype));
      }
      if (node.tagName === "meta") {
        const key = (attrs.property ?? attrs.name)?.toLowerCase();
        if (key && attrs.content && !meta.has(key)) meta.set(key, attrs.content.trim());
      }
      if (insideProduct && attrs.itemprop) {
        const value = (attrs.content ?? attrs.src ?? attrs.href ?? textIn(node)).trim();
        if (value && !microProduct.has(attrs.itemprop)) microProduct.set(attrs.itemprop, value);
      }
      if (!product && node.tagName === "script" && attrs.type?.toLowerCase().trim() === "application/ld+json") {
        try {
          product = productIn(JSON.parse(textIn(node)));
        } catch {
          // Invalid structured data leaves the remaining metadata sources available.
        }
      }
      if (node.tagName === "title" && !title) title = asText(textIn(node));
      if (node.tagName === "link" && !icon && /(?:^|\s)(?:icon|apple-touch-icon)(?:\s|$)/i.test(attrs.rel ?? "")) {
        icon = asText(attrs.href);
      }
    }
    if ("childNodes" in node) {
      for (let i = node.childNodes.length - 1; i >= 0; i--) {
        pending.push({node: node.childNodes[i], insideProduct});
      }
    }
  }

  const offer = record(first(product?.offers));
  const specification = record(first(offer.priceSpecification));
  const currency = offer.priceCurrency ?? specification.priceCurrency;
  const productPrice = displayPrice(offer.price ?? offer.lowPrice ?? specification.price, currency) ??
    displayPrice(microProduct.get("price") ?? microProduct.get("lowPrice"), microProduct.get("priceCurrency"));

  return {
    title: asText(product?.name) ?? microProduct.get("name") ?? meta.get("og:title") ??
      meta.get("twitter:title") ?? title,
    image: imageUrl(product?.image) ?? microProduct.get("image") ?? meta.get("og:image:secure_url") ??
      meta.get("og:image") ?? meta.get("twitter:image") ?? meta.get("twitter:image:src"),
    price: productPrice ?? displayPrice(meta.get("product:price:amount") ?? meta.get("og:price:amount"),
      meta.get("product:price:currency") ?? meta.get("og:price:currency")),
    brand: asText(record(first(product?.brand)).name) ?? asText(product?.brand) ??
      microProduct.get("brand") ?? meta.get("product:brand"),
    icon,
  };
}

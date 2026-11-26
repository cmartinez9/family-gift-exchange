import {urlHostname} from "./url";

function words(value = "") {
  try {
    value = decodeURIComponent(value);
  } catch {
    return "";
  }
  return value.replace(/[-_+]+/g, " ").replace(/\s+/g, " ").trim();
}

export function storeFor(url: URL) {
  const host = urlHostname(url);
  const slug = url.pathname.split("/").filter(Boolean);
  const on = (domain: string) => host === domain || host.endsWith(`.${domain}`);
  const page = url.pathname;
  if (on("amazon.com") || on("a.co") || on("amzn.to")) {
    const product = /(?:\/([a-z\d][^/]*)\/)?(?:dp|gp\/product|gp\/aw\/d)\/([a-z\d]{10})(?:\/|$)/i.exec(page);
    const title = product?.[1] === "aw" || product?.[1] === "gp" ? "" : words(product?.[1]);
    return {name: "Amazon", icon: "amazon", title, productId: product?.[2].toUpperCase()};
  }
  if (on("etsy.com")) {
    const product = /\/listing\/(\d+)(?:\/([^/]+))?/.exec(page);
    return {name: "Etsy", icon: "etsy", title: words(product?.[2]), productId: product?.[1]};
  }
  if (on("walmart.com")) {
    const product = /\/ip\/(?:(?!\d+(?:\/|$))([^/]+)\/)?(\d+)(?:\/|$)/.exec(page);
    return {name: "Walmart", icon: "walmart", title: words(product?.[1]), productId: product?.[2]};
  }
  if (on("target.com")) {
    const product = /\/p\/(?:([^/]+)\/-\/)?A-(\d+)/i.exec(page);
    return {name: "Target", icon: "target", title: words(product?.[1]), productId: product?.[2]};
  }
  if (on("costco.com")) {
    const product = /\/([^/]+)\.product\.(\d+)\.html/i.exec(page);
    return {name: "Costco", icon: "costco", title: words(product?.[1]), productId: product?.[2]};
  }
  if (on("bestbuy.com")) {
    const product = /\/site\/(?:([^/]+)\/)?(\d+)\.p(?:\/|$)/i.exec(page);
    const currentSlug = slug.at(-1)?.replace(/\.(?:html?|p)$/i, "") ?? "";
    return {
      name: "Best Buy",
      icon: "best-buy",
      title: words(product?.[1] ?? (slug.includes("product") && !/^\d+$/.test(currentSlug) ? currentSlug : "")),
      productId: product?.[2] ?? url.searchParams.get("skuId") ?? undefined,
    };
  }
  if (on("lego.com")) {
    const product = /\/product\/([^/]+?)-(\d+)(?:\/|$)/i.exec(page);
    return {name: "LEGO", icon: "lego", title: words(product?.[1]), productId: product?.[2]};
  }
  const lastWord = slug.findLast((part) => /[a-z]/i.test(part) && part !== "index");
  return {
    name: host.replace(/^www\./, ""),
    icon: "store",
    title: words(lastWord?.replace(/\.(?:html?|aspx?|php)$/i, "")),
    productId: undefined,
  };
}

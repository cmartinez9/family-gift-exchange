import type {BrowserContextOptions, Page} from "@playwright/test";

/** A 390 by 844 phone. */
export const phone = {viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true, ignoreHTTPSErrors: true} satisfies BrowserContextOptions;

/**
 * The largest text size: the phone's browser at 200%, so the 390px phone lays out at 195 CSS pixels and
 * every word is twice as big. The screenshots keep the phone's 390 by 844 shape.
 */
export const largest = {...phone, viewport: {width: 195, height: 422}, deviceScaleFactor: 2} satisfies BrowserContextOptions;

export type LayoutProblem = {kind: "sideways" | "past-edge" | "clipped" | "mid-word"; where: string; detail: string};

/**
 * What a reader at the largest text size would trip over on the screen as it is now: the page scrolling
 * sideways, something showing past the screen's edge, text cut off by its own box, or a word broken
 * across two lines. Things not on screen (screen-reader text, closed sheets) are skipped.
 */
export async function layoutProblems(page: Page, scope = "body"): Promise<LayoutProblem[]> {
  return page.locator(scope).first().evaluate((root) => {
    const problems: {kind: "sideways" | "past-edge" | "clipped" | "mid-word"; where: string; detail: string}[] = [];
    const width = document.documentElement.clientWidth;
    const where = (element: Element) => {
      const text = (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 50);
      const label = element.getAttribute("aria-label") ?? "";
      return `${element.tagName.toLowerCase()}${label ? `[${label.slice(0, 40)}]` : ""} "${text}"`;
    };
    const hidden = (element: Element) => {
      // aria-hidden words are still on screen (a title read out through its link's label), so they count
      if (element.closest("[hidden], .sr-only, dialog:not([open]), template, script, style")) return true;
      const style = getComputedStyle(element);
      if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) return true;
      const rect = element.getBoundingClientRect();
      return rect.width <= 1 || rect.height <= 1;
    };
    // The part of the box that can be seen, inside every ancestor that clips it.
    const visible = (element: Element) => {
      let {left, right} = element.getBoundingClientRect();
      for (let parent = element.parentElement; parent && parent !== document.documentElement; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (style.overflowX !== "visible") {
          const box = parent.getBoundingClientRect();
          left = Math.max(left, box.left);
          right = Math.min(right, box.right);
        }
        if (style.position === "fixed") break;
      }
      return {left, right};
    };

    if (document.documentElement.scrollWidth > width + 0.5) {
      problems.push({kind: "sideways", where: "page", detail: `${document.documentElement.scrollWidth}px wide on a ${width}px screen`});
    }

    for (const element of [root, ...root.querySelectorAll("*")]) {
      if (hidden(element)) continue;
      const {left, right} = visible(element);
      if (right - left > 1 && (right > width + 0.5 || left < -0.5)) {
        problems.push({kind: "past-edge", where: where(element), detail: `${Math.round(left)} to ${Math.round(right)} on a ${width}px screen`});
      }
      const style = getComputedStyle(element);
      const text = [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent!.trim());
      if (element instanceof HTMLInputElement && !["checkbox", "radio", "hidden", "range", "color", "file"].includes(element.type)
        || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
        // a field squeezed narrower than a few letters cannot show what is typed in it
        if (element.getBoundingClientRect().width < 96) {
          problems.push({kind: "clipped", where: where(element), detail: `a ${Math.round(element.getBoundingClientRect().width)}px field`});
        }
        continue;
      }
      if (!text) continue;
      if (style.textOverflow === "ellipsis" || style.webkitLineClamp !== "none" && style.webkitLineClamp !== "") {
        if (element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1) {
          problems.push({kind: "clipped", where: where(element), detail: "cut short with an ellipsis"});
        }
      } else if (style.overflowX !== "visible" && element.scrollWidth > element.clientWidth + 1
        || !["visible", "auto", "scroll"].includes(style.overflowY) && element.scrollHeight > element.clientHeight + 1) {
        problems.push({kind: "clipped", where: where(element), detail: `${element.scrollWidth}x${element.scrollHeight} in ${element.clientWidth}x${element.clientHeight}`});
      }
    }

    // A word that starts on one line and ends on the next, though it would fit a line of a card on the
    // screen (the column less 12px edges and 12px card sides). A word longer than that, or an address,
    // has to break (the body's overflow-wrap breaks it rather than let it run off the screen).
    const line = width - 2 * 12 - 2 * 12;
    const context = document.createElement("canvas").getContext("2d")!;
    const measure = (word: string, element: Element) => {
      const style = getComputedStyle(element);
      context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const spacing = Number.parseFloat(style.letterSpacing) || 0;
      return context.measureText(style.textTransform === "uppercase" ? word.toUpperCase() : word).width + spacing * word.length;
    };
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const broken = new Set<Element>();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent || broken.has(parent) || hidden(parent)) continue;
      for (const match of node.textContent!.matchAll(/[^\s\-‐–—/]{2,}/g)) {
        // an address or code (anything with a colon, dot, slash, equals sign or digits run through it) may break anywhere
        const token = node.textContent!.slice(0, match.index).split(/\s/).pop()! + node.textContent!.slice(match.index).split(/\s/)[0];
        if (/[:=?@/]|\.\w|\d.*[a-z]|[a-z].*\d/i.test(token)) continue;
        const range = document.createRange();
        range.setStart(node, match.index);
        range.setEnd(node, match.index + match[0].length);
        const tops = [...range.getClientRects()].filter((rect) => rect.width > 0.5).map((rect) => Math.round(rect.top));
        if (new Set(tops).size > 1 && Math.max(...tops) - Math.min(...tops) > 4 && measure(match[0], parent) <= line) {
          problems.push({kind: "mid-word", where: where(parent), detail: `"${match[0]}" (${Math.round(measure(match[0], parent))}px) breaks across lines`});
          broken.add(parent);
          break;
        }
      }
    }
    return problems;
  });
}

/** Lets arrivals, knitting and sheets settle before the screen is measured. */
export async function settle(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== "running"
    || (animation.effect?.getComputedTiming().iterations ?? 1) === Infinity), undefined, {timeout: 10_000}).catch(() => {});
}

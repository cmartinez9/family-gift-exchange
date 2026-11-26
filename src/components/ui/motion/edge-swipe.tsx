"use client";

import {useEffect, useRef, type ReactNode} from "react";
import {useRouter} from "@/i18n/navigation";
import {BACK_SWIPE_DISTANCE, DURATION, EASE, EDGE_WIDTH, FLICK_VELOCITY} from "./easing";
import {haptic} from "./haptic";
import {prefersReducedMotion} from "./reduced-motion";

/**
 * Swiping from the left edge goes back, as in iOS: the page follows the finger and finishes past 120px
 * or on a flick; otherwise it settles back. The parent page is not rendered underneath, so the ground
 * shows, dimmed, where the parent would be.
 */
export function EdgeSwipeBack({href, children}: {href: string; children: ReactNode}) {
  const router = useRouter();
  const page = useRef<HTMLDivElement>(null);
  const under = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = page.current, shade = under.current;
    if (!element || !shade) return;
    let drag: {x0: number; y0: number; t0: number; dx: number; id: number; left: number; horizontal: boolean | null} | null = null;

    const down = (event: PointerEvent) => {
      if (event.button !== 0 || document.querySelector("dialog[open]")) return;
      const left = element.getBoundingClientRect().left;
      if (event.clientX - left > EDGE_WIDTH) return;
      drag = {x0: event.clientX, y0: event.clientY, t0: performance.now(), dx: 0, id: event.pointerId, left, horizontal: null};
    };
    const move = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.id) return;
      const dx = Math.max(0, event.clientX - drag.x0), dy = Math.abs(event.clientY - drag.y0);
      if (drag.horizontal === null && (dx > 8 || dy > 8)) {
        drag.horizontal = dx > dy;
        if (!drag.horizontal) {
          drag = null;
          return;
        }
        element.setPointerCapture(event.pointerId);
        shade.style.display = "block";
      }
      if (!drag.horizontal) return;
      drag.dx = dx;
      element.style.transform = `translateX(${dx}px)`;
      shade.style.transform = `translateX(${-117 + dx * 0.3}px)`;
      shade.style.filter = `brightness(${0.8 + (0.2 * dx) / element.offsetWidth})`;
    };
    const up = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.id) return;
      const {dx, t0, horizontal} = drag;
      drag = null;
      if (!horizontal) return;
      const velocity = dx / Math.max(1, performance.now() - t0);
      element.style.transform = "";
      shade.style.transform = "";
      shade.style.filter = "";
      const reduce = prefersReducedMotion();
      if (dx > BACK_SWIPE_DISTANCE || velocity > FLICK_VELOCITY) {
        haptic("soft");
        const leave = element.animate([{transform: `translateX(${dx}px)`}, {transform: "translateX(100%)"}],
          {duration: reduce ? 0 : DURATION.backSwipeFinish, easing: "ease-out", fill: "forwards"});
        leave.onfinish = () => router.push(href);
        return;
      }
      element.animate([{transform: `translateX(${dx}px)`}, {transform: "none"}], {duration: reduce ? 0 : DURATION.backSwipeCancel, easing: EASE.interface});
      shade.animate([{transform: `translateX(${-117 + dx * 0.3}px)`}, {transform: "translateX(-30%)"}],
        {duration: reduce ? 0 : DURATION.backSwipeCancel, easing: EASE.interface}).onfinish = () => {
        shade.style.display = "none";
      };
    };

    element.addEventListener("pointerdown", down);
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", up);
    element.addEventListener("pointercancel", up);
    return () => {
      element.removeEventListener("pointerdown", down);
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", up);
      element.removeEventListener("pointercancel", up);
    };
  }, [href, router]);

  return (
    <div className="relative">
      <div ref={under} aria-hidden="true" className="fixed inset-0 bg-sweater-red" style={{display: "none", filter: "brightness(.8)"}} />
      <div ref={page} className="relative" style={{touchAction: "pan-y"}} data-edge-swipe="">{children}</div>
    </div>
  );
}

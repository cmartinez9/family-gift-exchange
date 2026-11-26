"use client";

import {useEffect, useLayoutEffect, useRef, useState, type ReactNode} from "react";
import {YarnTag} from "../item-card";
import {DURATION, EASE} from "./easing";
import {haptic} from "./haptic";
import {prefersReducedMotion} from "./reduced-motion";

/**
 * The claim. "I'm getting this" dyes the card pine outward from the button (a clip-path circle, 440ms),
 * and a knitted tag drops 70px on its strand and swings 20, -11, 7, -3, 5 degrees over 1000ms.
 * Undo lifts the tag 40px in 320ms and the dye recedes. Reduced motion: the tag fades in.
 *
 * `base` is the card as others see it; `mine` is the same card, pine, as you see it once it is yours.
 * Put `data-claim-origin` on the button: the dye starts from where it was pressed.
 */
export function ClaimCard({claimed, base, mine}: {claimed: boolean; base: ReactNode; mine: ReactNode}) {
  const wrap = useRef<HTMLDivElement>(null);
  const dye = useRef<HTMLDivElement>(null);
  const plain = useRef<HTMLDivElement>(null);
  const tag = useRef<HTMLSpanElement>(null);
  const origin = useRef("60px 150px");
  const previous = useRef(claimed);
  const settle = useRef<number | undefined>(undefined);
  // the first paint, server included, already hides the covered layer; after that the effect owns it
  const [initial] = useState(claimed);

  // remember where the claim was pressed
  useEffect(() => {
    const element = wrap.current;
    if (!element) return;
    const press = (event: PointerEvent | MouseEvent) => {
      const button = (event.target as HTMLElement).closest<HTMLElement>("[data-claim-origin]");
      if (!button) return;
      const box = element.getBoundingClientRect(), from = button.getBoundingClientRect();
      origin.current = `${Math.round(from.left + from.width / 2 - box.left)}px ${Math.round(from.top + from.height / 2 - box.top)}px`;
    };
    element.addEventListener("pointerdown", press, true);
    element.addEventListener("click", press, true);
    return () => {
      element.removeEventListener("pointerdown", press, true);
      element.removeEventListener("click", press, true);
    };
  }, []);

  useLayoutEffect(() => {
    const layer = dye.current, knot = tag.current, under = plain.current;
    if (!layer || !knot || !under) return;
    const was = previous.current;
    previous.current = claimed;
    const reduce = prefersReducedMotion();
    if (claimed === was) {
      // first paint: show the state as it is, no motion
      layer.style.transition = "none";
      layer.style.clipPath = claimed ? "none" : `circle(0px at ${origin.current})`;
      knot.style.opacity = claimed ? "1" : "0";
      knot.style.transform = claimed ? "rotate(5deg)" : "";
      // the layer that is not showing is hidden outright, so it cannot be found, read or clicked
      layer.style.visibility = claimed ? "" : "hidden";
      under.style.visibility = claimed ? "hidden" : "";
      void layer.offsetWidth;
      layer.style.transition = "";
      return;
    }
    knot.getAnimations().forEach((animation) => animation.cancel());
    window.clearTimeout(settle.current);
    // both layers show while the dye moves; the covered one hides once it settles
    layer.style.visibility = "";
    under.style.visibility = "";
    if (claimed) {
      haptic("firm");
      layer.style.transition = "none";
      layer.style.clipPath = `circle(0px at ${origin.current})`;
      void layer.offsetWidth;
      layer.style.transition = "";
      layer.style.clipPath = `circle(160% at ${origin.current})`;
      // once dyed, drop the clip: some engines miss clicks inside a large clip circle
      settle.current = window.setTimeout(() => {
        if (!previous.current) return;
        layer.style.clipPath = "none";
        under.style.visibility = "hidden";
      }, DURATION.claimDye + 80);
      const swing = reduce
        ? knot.animate([{opacity: 0}, {opacity: 1}], {duration: DURATION.reduced, fill: "forwards"})
        : knot.animate([
          {opacity: 0, transform: "translateY(-70px) rotate(-32deg)"},
          {opacity: 1, transform: "translateY(0) rotate(20deg)", offset: 0.32},
          {transform: "rotate(-11deg)", offset: 0.52},
          {transform: "rotate(7deg)", offset: 0.7},
          {transform: "rotate(-3deg)", offset: 0.86},
          {opacity: 1, transform: "rotate(5deg)"},
        ], {duration: DURATION.tagSwing, delay: DURATION.tagSwingDelay, easing: EASE.swing, fill: "forwards"});
      swing.onfinish = () => {
        knot.style.opacity = "1";
        knot.style.transform = "rotate(5deg)";
        swing.cancel();
      };
    } else {
      const lift = knot.animate([{opacity: 1, transform: "rotate(5deg)"}, {opacity: 0, transform: "translateY(-40px)"}],
        {duration: reduce ? 120 : DURATION.tagLift, easing: EASE.lift, fill: "forwards"});
      lift.onfinish = () => {
        knot.style.opacity = "0";
        knot.style.transform = "";
        lift.cancel();
      };
      if (layer.style.clipPath === "none") {
        layer.style.transition = "none";
        layer.style.clipPath = `circle(160% at ${origin.current})`;
        void layer.offsetWidth;
        layer.style.transition = "";
      }
      layer.style.clipPath = `circle(0px at ${origin.current})`;
      settle.current = window.setTimeout(() => {
        if (!previous.current) layer.style.visibility = "hidden";
      }, DURATION.claimDye + 80);
    }
  }, [claimed]);

  useEffect(() => () => window.clearTimeout(settle.current), []);

  return (
    <div ref={wrap} className="relative grid grid-cols-[minmax(0,1fr)]" data-claimed={claimed}>
      <div ref={plain} className="[grid-area:1/1]" inert={claimed} style={initial ? {visibility: "hidden"} : undefined}>{base}</div>
      <div ref={dye} className="fge-claim-mine [grid-area:1/1]" inert={!claimed} aria-hidden={!claimed}
        style={initial ? undefined : {visibility: "hidden"}}>{mine}</div>
      <span ref={tag} aria-hidden="true" className="pointer-events-none absolute -top-2.5 right-[42px] flex flex-col items-center opacity-0"
        style={{transformOrigin: "50% 0"}} data-claim-tag="">
        <span className="block h-3.5 w-[2.5px] bg-yarn-white" />
        <YarnTag />
      </span>
    </div>
  );
}

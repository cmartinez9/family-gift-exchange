"use client";

import {useCallback, useEffect, useId, useRef, type PointerEvent as ReactPointerEvent, type ReactNode} from "react";
import {IconButton} from "./button";
import {cn} from "./cn";
import {DURATION, EASE, FLICK_VELOCITY, SHEET_DISMISS_FRACTION} from "./motion/easing";
import {haptic} from "./motion/haptic";
import {prefersReducedMotion} from "./motion/reduced-motion";

/**
 * The one sheet: yarn white, 34px top corners, a 40 by 5px grabber, a 28px title and a 48px close disc,
 * content 20px in, 34px bottom padding, over the red-tinted scrim. It rises in 420ms, follows your finger
 * when dragged, and closes past 30% of its height or on a flick; tapping the scrim, the close disc or
 * Escape also closes it. For a short choice or a short form that keeps its context; a full task gets a page.
 *
 * A native modal <dialog>: focus moves in and stays in, the page behind is inert.
 */
export function Sheet({open, onClose, title, closeLabel, children, className}: {
  open: boolean;
  /** Called once the sheet has finished closing, however it was closed. */
  onClose: () => void;
  title: ReactNode;
  closeLabel: string;
  children: ReactNode;
  className?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const closing = useRef(false);
  const drag = useRef<{y0: number; t0: number; dy: number; id: number} | null>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  const finish = useCallback(() => {
    const element = dialog.current;
    body.current?.getAnimations().forEach((animation) => animation.cancel());
    scrim.current?.getAnimations().forEach((animation) => animation.cancel());
    if (body.current) body.current.style.transform = "";
    if (scrim.current) scrim.current.style.opacity = "";
    if (element?.open) element.close();
    closing.current = false;
    onCloseRef.current();
  }, []);

  /** Closes with the sheet's own motion, from where a drag left it. */
  const requestClose = useCallback((from = 0) => {
    const element = body.current, veil = scrim.current;
    if (closing.current || !element || !veil) return;
    closing.current = true;
    if (prefersReducedMotion()) {
      element.animate([{opacity: 1}, {opacity: 0}], {duration: 120, fill: "forwards"}).onfinish = finish;
      return;
    }
    element.getAnimations().forEach((animation) => animation.cancel());
    element.animate([{transform: `translateY(${from}px)`}, {transform: "translateY(105%)"}],
      {duration: DURATION.sheetClose, easing: EASE.sheetClose, fill: "forwards"}).onfinish = finish;
    veil.animate([{opacity: Number(getComputedStyle(veil).opacity)}, {opacity: 0}], {duration: DURATION.sheetClose, fill: "forwards"});
  }, [finish]);

  // open: rise in 420ms while the scrim fades in over 300ms
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      closing.current = false;
      element.showModal();
      // the close disc takes focus, so Escape, Enter or Space can put the sheet away at once
      element.querySelector<HTMLButtonElement>("[data-sheet-close]")?.focus({preventScroll: true});
      const sheet = body.current!, veil = scrim.current!;
      if (prefersReducedMotion()) {
        sheet.animate([{opacity: 0}, {opacity: 1}], {duration: DURATION.reduced});
      } else {
        sheet.animate([{transform: "translateY(100%)"}, {transform: "none"}], {duration: DURATION.sheet, easing: EASE.interface});
        veil.animate([{opacity: 0}, {opacity: 1}], {duration: DURATION.sheetScrim});
      }
    } else if (!open && element.open) {
      requestClose();
    }
  }, [open, requestClose]);

  // Escape: the dialog's cancel, closed with the sheet's own motion
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const cancel = (event: Event) => {
      event.preventDefault();
      requestClose();
    };
    element.addEventListener("cancel", cancel);
    return () => element.removeEventListener("cancel", cancel);
  }, [requestClose]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("button, a, input, textarea, select, label, [data-no-drag]") && !target.closest("[data-grabber]")) return;
    const content = target.closest<HTMLElement>(".fge-sheet-content");
    if (content && content.scrollTop > 0) return;
    drag.current = {y0: event.clientY, t0: performance.now(), dy: 0, id: event.pointerId};
    body.current?.setPointerCapture(event.pointerId);
    body.current?.getAnimations().forEach((animation) => animation.cancel());
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = drag.current, element = body.current, veil = scrim.current;
    if (!state || !element || !veil || event.pointerId !== state.id) return;
    let dy = event.clientY - state.y0;
    if (dy < 0) dy *= 0.2;
    state.dy = dy;
    element.style.transform = `translateY(${dy}px)`;
    veil.style.opacity = String(1 - Math.max(0, dy) / element.offsetHeight);
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = drag.current, element = body.current, veil = scrim.current;
    if (!state || !element || !veil || event.pointerId !== state.id) return;
    drag.current = null;
    const {dy, t0} = state;
    const velocity = dy / Math.max(1, performance.now() - t0);
    // a cancelled pointer (the content scrolled instead) only settles the sheet back
    if (event.type !== "pointercancel" && (dy > element.offsetHeight * SHEET_DISMISS_FRACTION || velocity > FLICK_VELOCITY)) {
      haptic("soft");
      requestClose(dy);
      return;
    }
    element.style.transform = "";
    veil.style.opacity = "";
    if (dy !== 0) {
      element.animate([{transform: `translateY(${dy}px)`}, {transform: "none"}], {duration: DURATION.sheetSettle, easing: EASE.interface});
    }
  };

  return (
    <dialog ref={dialog} aria-labelledby={titleId} className={cn("fge-sheet-dialog", className)} data-sheet="">
      <div ref={scrim} className="absolute inset-0 bg-sheet-scrim" onClick={() => requestClose()} data-scrim="" />
      <div ref={body} className="fge-sheet fge-sheet-body absolute inset-x-0 bottom-0 flex max-h-[calc(100dvh-24px)] flex-col rounded-t-sheet bg-yarn-white text-ink"
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
        <div data-grabber="" className="flex cursor-grab justify-center pt-2 pb-1">
          <span className="h-[5px] w-10 rounded-[3px] bg-ink/22" />
        </div>
        <div className="flex items-start justify-between gap-3 px-edge pt-3">
          <h2 id={titleId} className="flex-1 pt-1.5 text-sheet-title">{title}</h2>
          <IconButton icon="close" label={closeLabel} tone="track" onClick={() => requestClose()} data-sheet-close="" />
        </div>
        <div className="fge-sheet-content flex flex-col gap-3.5 overflow-y-auto px-edge pt-3.5 pb-[calc(34px+var(--safe-bottom))]">
          {children}
        </div>
      </div>
    </dialog>
  );
}

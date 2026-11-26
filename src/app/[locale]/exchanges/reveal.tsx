"use client";

import {useTranslations} from "next-intl";
import {useActionState, useEffect, useRef} from "react";
import {Link} from "@/i18n/navigation";
import type {RevealState} from "./actions";
import {button, link, subheading} from "./styles";

export function Reveal({action, practice = false, initial = {}}: {
  action: () => Promise<RevealState>; practice?: boolean; initial?: RevealState;
}) {
  const t = useTranslations("draw");
  const [state, submit, pending] = useActionState(action, initial);
  const form = useRef<HTMLFormElement>(null);
  const timer = useRef<number>(undefined);
  const held = useRef(false);

  function clearHold() {
    window.clearTimeout(timer.current);
    timer.current = undefined;
  }

  useEffect(() => clearHold, []);
  if (state.personName) return (
    <div className="space-y-3">
      <p className={subheading} role="status">{t("givingTo", {name: state.personName})}</p>
      {state.personId && !practice && <Link className={link} href={`/lists/${state.personId}`} prefetch={false}>
        {t("viewWishlist", {name: state.personName})}
      </Link>}
    </div>
  );

  return (
    <form ref={form} action={submit} className="space-y-3">
      <p id="reveal-help">{t("revealHelp")}</p>
      {state.error && <p role="alert">{state.error}</p>}
      <button type="submit" className={`${button} select-none touch-manipulation`} disabled={pending} aria-describedby="reveal-help"
        onPointerDown={(event) => {
          if (!event.isPrimary || event.button !== 0) return;
          clearHold();
          held.current = false;
          timer.current = window.setTimeout(() => {
            held.current = true;
            form.current?.requestSubmit();
          }, 550);
        }}
        onContextMenu={(event) => event.preventDefault()}
        onPointerCancel={clearHold}
        onPointerLeave={clearHold}
        onPointerUp={clearHold}
        onClick={(event) => {
          clearHold();
          if (event.detail !== 0 && held.current) event.preventDefault();
          held.current = false;
        }}>
        {t("reveal")}
      </button>
    </form>
  );
}

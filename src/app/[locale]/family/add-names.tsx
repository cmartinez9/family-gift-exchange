"use client";

import {useTranslations} from "next-intl";
import {useActionState, useEffect, useRef} from "react";
import {ErrorBlock} from "@/components/ui/blocks";
import {Icon} from "@/components/ui/icon";
import {haptic} from "@/components/ui/motion/haptic";
import {toast} from "@/components/ui/toast";
import {addNames} from "./actions";

/** "Add a name": a white pill at the top of who's in. Paste a whole list and each line becomes a person. */
export function AddNames() {
  const t = useTranslations("draw.setup");
  const auth = useTranslations("auth");
  const [state, submit, pending] = useActionState(addNames, {});
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.added) {
      haptic("success");
      toast(t("added", {count: state.added}));
      form.current?.reset();
    } else if (state.error) haptic("error");
  }, [state, t]);
  return (
    <form ref={form} action={submit} className="flex flex-col gap-2">
      {/*
        At the largest text size Add moves under the field, so the field keeps the width to type a name, and
        the words that ask for it show over the field rather than as a placeholder cut off at its edge.
      */}
      <div className="flex h-14 items-center gap-2 rounded-pill bg-snow-white pr-1.5 pl-5 text-ink focus-within:outline-3 focus-within:outline-offset-3 focus-within:outline-snow-white
        max-[299px]:h-auto max-[299px]:flex-wrap max-[299px]:rounded-[28px] max-[299px]:p-1.5 max-[299px]:pl-4">
        <Icon name="plus" size={22} strokeWidth={2.4} className="text-muted-ink" />
        <label htmlFor="add-names" className="sr-only max-[299px]:not-sr-only max-[299px]:order-first max-[299px]:basis-full max-[299px]:pt-2 max-[299px]:pr-2 max-[299px]:text-body max-[299px]:font-semibold max-[299px]:text-muted-ink">{t("addName")}</label>
        <input id="add-names" name="names" required maxLength={2000} placeholder={t("addName")} autoComplete="off"
          onPaste={(event) => {
            const text = event.clipboardData.getData("text");
            // a pasted list is added at once, one person per line
            if (/\n/.test(text.trim())) {
              event.preventDefault();
              event.currentTarget.value = text.trim().replace(/\s*\n\s*/g, ", ");
              form.current?.requestSubmit();
            }
          }}
          className="h-full min-w-0 flex-1 bg-transparent text-lead font-semibold placeholder:font-normal placeholder:text-muted-ink focus:outline-none max-[299px]:h-12 max-[299px]:placeholder:text-transparent" />
        <button type="submit" disabled={pending}
          className="fge-press inline-flex h-11 shrink-0 cursor-pointer items-center justify-center rounded-pill bg-ink px-4 text-body-strong text-snow-white disabled:opacity-60
            max-[299px]:h-12 max-[299px]:basis-full">
          {t("add")}
        </button>
      </div>
      {state.error && <ErrorBlock title={auth(`feedback.${state.error}` as Parameters<typeof auth>[0])} />}
    </form>
  );
}

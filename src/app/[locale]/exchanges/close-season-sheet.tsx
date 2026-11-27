"use client";

import {useActionState, useState, type ReactNode} from "react";
import {ErrorBlock} from "@/components/ui/blocks";
import {Button, TextButton} from "@/components/ui/button";
import {Icon, type IconName} from "@/components/ui/icon";
import {Sheet} from "@/components/ui/sheet";
import type {FormState} from "./actions";

export type CloseSeasonLabels = {
  open: string; title: string; close: string; lists: string; sealed: string; marks: string; confirm: string; notYet: string;
};

function Fact({icon, children}: {icon: IconName; children: ReactNode}) {
  return (
    <li className="flex items-start gap-3.5">
      <Icon name={icon} size={24} strokeWidth={2.3} className="mt-0.5 text-pine" />
      <p className="min-w-0 flex-1 text-body font-semibold">{children}</p>
    </li>
  );
}

/** The confirm sheet for closing the season: what stays, what goes, one ink button and "Not yet". */
export function CloseSeasonSheet({labels, action}: {
  labels: CloseSeasonLabels;
  action: (state: FormState, data: FormData) => Promise<FormState>;
}) {
  const [open, setOpen] = useState(false);
  const [state, submit, pending] = useActionState(action, {});
  return (
    <>
      <TextButton className="-ml-3 self-start" aria-haspopup="dialog" onClick={() => setOpen(true)}>{labels.open}</TextButton>
      <Sheet open={open} onClose={() => setOpen(false)} title={labels.title} closeLabel={labels.close}>
        <ul className="flex flex-col gap-3.5 pb-1">
          <Fact icon="list">{labels.lists}</Fact>
          <Fact icon="lock">{labels.sealed}</Fact>
          <Fact icon="gift">{labels.marks}</Fact>
        </ul>
        <form action={submit} className="flex flex-col gap-2">
          {state.error && <ErrorBlock title={state.error} />}
          <Button type="submit" variant="card" icon="check" disabled={pending}>{labels.confirm}</Button>
          <TextButton className="self-center" onClick={() => setOpen(false)}>{labels.notYet}</TextButton>
        </form>
      </Sheet>
    </>
  );
}

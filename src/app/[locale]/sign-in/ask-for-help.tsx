"use client";

import {useState, useTransition} from "react";
import {useTranslations} from "next-intl";
import {TextButton} from "@/components/ui/button";
import {cn} from "@/components/ui/cn";
import {Icon} from "@/components/ui/icon";
import {haptic} from "@/components/ui/motion/haptic";
import {askForHelpWithKey, forgotPin, type AuthResult} from "./actions";
import {tryAuthAction} from "./client-action";

/** Who is asking: a joined person by name, or the owner of the key on screen, before they have a PIN. */
export type HelpAsker =
  | {familyId: string; personId: string}
  | {familyId: string; key: {value: string; typed: boolean; preview: string | null}};

/** The organizer as the getting-in screens name them: "Christian", not "Christian Martinez". */
export function firstName(name: string) {
  return name.trim().split(/\s+/)[0] ?? "";
}

/**
 * "Ask Christian for help": the getting-in screens' footer link. One tap sends the same request as
 * Forgot my PIN, so the organizers see it in Manage my family and in their notices; then it says so in place.
 */
export function AskForHelp({asker, organizer, className}: {asker: HelpAsker; organizer: string; className?: string}) {
  const t = useTranslations("getIn.help");
  const [result, setResult] = useState<AuthResult>({});
  const [pending, start] = useTransition();
  const name = firstName(organizer);
  if (!name) return null;

  const sent = result.success || result.error === "tryLater";
  if (sent) {
    return (
      <p role="status" className={cn("fge-drop flex min-h-12 items-start justify-center gap-2.5 px-3 py-1 text-body font-semibold",
        className)}>
        <Icon name="check" size={20} strokeWidth={2.4} className="mt-0.5 shrink-0" />
        <span>{t(result.success ? "asked" : "already", {organizer: name})}</span>
      </p>
    );
  }
  return (
    <div className={cn("flex flex-col items-center", className)}>
      <TextButton disabled={pending} aria-busy={pending || undefined} className="disabled:opacity-60" onClick={() => start(async () => {
        const response = await tryAuthAction(() => "key" in asker
          ? askForHelpWithKey(asker.familyId, asker.key.value, asker.key.typed, asker.key.preview)
          : forgotPin(asker.familyId, asker.personId));
        if (response.success) haptic("success");
        else if (response.error !== "tryLater") haptic("error");
        setResult(response);
      })}>{t("ask", {organizer: name})}</TextButton>
      {result.error && <p role="alert" className="px-3 text-center text-body">{t("failed")}</p>}
    </div>
  );
}

import {getTranslations} from "next-intl/server";
import {TextField} from "@/components/ui/inputs";
import {StepBar} from "@/components/ui/step-bar";

export type SetupStep = 1 | 2 | 3 | 4 | 5;
const STEP_NAMES = ["exchange", "people", "houses", "draw", "keys"] as const;

/** The organizer's five setup steps, one knitted strip each: the exchange, who's in, who lives where, draw names, send keys. */
export async function SetupSteps({step, done = false}: {step: SetupStep; done?: boolean}) {
  const t = await getTranslations("draw.setup");
  return (
    <StepBar id="setup" step={step} total={5} done={done}
      progress={t("progress", {step, total: 5})} name={t(`steps.${STEP_NAMES[step - 1]}`)} />
  );
}

/** The typed confirmation a locked redraw needs. */
export function ConfirmField({help, label}: {help: string; label: string}) {
  return (
    <>
      <p className="text-body text-[var(--fg-muted)]">{help}</p>
      <TextField label={label} name="confirmation" required autoComplete="off" />
    </>
  );
}

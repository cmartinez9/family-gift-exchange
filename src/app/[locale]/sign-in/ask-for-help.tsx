"use client";

import {createContext, useContext, useState, useTransition, type ReactNode} from "react";
import {useTranslations} from "next-intl";
import {Avatar} from "@/components/ui/avatar";
import {TextButton} from "@/components/ui/button";
import {Chevron, ListRow, Rows} from "@/components/ui/card";
import {cn} from "@/components/ui/cn";
import {Icon} from "@/components/ui/icon";
import {haptic} from "@/components/ui/motion/haptic";
import {Sheet} from "@/components/ui/sheet";
import {forgotPin, type AuthResult} from "./actions";
import {tryAuthAction} from "./client-action";

/** The organizer as the getting-in screens name them: "Christian", not "Christian Martinez". */
export function firstName(name: string) {
  return name.trim().split(/\s+/)[0] ?? "";
}

type HelpOrganizer = {personId: string; name: string};
const HelpOrganizers = createContext<HelpOrganizer[] | null>(null);

export function OrganizerHelpProvider({organizers, children}: {organizers: HelpOrganizer[]; children: ReactNode}) {
  return <HelpOrganizers value={organizers}>{children}</HelpOrganizers>;
}

export function useHelpContact(fallback: string) {
  const organizers = useContext(HelpOrganizers);
  return (personId: string) => {
    if (organizers === null) return firstName(fallback);
    const other = organizers.find((organizer) => organizer.personId !== personId);
    return other ? firstName(other.name) : organizers.some((organizer) => organizer.personId === personId) ? null : "";
  };
}

export function OrganizerRecovery({className}: {className?: string}) {
  const t = useTranslations("auth.feedback");
  return <p className={cn("px-3 text-center text-body", className)}>{t("organizerRecovery")}</p>;
}

/**
 * "Ask Christian for help": the getting-in screens' footer link. One tap sends the same request as
 * Forgot my PIN, so the organizers see it in Manage my family and in their notices; then it says so in place.
 */
export function AskForHelp({asker, organizer, className}: {
  asker: {familyId: string; personId: string} | {familyId: string; names: Array<{id: string; name: string}>};
  organizer: string; className?: string;
}) {
  const t = useTranslations("getIn.help");
  const ui = useTranslations("ui");
  const [result, setResult] = useState<AuthResult>({});
  const [pending, start] = useTransition();
  const [choosing, setChoosing] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const contact = useHelpContact(organizer);
  const name = "personId" in asker ? contact(asker.personId) : chosen ? contact(chosen) : firstName(organizer);
  if (name === null || result.error === "organizerRecovery") return <OrganizerRecovery className={className} />;
  if (!name || ("names" in asker && !asker.names.length)) return null;

  function ask(personId: string) {
    start(async () => {
      const response = await tryAuthAction(() => forgotPin(asker.familyId, personId));
      if (response.success) haptic("success");
      else if (response.error !== "tryLater") haptic("error");
      setResult(response);
    });
  }

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
      <TextButton disabled={pending} aria-busy={pending || undefined} className="disabled:opacity-60" onClick={() => {
        if ("names" in asker) setChoosing(true);
        else ask(asker.personId);
      }}>{t("ask", {organizer: name})}</TextButton>
      {result.error && <p role="alert" className="px-3 text-center text-body">{t("failed")}</p>}
      {"names" in asker && (
        <Sheet open={choosing} onClose={() => setChoosing(false)} title={t("who")} closeLabel={ui("close")}>
          <p className="text-body">{t("chooseName", {organizer: name})}</p>
          <Rows as="ul">
            {asker.names.map(({id, name: personName}) => (
              <li key={id}>
                <button type="button" disabled={pending} className="fge-press block w-full cursor-pointer rounded-[20px] text-left"
                  onClick={() => {
                    setChoosing(false);
                    setChosen(id);
                    if (contact(id)) ask(id);
                  }}>
                  <ListRow as="span" lead={<Avatar name={personName} />} title={personName} trail={<Chevron />} />
                </button>
              </li>
            ))}
          </Rows>
        </Sheet>
      )}
    </div>
  );
}

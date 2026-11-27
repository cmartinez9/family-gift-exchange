"use client";

import {useState} from "react";
import {useRouter} from "@/i18n/navigation";
import {Screen} from "@/components/ui/screen";
import {lendKey} from "./actions";
import {AskForHelp} from "./ask-for-help";
import {WelcomeSteps} from "./get-in";
import {HelpingKey} from "./helping";
import {MakePin, pinForm} from "./pin-screens";

/**
 * A relative's first key opened on a phone signed in as someone else in the family (9.1, 9.2). The phone's
 * owner chooses how to help; handed the phone, the relative makes their own PIN and signs in beside the
 * owner, who stays signed in. Back leaves the key alone and returns to the owner's Home.
 */
export function KeyOnBorrowedPhone({familyId, value, personId, name, organizer}: {
  familyId: string; value: string; personId: string; name: string; organizer: string;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<"helper" | "pin">("helper");
  const help = <AskForHelp organizer={organizer} asker={{familyId, personId}} />;

  if (phase === "pin") {
    const save = lendKey.bind(null, familyId, value);
    return (
      <Screen>
        <MakePin top={<WelcomeSteps step={1} />} save={(pin) => save({}, pinForm(pin))} footer={help} />
      </Screen>
    );
  }
  return (
    <Screen actions={help}>
      <WelcomeSteps step={1} />
      <div className="px-edge pt-8 pb-6">
        <HelpingKey name={name} typed={false} lend onHandOver={() => setPhase("pin")} onBack={() => router.replace("/")} />
      </div>
    </Screen>
  );
}

"use client";

import {useCallback, useEffect, useState, useTransition} from "react";
import {useLocale, useTranslations} from "next-intl";
import {useRouter} from "@/i18n/navigation";
import {Button} from "@/components/ui/button";
import {ErrorBlock} from "@/components/ui/blocks";
import {Card} from "@/components/ui/card";
import {Icon} from "@/components/ui/icon";
import {StitchedText} from "@/components/ui/knit/stitched-text";
import {haptic} from "@/components/ui/motion/haptic";
import {KnitIn} from "@/components/ui/motion/knit-in";
import {PageTitle} from "@/components/ui/page-header";
import {Screen} from "@/components/ui/screen";
import {StepBar} from "@/components/ui/step-bar";
import {Greeting, WelcomeSteps} from "../../sign-in/get-in";
import {hideOnBorrowedPhone, returnPhone} from "./actions";

/**
 * A page the browser kept in its back-forward cache is never shown again as it was: Back after handing the
 * phone back loads it afresh, as the owner.
 */
export function useForgetOnRestore() {
  useEffect(() => {
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted) window.location.reload();
    };
    window.addEventListener("pageshow", restored);
    return () => window.removeEventListener("pageshow", restored);
  }, []);
}

/** A line on a yarn-white card with a pine icon: what is safe now, what comes next. */
function Note({icon, children}: {icon: "lock" | "phone"; children: string}) {
  return (
    <Card className="flex-row items-start gap-3 py-[18px]">
      <Icon name={icon} size={22} strokeWidth={2.2} className="mt-0.5 shrink-0 text-pine" />
      <p className="min-w-0 flex-1 text-body">{children}</p>
    </Card>
  );
}

/**
 * Hand this phone back to Ana (9.4): the person is hidden, the owner's name is stitched big so the person
 * holding the phone knows whom to hand it to, and the owner goes on with the sizes and the list.
 * `shown` is false when there was no person to open, so nothing was ever on the screen.
 */
export function HandBack({name, owner, shown, sealed, borrowedSessionId}: {name: string; owner: string; shown: boolean; sealed: boolean; borrowedSessionId?: string}) {
  const t = useTranslations("borrowed");
  const draw = useTranslations("draw");
  const router = useRouter();
  const [closed, setClosed] = useState(sealed);
  const [failed, setFailed] = useState(false);
  const [pending, start] = useTransition();
  const seal = useCallback(() => start(async () => {
    setFailed(false);
    try {
      if ((await hideOnBorrowedPhone()).hidden) setClosed(true);
      else setFailed(true);
    } catch {
      setFailed(true);
    }
  }), []);
  useEffect(() => {
    if (!closed) seal();
  }, [closed, seal]);
  useForgetOnRestore();
  if (!closed) return (
    <Screen label={t("title")}>
      <WelcomeSteps step={2} />
      {failed && <div className="flex flex-col gap-3 px-edge pt-10">
        <ErrorBlock title={t("hideFailed")} />
        <Button disabled={pending} onClick={seal}>{draw("person.tryAgain")}</Button>
      </div>}
    </Screen>
  );
  return (
    <Screen actions={<Button onClick={() => {
      haptic("light");
      router.replace(borrowedSessionId ? `/welcome/sizes?borrowed=${borrowedSessionId}` : "/welcome/sizes");
    }}>{t("ownerHas", {owner})}</Button>}>
      <WelcomeSteps step={3} waitingStep={shown ? undefined : 2} />
      <div className="flex flex-col items-center gap-3.5 px-edge pt-10 text-center">
        <h1 className="text-section">{t("backTitle")}<span className="sr-only"> {owner}</span></h1>
        <StitchedText text={owner} cell={10} knit className="max-w-full [&>svg]:h-auto [&>svg]:max-w-full" />
      </div>
      <KnitIn className="flex flex-col gap-3.5 px-edge pt-[30px]">
        <div role="status"><Note icon="lock">{shown ? t("hidden", {name}) : t("nothingShown", {name})}</Note></div>
        <p className="text-body">{t("nextHelp", {owner, name})}</p>
      </KnitIn>
    </Screen>
  );
}

/**
 * Rosa's all set (9.5): the last onboarding screen on someone else's phone. Its one button ends Rosa's
 * session there and loads the owner's Home afresh, replacing this page in the history.
 */
export function BorrowedAllSet({name, owner, organizer}: {name: string; owner: string; organizer: string}) {
  const t = useTranslations("borrowed");
  const done = useTranslations("getIn.done");
  const locale = useLocale();
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);
  useForgetOnRestore();
  return (
    <Screen actions={<>
      <Button disabled={pending} onClick={() => start(async () => {
        setFailed(false);
        try {
          await returnPhone();
        } catch {
          setFailed(true);
          return;
        }
        haptic("success");
        window.location.replace(`/${locale}`);
      })}>{t("signOut", {name})}</Button>
      {failed && <p role="alert" className="text-center text-body font-semibold">{t("signOutFailed", {name})}</p>}
    </>}>
      <StepBar id="welcome" step={4} total={4} done progress={t("allDone", {total: 4, owner})} />
      {/* at the largest text size the stitched words shrink to the column */}
      <div className="px-edge [&_svg]:h-auto [&_svg]:max-w-full">
        <Greeting top={done("top")} bottom={done("bottom")} />
      </div>
      <PageTitle title={t("doneTitle", {name})} lead={t("doneLead", {name})} className="pt-[26px]" />
      <div className="px-edge pt-[18px]">
        <Note icon="phone">{t("nextTime", {name, organizer})}</Note>
      </div>
    </Screen>
  );
}

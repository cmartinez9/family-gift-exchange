"use server";

import {getLocale, getTranslations} from "next-intl/server";
import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {requireViewer, type Viewer} from "@/server/auth";
import {
  answerQuestion, askYourPerson, changeParticipation, closeExchange, createExchange, DrawError, dryRunDraw,
  editExchange, practiceCommand, reportPair, revealMyPerson, runDraw, setKeepApart, setParticipants, startPractice,
  type ExchangeDetails,
} from "@/server/draw";

export type FormState = {error?: string; feedback?: string};
export type RevealState = {error?: string; personName?: string; personId?: string};

async function drawAction<T>(operation: () => Promise<T>): Promise<T | {error: string}> {
  const t = await getTranslations("draw");
  try {
    return await operation();
  } catch (error) {
    return {error: t(`errors.${error instanceof DrawError ? error.code : "unavailable"}`)};
  }
}

function field(data: FormData, name: string) {
  const value = data.get(name);
  return typeof value === "string" ? value : "";
}

function selected(data: FormData) {
  return data.getAll("people").filter((value): value is string => typeof value === "string");
}

function details(data: FormData): ExchangeDetails {
  return {
    name: field(data, "name"),
    giftDay: field(data, "giftDay") || null,
    giftTime: field(data, "giftTime") || null,
    place: field(data, "place") || null,
    budgetAmount: field(data, "budgetAmount") || null,
    listDeadline: field(data, "listDeadline") || null,
    drawDay: field(data, "drawDay") || null,
  };
}

async function refreshDrawPages() {
  const locale = await getLocale();
  revalidatePath(`/${locale}/exchanges`, "layout");
}

export async function create(_previous: FormState, data: FormData): Promise<FormState> {
  const viewer = await requireViewer();
  const result = await drawAction(() => createExchange(viewer, details(data)));
  if ("error" in result) return result;
  const locale = await getLocale();
  revalidatePath(`/${locale}/exchanges`, "layout");
  redirect(`/${locale}/exchanges/${result.id}/manage`);
}

type Management =
  | {kind: "edit" | "roster" | "ruleAdd" | "dryRun" | "close"}
  | {kind: "ruleRemove"; first: string; second: string}
  | {kind: "draw"; expectedVersion: number; allowSelection?: boolean}
  | {kind: "participation"; personId: string; status: "in" | "out"; expectedVersion: number};

export async function manage(id: string, request: Management, _previous: FormState, data: FormData): Promise<FormState> {
  const viewer = await requireViewer();
  const t = await getTranslations("draw");
  return drawAction(async () => {
    let feedback: string;
    switch (request.kind) {
      case "edit": {
        await editExchange(viewer, id, details(data));
        feedback = t("detailsSaved");
        break;
      }
      case "roster": {
        await setParticipants(viewer, id, selected(data));
        feedback = t("rosterSaved");
        break;
      }
      case "ruleAdd": {
        await setKeepApart(viewer, id, field(data, "first"), field(data, "second"), "custom");
        feedback = t("ruleSaved");
        break;
      }
      case "ruleRemove": {
        await setKeepApart(viewer, id, request.first, request.second, null);
        feedback = t("ruleRemoved");
        break;
      }
      case "draw": {
        await runDraw(viewer, id, {
          expectedVersion: request.expectedVersion, confirmation: field(data, "confirmation"),
          selection: request.allowSelection ? selected(data) : undefined,
        });
        feedback = t("drawDone");
        break;
      }
      case "participation": {
        const {changedGivers} = await changeParticipation(
          viewer, id, request.personId, request.status, request.expectedVersion,
        );
        feedback = t("repairDone", {count: changedGivers});
        break;
      }
      case "dryRun": {
        const {possible, fewestChoices} = await dryRunDraw(viewer, id);
        return {feedback: t(possible ? "dryPossible" : "dryImpossible", {count: fewestChoices})};
      }
      case "close": {
        await closeExchange(viewer, id);
        const locale = await getLocale();
        revalidatePath(`/${locale}/lists`, "layout");
        revalidatePath(`/${locale}/account`);
        feedback = t("closed");
        break;
      }
    }
    await refreshDrawPages();
    return {feedback};
  });
}

export async function openPreview(id: string, data: FormData) {
  await requireViewer();
  const locale = await getLocale();
  redirect(`/${locale}/exchanges/${encodeURIComponent(id)}/preview/${encodeURIComponent(field(data, "person"))}`);
}

export async function beginPractice(): Promise<FormState> {
  const viewer = await requireViewer();
  const locale = await getLocale();
  return drawAction(async () => {
    await startPractice(viewer, locale);
    await refreshDrawPages();
    return {};
  });
}

type PracticeManagement =
  | {kind: "draw"; expectedVersion: number}
  | {kind: "close"}
  | {kind: "participation"; personId: string; status: "in" | "out"; expectedVersion: number};

export async function managePractice(
  id: string, request: PracticeManagement, _previous: FormState, data: FormData,
): Promise<FormState> {
  const viewer = await requireViewer();
  const t = await getTranslations("draw");
  return drawAction(async () => {
    if (request.kind === "participation") {
      const result = await practiceCommand(viewer, request, id);
      await refreshDrawPages();
      return {feedback: t("repairDone", {count: result.changedGivers})};
    }
    if (request.kind === "draw") {
      await practiceCommand(viewer, {...request, confirmation: field(data, "confirmation")}, id);
    } else {
      await practiceCommand(viewer, request, id);
    }
    await refreshDrawPages();
    return {feedback: t(request.kind === "draw" ? "drawDone" : "closed")};
  });
}

export type MemberContext = {id: string; subject: string; version: number; practice?: true};

function checkSubject(viewer: Viewer, context: MemberContext) {
  if (!context.practice && viewer.actingAs !== context.subject) throw new DrawError("drawChanged");
}

export async function reveal(context: MemberContext): Promise<RevealState> {
  const viewer = await requireViewer();
  return drawAction(async () => {
    checkSubject(viewer, context);
    const {person} = context.practice
      ? await practiceCommand(viewer, {kind: "reveal", as: context.subject, expectedVersion: context.version}, context.id)
      : await revealMyPerson(viewer, context.id, context.version);
    await refreshDrawPages();
    return {personName: person.displayName, personId: person.id};
  });
}

type MemberCommand = {kind: "ask" | "report"} | {kind: "answer"; questionId: string};

export async function memberAction(
  context: MemberContext, request: MemberCommand, _previous: FormState, data: FormData,
): Promise<FormState> {
  const viewer = await requireViewer();
  const t = await getTranslations("draw");
  return drawAction(async () => {
    checkSubject(viewer, context);
    const {id, subject, version, practice} = context;
    const text = field(data, "text");
    const fake = {as: subject, expectedVersion: version};
    let feedback: string;
    switch (request.kind) {
      case "ask":
        if (practice) await practiceCommand(viewer, {...fake, kind: "ask", text}, id);
        else await askYourPerson(viewer, id, version, text);
        feedback = t("questionSent");
        break;
      case "answer":
        if (practice) await practiceCommand(viewer, {...fake, ...request, text}, id);
        else await answerQuestion(viewer, id, request.questionId, version, text);
        feedback = t("answerSent");
        break;
      case "report":
        if (practice) await practiceCommand(viewer, {...fake, kind: "report"}, id);
        else await reportPair(viewer, id, version);
        feedback = t("reportDone");
        break;
    }
    await refreshDrawPages();
    return {feedback};
  });
}

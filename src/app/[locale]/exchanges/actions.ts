"use server";

import {getLocale, getTranslations} from "next-intl/server";
import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {requireViewer, type Viewer} from "@/server/auth";
import {getWishlist} from "@/server/lists";
import {sizeKinds, sizePresets} from "@/server/lists/validation";
import {
  answerQuestion, askYourPerson, changeParticipation, closeExchange, createExchange, DrawError, dryRunDraw,
  editExchange, practiceCommand, reportPair, revealMyPerson, runDraw, setParticipants, startPractice,
  type ExchangeDetails,
} from "@/server/draw";

export type FormState = {error?: string; feedback?: string};
export type PersonItem = {
  id: string; title: string; store: string | null; price: string | null; photo: string | null; note: string | null; starred: boolean;
};
/** What your person's page shows after the reveal: their list, sizes and likes. */
export type PersonList = {items: PersonItem[]; sizes: string | null; likes: string | null};
export type RevealState = {error?: string; personName?: string; personId?: string; list?: PersonList};

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
  redirect(`/${locale}/exchanges/${result.id}/manage/people`);
}

/** Setup step 1: save the exchange, then on to who's in. */
export async function saveDetailsAndContinue(id: string, _previous: FormState, data: FormData): Promise<FormState> {
  const viewer = await requireViewer();
  const result = await drawAction(() => editExchange(viewer, id, details(data)));
  if (result && typeof result === "object" && "error" in result) return result;
  const locale = await getLocale();
  revalidatePath(`/${locale}/exchanges`, "layout");
  redirect(`/${locale}/exchanges/${encodeURIComponent(id)}/manage/people`);
}

/** Setup step 2: save who's taking part, then on to who lives where. */
export async function saveRosterAndContinue(id: string, _previous: FormState, data: FormData): Promise<FormState> {
  const viewer = await requireViewer();
  const result = await drawAction(() => setParticipants(viewer, id, selected(data)));
  if (result && typeof result === "object" && "error" in result) return result;
  const locale = await getLocale();
  revalidatePath(`/${locale}/exchanges`, "layout");
  redirect(`/${locale}/family`);
}

type Management =
  | {kind: "edit" | "dryRun" | "close"}
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

/** Your person's list, sizes and likes for their page. A practice person has no list. */
async function personList(viewer: Viewer, personId: string): Promise<PersonList | undefined> {
  let list;
  try {
    list = await getWishlist(viewer, personId);
  } catch {
    return undefined;
  }
  const t = await getTranslations("lists");
  const sizes = new Map(list.sizes.map((size) => [size.kind, size.value]));
  const system = sizePresets.shoeSystem.find((preset) => preset === sizes.get("shoeSystem"));
  const shown = list.owner.noClothes ? [t("noClothes")] : sizeKinds.flatMap((kind) => {
    const value = sizes.get(kind);
    if (!value || kind === "shoeSystem" || kind === "other") return [];
    return [`${t(`size.${kind}`)} ${value}${kind === "shoes" && system ? ` (${t(`shoe.${system}`)})` : ""}`];
  });
  return {
    sizes: shown.length ? shown.join(" · ") : null,
    likes: list.about.likes,
    items: list.items.map((item) => ({
      id: item.id, title: item.title, store: item.store, price: item.price, note: item.note, starred: item.starred,
      photo: item.hasPhoto ? "photo" : item.hasIcon ? "icon" : null,
    })),
  };
}

export async function readPersonList(personId: string): Promise<PersonList | undefined> {
  return personList(await requireViewer(), personId);
}

export async function reveal(context: MemberContext): Promise<RevealState> {
  const viewer = await requireViewer();
  return drawAction(async () => {
    checkSubject(viewer, context);
    const {person} = context.practice
      ? await practiceCommand(viewer, {kind: "reveal", as: context.subject, expectedVersion: context.version}, context.id)
      : await revealMyPerson(viewer, context.id, context.version);
    await refreshDrawPages();
    const list = context.practice ? undefined : await personList(viewer, person.id);
    return {personName: person.displayName, personId: person.id, list};
  });
}

type MemberCommand = {kind: "ask" | "report"} | {kind: "answer"; questionId: string};

export async function memberAction(
  context: MemberContext, request: MemberCommand, _previous: FormState, data: FormData,
): Promise<FormState> {
  const viewer = await requireViewer();
  const t = await getTranslations("draw");
  const result = await drawAction(async () => {
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
  // a fixed match: say what happened quietly, then open the new person
  if (request.kind === "report" && !("error" in result)) {
    const locale = await getLocale();
    redirect(context.practice
      ? `/${locale}/exchanges/practice?as=${encodeURIComponent(context.subject)}&fixed=1`
      : `/${locale}/exchanges/${encodeURIComponent(context.id)}?fixed=1`);
  }
  return result;
}

import {randomUUID} from "node:crypto";
import {and, eq, sql} from "drizzle-orm";
import type {FamilyTransaction} from "../db/database";
import {exchanges, families, participants} from "../db/schema";
import {DrawError, lockOrganizer, requireOrganizer, scopeDrawFamily, withDrawFamily, type DrawViewer} from "./access";
import {closeExchange} from "./exchange";
import {recordId} from "./inputs";
import {changeParticipation, reportPair, runDraw} from "./lifecycle";
import {memberDrawStatus, revealMyPerson} from "./member";
import {answerQuestion, askYourPerson, listOwnQuestions} from "./questions";
import {practiceFamilies} from "./schema";
import {auditedDraw, liveRoster, loadExchange, loadPairs} from "./store";

type PracticeLanguage = "en" | "es";
const examples = {
  en: {
    family: "The Snowbell Family",
    exchange: "Practice exchange",
    people: ["Pinewisp", "Glowberry", "Snowquill", "Starbloom", "Mossmint", "Frostbud", "Winterplum"],
  },
  es: {
    family: "Familia Campanieve",
    exchange: "Intercambio de práctica",
    people: ["Pinoluz", "Bayanieve", "Copopluma", "Florestrella", "Musgomenta", "Broteluz", "Ciruelín"],
  },
};

function practiceScope(viewer: DrawViewer) {
  return and(eq(practiceFamilies.familyId, viewer.familyId), eq(practiceFamilies.ownerId, viewer.personId));
}

async function loadPractice(tx: FamilyTransaction, viewer: DrawViewer) {
  const [practice] = await tx.select().from(practiceFamilies).where(practiceScope(viewer));
  return practice;
}

async function newPracticeExchange(
  tx: FamilyTransaction, familyId: string, exchangeName: string, roster: readonly string[],
) {
  const [exchange] = await tx.insert(exchanges).values({
    familyId, name: exchangeName, budgetAmount: "25.00", status: "open",
  }).returning({id: exchanges.id});
  await tx.insert(participants).values(roster.map((personId, index) => ({
    familyId, exchangeId: exchange.id, personId, status: index < 6 ? "in" as const : "out" as const,
  })));
  return exchange.id;
}

export async function startPractice(viewer: DrawViewer, language: PracticeLanguage) {
  requireOrganizer(viewer);
  return withDrawFamily(viewer.familyId, async (tx) => {
    await lockOrganizer(tx, viewer, "update");
    const previous = await loadPractice(tx, viewer);
    const example = examples[language];

    if (previous) {
      await scopeDrawFamily(tx, previous.practiceFamilyId);
      const exchange = await loadExchange(tx, previous.practiceFamilyId, previous.exchangeId);
      if (exchange.status !== "closed") return;
      const members = await liveRoster(tx, previous.practiceFamilyId);
      const organizer = members.find(({id}) => id === previous.practiceOrganizerId);
      const seed = Object.values(examples).find(({people}) => people[0] === organizer?.displayName);
      const byName = new Map(members.map(({displayName, id}) => [displayName, id]));
      if (!seed) throw new Error("Practice family is missing its organizer");
      const roster = seed.people.map((name) => {
        const id = byName.get(name);
        if (!id) throw new Error("Practice family is missing a member");
        return id;
      });
      const exchangeId = await newPracticeExchange(tx, previous.practiceFamilyId, example.exchange, roster);
      await scopeDrawFamily(tx, viewer.familyId);
      await tx.update(practiceFamilies).set({exchangeId}).where(practiceScope(viewer));
      return;
    }

    const practiceFamilyId = randomUUID();
    const roster = example.people.map(() => randomUUID());
    const [practiceOrganizerId] = roster;
    await scopeDrawFamily(tx, practiceFamilyId);
    await tx.insert(families).values({id: practiceFamilyId, name: example.family, defaultLanguage: language});
    const profiles = roster.map((id, index) => sql`(
      ${practiceFamilyId}, ${id}, ${example.people[index]}, ${language},
      ${index === 0 ? "organizer" : "member"}
    )`);
    await tx.execute(sql`
      INSERT INTO public.people (family_id, id, display_name, language, role)
      VALUES ${sql.join(profiles, sql`, `)}
    `);
    await tx.update(families).set({createdBy: practiceOrganizerId}).where(eq(families.id, practiceFamilyId));
    const exchangeId = await newPracticeExchange(tx, practiceFamilyId, example.exchange, roster);
    await scopeDrawFamily(tx, viewer.familyId);
    await tx.insert(practiceFamilies).values({
      familyId: viewer.familyId, ownerId: viewer.personId, practiceFamilyId, practiceOrganizerId, exchangeId,
    });
  });
}

async function practiceContext(viewer: DrawViewer, as?: string) {
  requireOrganizer(viewer);
  return withDrawFamily(viewer.familyId, async (tx) => {
    await lockOrganizer(tx, viewer);
    const practice = await loadPractice(tx, viewer);
    if (!practice) throw new DrawError("notFound");
    const personId = as === undefined ? practice.practiceOrganizerId : recordId(as);
    await scopeDrawFamily(tx, practice.practiceFamilyId);
    const member = (await liveRoster(tx, practice.practiceFamilyId)).find(({id}) => id === personId);
    if (!member) throw new DrawError("notFound");
    return {
      viewer: {
        familyId: practice.practiceFamilyId, sessionId: viewer.sessionId,
        personId, actingAs: personId, isOrganizer: personId === practice.practiceOrganizerId,
      },
      exchangeId: practice.exchangeId,
    };
  });
}

export async function practiceSeason(viewer: DrawViewer) {
  requireOrganizer(viewer);
  return auditedDraw(viewer.familyId, async (tx, decrypt) => {
    await lockOrganizer(tx, viewer);
    const practice = await loadPractice(tx, viewer);
    if (!practice) return null;
    await scopeDrawFamily(tx, practice.practiceFamilyId);
    const exchange = await loadExchange(tx, practice.practiceFamilyId, practice.exchangeId);
    const members = await liveRoster(tx, practice.practiceFamilyId);
    const names = new Map(members.map(({id, displayName}) => [id, displayName]));
    const pairs = exchange.version && exchange.status !== "closed"
      ? await loadPairs(tx, practice.practiceFamilyId, exchange, decrypt, "practice") : [];
    const current = await tx.select({id: participants.personId, status: participants.status})
      .from(participants).where(and(
        eq(participants.familyId, practice.practiceFamilyId), eq(participants.exchangeId, practice.exchangeId),
      ));
    const participating = new Set(current.filter(({status}) => status === "in").map(({id}) => id));
    return {
      exchange, people: members.map(({id, displayName}) => ({id, displayName, participating: participating.has(id)})),
      pairs: [...pairs].map(([giver, recipient]) => ({
        giver: names.get(giver) ?? "", recipient: names.get(recipient) ?? "",
      })),
    };
  });
}

export async function practiceMemberView(viewer: DrawViewer, personId: string) {
  const subject = await practiceContext(viewer, personId);
  const status = await memberDrawStatus(subject.viewer, subject.exchangeId);
  const questions = status.status === "ready" ? await listOwnQuestions(subject.viewer, subject.exchangeId) : null;
  return {status, questions};
}

export type PracticeCommand =
  | {kind: "draw"; expectedVersion: number; confirmation?: string}
  | {kind: "close"}
  | {kind: "participation"; personId: string; status: "in" | "out"; expectedVersion: number}
  | {kind: "reveal" | "report"; as: string; expectedVersion: number}
  | {kind: "ask"; as: string; expectedVersion: number; text: string}
  | {kind: "answer"; as: string; expectedVersion: number; questionId: string; text: string};

export async function practiceCommand(owner: DrawViewer, command: PracticeCommand) {
  const {viewer, exchangeId} = await practiceContext(owner, "as" in command ? command.as : undefined);
  switch (command.kind) {
    case "draw":
      return runDraw(viewer, exchangeId, command);
    case "close":
      return closeExchange(viewer, exchangeId);
    case "participation":
      return changeParticipation(viewer, exchangeId, command.personId, command.status, command.expectedVersion);
    case "reveal":
      return revealMyPerson(viewer, exchangeId, command.expectedVersion);
    case "report":
      return reportPair(viewer, exchangeId, command.expectedVersion);
    case "ask":
      return askYourPerson(viewer, exchangeId, command.expectedVersion, command.text);
    case "answer":
      return answerQuestion(viewer, exchangeId, command.questionId, command.expectedVersion, command.text);
  }
}

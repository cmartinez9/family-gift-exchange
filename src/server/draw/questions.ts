import {randomUUID} from "node:crypto";
import {and, eq, isNull} from "drizzle-orm";
import type {FamilyTransaction} from "../db/database";
import {authorizeSubject, DrawError, type DrawViewer} from "./access";
import {questionText, recordId} from "./inputs";
import {ownParticipant} from "./member";
import {questions} from "./schema";
import {encryptionKey, sealText} from "./sealing";
import {
  auditedDraw, authorizeSealedSubject, checkVersion, loadExchange, loadRecipient, loadSnapshot,
  requireOpen, type Exchange,
} from "./store";

type QuestionBinding = {
  id: string; familyId: string; exchangeId: string; askerId: string; drawVersion: number;
};

function binding(row: QuestionBinding, field: "question-text" | "question-answer" | "question-recipient") {
  return {
    familyId: row.familyId, exchangeId: row.exchangeId, giverId: row.askerId,
    questionId: row.id, version: row.drawVersion, field,
  };
}

function questionScope(viewer: DrawViewer, exchange: Exchange) {
  return and(eq(questions.familyId, viewer.familyId), eq(questions.exchangeId, exchange.id));
}

async function authorizeQuestions(tx: FamilyTransaction, viewer: DrawViewer, id: string) {
  await authorizeSubject(tx, viewer);
  const exchange = await loadExchange(tx, viewer.familyId, recordId(id));
  requireOpen(exchange);
  const participant = await ownParticipant(tx, viewer, exchange);
  if (!exchange.version || !participant) throw new DrawError("notFound");
  authorizeSealedSubject(await loadSnapshot(tx, viewer.familyId, exchange.id), viewer);
  return {exchange, seen: participant.seenVersion === exchange.version};
}

export async function askYourPerson(viewer: DrawViewer, id: string, expectedVersion: number, input: string) {
  const text = questionText(input);
  return auditedDraw(viewer, async (tx, decrypt) => {
    const {exchange, seen} = await authorizeQuestions(tx, viewer, id);
    checkVersion(exchange, expectedVersion);
    if (!seen) throw new DrawError("revealFirst");
    const recipient = await loadRecipient(tx, viewer, exchange, decrypt, "ask");
    const key = encryptionKey();
    const row = {
      id: randomUUID(), familyId: viewer.familyId, exchangeId: exchange.id,
      askerId: viewer.actingAs, drawVersion: exchange.version,
    };
    await tx.insert(questions).values({
      ...row,
      recipientSealed: sealText(key, binding(row, "question-recipient"), recipient),
      text: sealText(key, binding(row, "question-text"), text).toString("base64"),
    });
    return {id: row.id};
  });
}

export async function listOwnQuestions(viewer: DrawViewer, id: string) {
  return auditedDraw(viewer, async (tx, decrypt) => {
    const {exchange} = await authorizeQuestions(tx, viewer, id);
    const outgoing = await tx.select().from(questions).where(and(
      questionScope(viewer, exchange), eq(questions.askerId, viewer.actingAs),
    )).orderBy(questions.createdAt, questions.id);
    const candidates = await tx.select({
      id: questions.id, familyId: questions.familyId, exchangeId: questions.exchangeId,
      askerId: questions.askerId, drawVersion: questions.drawVersion, recipientSealed: questions.recipientSealed,
      text: questions.text, answeredAt: questions.answeredAt,
    }).from(questions).where(questionScope(viewer, exchange)).orderBy(questions.createdAt, questions.id);

    return {
      version: exchange.version,
      outgoing: outgoing.map((row) => ({
        id: row.id,
        text: decrypt.open("question-outbox", binding(row, "question-text"), Buffer.from(row.text, "base64")),
        answer: row.answer === null ? null : decrypt.open(
          "question-outbox", binding(row, "question-answer"), Buffer.from(row.answer, "base64"),
        ),
      })),
      incoming: candidates.flatMap((row) => {
        if (row.askerId === viewer.actingAs) return [];
        const recipient = decrypt.open("question-inbox", binding(row, "question-recipient"), row.recipientSealed);
        if (recipient !== viewer.actingAs) return [];
        return [{
          id: row.id,
          text: decrypt.open("question-inbox", binding(row, "question-text"), Buffer.from(row.text, "base64")),
          answered: row.answeredAt !== null,
        }];
      }),
    };
  });
}

export async function answerQuestion(
  viewer: DrawViewer, id: string, questionId: string, expectedVersion: number, input: string,
) {
  const answer = questionText(input);
  return auditedDraw(viewer, async (tx, decrypt) => {
    const {exchange} = await authorizeQuestions(tx, viewer, id);
    checkVersion(exchange, expectedVersion);
    const scope = and(questionScope(viewer, exchange), eq(questions.id, recordId(questionId)));
    const [row] = await tx.select({
      id: questions.id, familyId: questions.familyId, exchangeId: questions.exchangeId,
      askerId: questions.askerId, drawVersion: questions.drawVersion, recipientSealed: questions.recipientSealed,
      answeredAt: questions.answeredAt,
    }).from(questions).where(scope);
    if (!row || decrypt.open("answer", binding(row, "question-recipient"), row.recipientSealed) !== viewer.actingAs) {
      throw new DrawError("notFound");
    }
    if (row.answeredAt) throw new DrawError("alreadyAnswered");
    const sealed = sealText(encryptionKey(), binding(row, "question-answer"), answer).toString("base64");
    await tx.update(questions).set({answer: sealed, answeredAt: new Date()})
      .where(and(scope, isNull(questions.answeredAt)));
  });
}

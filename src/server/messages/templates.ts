import {createTranslator} from "next-intl";
import en from "../../../messages/en.json";
import es from "../../../messages/es.json";

export const templates = [
  "practice-reminder",
  "names-drawn",
  "list-reminder",
  "plans-changed",
  "draw-redrawn",
  "exchange-details-changed",
  "participation-cancelled",
  "gift-day-reminder",
  "pin-reset-request",
  "key-opened-elsewhere",
  "claimed-item-changed",
  "budget-changed",
  "question-answered",
  "list-nudge",
  "person-nudge",
] as const;

export type Template = (typeof templates)[number];
export type Language = "en" | "es";

type TemplateContent =
  | {template: Exclude<Template, "pin-reset-request">}
  | {template: "pin-reset-request"; requesterName: string};

export function isTemplate(value: string): value is Template {
  return templates.some((template) => template === value);
}

export function notificationTranslator(language: Language) {
  return createTranslator({locale: language, messages: language === "es" ? es : en, namespace: "notify"});
}

export function renderPrivatePush(language: Language) {
  const t = notificationTranslator(language);
  return {title: t("privatePush.title"), body: t("privatePush.body")};
}

export function renderMessage(language: Language, content: TemplateContent) {
  const t = notificationTranslator(language);
  const title = t(`templates.${content.template}.title`);

  const body = content.template === "pin-reset-request"
    ? t("templates.pin-reset-request.body", {name: content.requesterName})
    : t(`templates.${content.template}.body`);

  return {title, body};
}

export function readTemplateContent(row: {template: string; requesterName: string | null}): TemplateContent | null {
  if (!isTemplate(row.template)) return null;
  if (row.template !== "pin-reset-request") return {template: row.template};
  return row.requesterName ? {template: row.template, requesterName: row.requesterName} : null;
}

import type {ListError} from "@/server/lists";
import type {LinkError} from "@/server/lists/link-preview";
import type {ClaimProgress} from "@/server/lists/claims";

export type Feedback = ListError["code"] | LinkError["code"] | "could-not-save";
export type FormState = {status?: "saved"; error?: Feedback};
export type ClaimState = FormState & {released?: ClaimProgress};
export type PreviewCard = {
  url: string;
  title: string | null;
  price: string | null;
  store: string;
  icon: string;
  photo?: string;
  favicon?: string;
  ticket?: string;
};
export type PreviewState = {card?: PreviewCard; error?: Feedback};

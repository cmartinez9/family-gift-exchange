import type {Language} from "./templates";
import {notificationTranslator} from "./templates";

export function groupChatMessages(language: Language, appAddress: string, familyId: string) {
  const address = new URL(`/${language}/sign-in`, new URL(appAddress).origin);
  address.searchParams.set("family", familyId);
  const t = notificationTranslator(language);

  return (["wishlists", "draw", "giftDay"] as const).map((id) => {
    const text = t(`groupChat.${id}`, {address: address.href});
    return {id, text, whatsapp: `https://wa.me/?text=${encodeURIComponent(text)}`};
  });
}

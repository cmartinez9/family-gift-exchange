import fc from "fast-check";
import {expect, it} from "vitest";
import {groupChatMessages} from "../../src/server/messages/group-chat";
import {readTemplateContent, renderMessage, templates} from "../../src/server/messages/templates";

it.each(templates)("renders %s in both languages using only declared inputs", (template) => {
  fc.assert(fc.property(fc.uuid(), fc.uuid(), (pairingIdentity, claimIdentity) => {
    const row = {
      template,
      requesterName: template === "pin-reset-request" ? "Tinsel" : pairingIdentity,
      assignment: {giver: pairingIdentity, recipient: claimIdentity},
      claim: {personId: claimIdentity},
    };
    const content = readTemplateContent(row);
    expect(content).not.toBeNull();
    const english = renderMessage("en", content!);
    const spanish = renderMessage("es", content!);
    expect(english.title).not.toEqual(spanish.title);
    expect(english.body).not.toEqual(spanish.body);
    for (const rendered of [english, spanish]) {
      expect(Object.keys(rendered)).toEqual(["title", "body"]);
      expect(rendered.title).not.toContain("templates.");
      expect(rendered.body).not.toContain("templates.");
      expect(JSON.stringify(rendered)).not.toContain(pairingIdentity);
      expect(JSON.stringify(rendered)).not.toContain(claimIdentity);
      if (template === "pin-reset-request") expect(rendered.body).toContain("Tinsel");
    }
  }), {numRuns: 25});
});

it("uses the public app origin in both languages and encodes the WhatsApp text", () => {
  const address = "https://gifts.example/family/mock-family-key?pin=9874#private";
  const familyId = "d9a3d678-1cb8-4739-8941-a7cb66072927";
  const english = groupChatMessages("en", address, familyId);
  const spanish = groupChatMessages("es", address, familyId);
  expect(english.map(({id}) => id)).toEqual(["wishlists", "draw", "giftDay"]);
  expect(english.map(({text}) => text)).not.toEqual(spanish.map(({text}) => text));

  for (const {text, whatsapp} of [...english, ...spanish]) {
    expect(text).toContain("https://gifts.example/");
    expect(text).toContain(`/sign-in?family=${familyId}`);
    expect(text).not.toContain("mock-family-key");
    expect(text).not.toContain("9874");
    const shareUrl = new URL(whatsapp);
    expect(shareUrl.origin).toBe("https://wa.me");
    expect(shareUrl.searchParams.get("text")).toBe(text);
  }
});

import {randomUUID} from "node:crypto";
import type {AuthenticationResponseJSON} from "@simplewebauthn/server";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {redeemKey} from "../../src/server/auth/access";
import type {Viewer} from "../../src/server/auth";
import {digest, secret} from "../../src/server/auth/session";
import {authenticationFinish, authenticationStart} from "../../src/server/auth/webauthn";
import type {FamilyTransaction} from "../../src/server/db/database";

const server = vi.hoisted(() => ({cookies: new Map<string, string>(), withFamily: vi.fn()}));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({cookies: async () => ({
  get: (name: string) => ({value: server.cookies.get(name)}),
  set: (name: string, value: string) => { server.cookies.set(name, value); },
})}));
vi.mock("@/server/db/client", () => ({withFamily: server.withFamily}));
vi.mock("@simplewebauthn/server", () => ({generateAuthenticationOptions: async () => ({challenge: "signed-challenge"})}));

const personId = randomUUID();
const viewer: Viewer = {
  familyId: randomUUID(), personId, actingAs: personId, sessionId: randomUUID(), isOrganizer: false,
  borrowed: {lenderSessionId: randomUUID(), lenderPersonId: randomUUID(), hidden: true},
};
const device = {hash: digest(secret()), kind: "iphone" as const, network: null};

beforeEach(() => {
  vi.resetAllMocks();
  server.cookies.clear();
  vi.stubEnv("AUTH_SECRET", secret());
  vi.stubEnv("AUTH_ORIGIN", "https://exchange.example");
});

afterEach(() => vi.unstubAllEnvs());

it.each([false, true])("refuses ordinary key redemption from a borrowed viewer (typed=%s)", async (typed) => {
  const insert = vi.fn(), update = vi.fn();
  const tx = {insert, update} as unknown as FamilyTransaction;
  await expect(redeemKey(tx, {
    familyId: viewer.familyId, value: typed ? "ABCDEF" : secret(), typed, pin: "4268", confirmation: "4268",
    pepper: secret(), device, currentViewer: viewer, now: new Date(),
  })).resolves.toEqual({error: "otherPerson"});
  expect(insert).not.toHaveBeenCalled();
  expect(update).not.toHaveBeenCalled();
});

it("refuses same-person Face ID authentication without replacing a borrowed session", async () => {
  const session = {id: randomUUID(), cookie: "verified-session"};
  server.withFamily.mockResolvedValue(session);
  await authenticationStart(device);
  const response = {response: {
    userHandle: Buffer.from((viewer.familyId + viewer.personId).replaceAll("-", ""), "hex").toString("base64url"),
  }} as AuthenticationResponseJSON;
  await expect(authenticationFinish(device, response, viewer)).resolves.toBeNull();
  expect(server.withFamily).not.toHaveBeenCalled();
});

it("keeps the same-person Face ID sign-in available on an ordinary phone", async () => {
  const session = {id: randomUUID(), cookie: "verified-session"};
  server.withFamily.mockResolvedValue(session);
  await authenticationStart(device);
  const response = {response: {
    userHandle: Buffer.from((viewer.familyId + viewer.personId).replaceAll("-", ""), "hex").toString("base64url"),
  }} as AuthenticationResponseJSON;
  await expect(authenticationFinish(device, response, {...viewer, borrowed: undefined}))
    .resolves.toEqual({familyId: viewer.familyId, session});
});

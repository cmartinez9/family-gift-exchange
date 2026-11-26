import type {issueKey} from "../../src/server/auth/access";

/** Fail at fixture setup rather than continuing with an unsuccessful key request. */
export function requireIssuedKey(result: Awaited<ReturnType<typeof issueKey>>) {
  if (!("token" in result)) throw new Error(`Expected a private key: ${result.error}`);
  return result;
}

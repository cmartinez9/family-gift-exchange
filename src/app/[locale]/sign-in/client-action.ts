import {unstable_rethrow} from "next/navigation";
import type {AuthResult} from "./actions";

export async function tryAuthAction<T extends AuthResult | void>(action: () => Promise<T>): Promise<T | AuthResult> {
  try {
    return await action();
  } catch (error) {
    unstable_rethrow(error);
    return {error: "connectionFailed"};
  }
}

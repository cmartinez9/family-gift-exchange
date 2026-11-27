"use client";

import {unstable_rethrow} from "next/navigation";
import type {FormState} from "./action-types";

export async function runListAction<T extends FormState>(action: () => Promise<T>): Promise<T | FormState> {
  try {
    return await action();
  } catch (error) {
    unstable_rethrow(error);
    return {error: "could-not-save"};
  }
}

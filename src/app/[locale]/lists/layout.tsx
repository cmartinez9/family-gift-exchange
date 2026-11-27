import type {ReactNode} from "react";
import {requireViewer} from "@/server/auth";

/** Every list screen needs a signed-in viewer; each page draws its own screen. */
export default async function ListLayout({children}: {children: ReactNode}) {
  await requireViewer();
  return children;
}

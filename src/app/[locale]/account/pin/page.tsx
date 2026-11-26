import {requireViewer} from "@/server/auth";
import {NewPin} from "./new-pin";
import {screenTitle} from "../../sign-in/title";

export async function generateMetadata() {
  return screenTitle("you.newPin");
}

/** Make a new PIN, after Face ID let you in: the same two tries as the first PIN. */
export default async function NewPinPage() {
  await requireViewer();
  return <NewPin />;
}

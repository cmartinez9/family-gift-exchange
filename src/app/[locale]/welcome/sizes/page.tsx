import {requireViewer} from "@/server/auth";
import {mySizes} from "@/server/auth/account";
import {withFamily} from "@/server/db/client";
import {welcomeAssignment} from "../assignment";
import {SizesStep} from "../steps";
import {screenTitle} from "../../sign-in/title";

export async function generateMetadata() {
  return screenTitle("sizes.title");
}

export default async function WelcomeSizesPage() {
  const viewer = await requireViewer();
  const [initial, assignment] = await Promise.all([
    withFamily(viewer.familyId, (tx) => mySizes(tx, viewer.familyId, viewer.actingAs)),
    welcomeAssignment(viewer),
  ]);
  return <SizesStep ownerId={viewer.actingAs} initial={initial} profileHref={`/lists/${viewer.actingAs}/profile`}
    personOpened={Boolean(assignment?.recipientId)} />;
}

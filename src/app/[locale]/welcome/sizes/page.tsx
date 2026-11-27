import {requireWelcomeViewer, type WelcomeProps} from "../viewer";
import {mySizes} from "@/server/auth/account";
import {withFamily} from "@/server/db/client";
import {welcomeAssignment} from "../assignment";
import {SizesStep} from "../steps";
import {screenTitle} from "../../sign-in/title";

export async function generateMetadata() {
  return screenTitle("sizes.title");
}

export default async function WelcomeSizesPage(props: WelcomeProps = {}) {
  const viewer = await requireWelcomeViewer(props);
  const [initial, assignment] = await Promise.all([
    withFamily(viewer.familyId, (tx) => mySizes(tx, viewer.familyId, viewer.actingAs)),
    viewer.borrowed ? null : welcomeAssignment(viewer),
  ]);
  return <SizesStep ownerId={viewer.actingAs} initial={initial} profileHref={viewer.borrowed ? `/welcome/sizes/more?borrowed=${viewer.sessionId}` : `/lists/${viewer.actingAs}/profile`}
    personOpened={Boolean(assignment?.recipientId)}
    replace={Boolean(viewer.borrowed)} borrowedSessionId={viewer.borrowed ? viewer.sessionId : undefined} />;
}

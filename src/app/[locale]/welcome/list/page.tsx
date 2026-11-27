import {requireWelcomeViewer, type WelcomeProps} from "../viewer";
import {welcomeAssignment} from "../assignment";
import {AddStep} from "../steps";
import {screenTitle} from "../../sign-in/title";

export async function generateMetadata() {
  return screenTitle("add.title");
}

export default async function WelcomeListPage(props: WelcomeProps = {}) {
  const viewer = await requireWelcomeViewer(props);
  const assignment = viewer.borrowed ? null : await welcomeAssignment(viewer);
  return <AddStep ownerId={viewer.actingAs} personOpened={Boolean(assignment?.recipientId)}
    replace={Boolean(viewer.borrowed)} borrowedSessionId={viewer.borrowed ? viewer.sessionId : undefined} />;
}

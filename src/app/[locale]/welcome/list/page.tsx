import {requireWelcomeViewer, type WelcomeProps} from "../viewer";
import {AddStep} from "../steps";
import {screenTitle} from "../../sign-in/title";

export async function generateMetadata() {
  return screenTitle("add.title");
}

export default async function WelcomeListPage(props: WelcomeProps = {}) {
  const viewer = await requireWelcomeViewer(props);
  return <AddStep ownerId={viewer.actingAs} replace={Boolean(viewer.borrowed)} borrowedSessionId={viewer.borrowed ? viewer.sessionId : undefined} />;
}

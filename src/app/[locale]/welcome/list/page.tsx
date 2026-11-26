import {requireViewer} from "@/server/auth";
import {welcomeAssignment} from "../assignment";
import {AddStep} from "../steps";
import {screenTitle} from "../../sign-in/title";

export async function generateMetadata() {
  return screenTitle("add.title");
}

export default async function WelcomeListPage() {
  const viewer = await requireViewer();
  const assignment = await welcomeAssignment(viewer);
  return <AddStep ownerId={viewer.actingAs} personOpened={Boolean(assignment?.recipientId)} />;
}

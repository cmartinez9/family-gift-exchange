import {requireViewer} from "@/server/auth";
import {AddStep} from "../steps";
import {screenTitle} from "../../sign-in/title";

export async function generateMetadata() {
  return screenTitle("add.title");
}

export default async function WelcomeListPage() {
  const viewer = await requireViewer();
  return <AddStep ownerId={viewer.actingAs} replace={Boolean(viewer.borrowed)} />;
}

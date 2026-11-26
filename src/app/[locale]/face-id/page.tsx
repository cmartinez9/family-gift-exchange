import {requireViewer} from "@/server/auth";
import {FaceIdOffer} from "../sign-in/get-in";
import {screenTitle} from "../sign-in/title";

export async function generateMetadata() {
  return screenTitle("face.title");
}

export default async function FaceIdPage({searchParams}: {searchParams: Promise<{setup?: string; welcome?: string}>}) {
  const viewer = await requireViewer();
  const search = await searchParams;
  const welcome = search.welcome === "1";
  // the organizer goes on to set up the family; a new member goes on to onboarding
  const next = search.setup === "1" && viewer.isOrganizer ? "/family" : welcome ? "/welcome" : "/account";
  return <FaceIdOffer next={next} steps={welcome} />;
}

import {SignInFlow} from "./screen";
import {screenTitle} from "./title";

export async function generateMetadata() {
  return screenTitle("steps.signIn");
}

export default async function SignInPage({searchParams}: {
  searchParams: Promise<{family?: string; person?: string; join?: string; safety?: string; all?: string}>;
}) {
  return <SignInFlow search={await searchParams} />;
}

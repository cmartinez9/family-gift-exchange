import {getLocale} from "next-intl/server";
import {redirect} from "next/navigation";
import {requireViewer} from "@/server/auth";

/**
 * Onboarding starts with your person (2.1 to 2.4) once the draw is wired in; until then it starts at
 * your sizes, and the step bar shows "Your person" waiting.
 */
export default async function WelcomePage() {
  await requireViewer();
  redirect(`/${await getLocale()}/welcome/sizes`);
}

import {getLocale} from "next-intl/server";
import {redirect} from "next/navigation";
import {requireViewer} from "@/server/auth";

export default async function WelcomePage() {
  await requireViewer();
  redirect(`/${await getLocale()}/welcome/sizes`);
}

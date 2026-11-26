import {notFound} from "next/navigation";
import {Gallery} from "./gallery";

export const dynamic = "force-dynamic";
export const metadata = {title: "Design system"};

/** The design system, every component, state and motion. Development only, like /dev/messages. */
export default async function DesignGalleryPage({searchParams}: {searchParams: Promise<{tab?: string}>}) {
  if (process.env.NODE_ENV !== "development") {
    notFound();
  }
  const {tab} = await searchParams;
  return <Gallery tab={tab === "list" || tab === "family" ? tab : "home"} />;
}

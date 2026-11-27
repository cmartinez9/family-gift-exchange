import {getLocale, getTranslations} from "next-intl/server";
import {redirect} from "next/navigation";
import {requireViewer, type Viewer} from "@/server/auth";
import {activePerson} from "@/server/auth/access";
import {phoneOwnerName} from "@/server/auth/borrowed";
import {withFamily} from "@/server/db/client";
import {DrawError, listExchanges, memberDrawStatus} from "@/server/draw";
import {BorrowedPerson} from "./person";

export async function generateMetadata() {
  const [t, home] = await Promise.all([getTranslations("borrowed"), getTranslations("home")]);
  return {title: `${t("title")} · ${home("title")}`, referrer: "no-referrer" as const, robots: {index: false, follow: false}};
}

/** The open exchange's drawn person for this relative, if there is one to open. */
async function personToOpen(viewer: Viewer) {
  try {
    const current = (await listExchanges(viewer)).find(({status}) => status !== "closed");
    if (!current) return null;
    const state = await memberDrawStatus(viewer, current.id);
    return state.status === "ready" && state.exchange.version ? {id: state.exchange.id, version: state.exchange.version} : null;
  } catch (error) {
    if (error instanceof DrawError) return null;
    throw error;
  }
}

/**
 * Step 2 on a borrowed phone (9.3, 9.4): the relative who just made their PIN opens their own person, hides
 * it, and hands the phone back. Only a session opened on someone else's phone comes here.
 */
export default async function BorrowedPhonePage() {
  const viewer = await requireViewer({borrowed: "reveal"});
  const locale = await getLocale();
  if (!viewer.borrowed) redirect(`/${locale}`);
  const {name, owner} = await withFamily(viewer.familyId, async (tx) => ({
    name: (await activePerson(tx, viewer.familyId, viewer.personId))?.displayName ?? "",
    owner: await phoneOwnerName(tx, viewer) ?? "",
  }));
  const exchange = viewer.borrowed.hidden ? null : await personToOpen(viewer);
  return <BorrowedPerson key={`${exchange?.id}.${exchange?.version}.${viewer.borrowed.hidden}`}
    name={name} owner={owner} exchange={exchange} hidden={viewer.borrowed.hidden} />;
}

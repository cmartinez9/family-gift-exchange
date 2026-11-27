import type {Viewer} from "@/server/auth";

/** Where the three tabs go for this viewer: My list is the list they are acting for; Family is everyone's lists. */
export function tabHrefs(viewer: Pick<Viewer, "actingAs">) {
  return {home: "/", list: `/lists/${viewer.actingAs}`, family: "/lists"} as const;
}

/** A shoe size as people write it: 7½, not 7.5. */
export function sizeLabel(value: string) {
  return value.replace(/^(\d+)\.5$/, "$1½").replace(/^XXL$/, "2XL");
}

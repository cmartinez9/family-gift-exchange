import "server-only";
import {and, eq, ne} from "drizzle-orm";
import {withFamily} from "../db/client";
import {aboutMe, people, sizes} from "../db/schema";
import {ListError, requireListEditor, type ListViewer} from "./access";
import {aboutFields, isSizeKind, listText, sizeValue, type AboutField} from "./validation";

export async function saveListSize(viewer: ListViewer, ownerId: string, kind: string, rawValue: string) {
  if (!isSizeKind(kind)) throw new ListError("invalid-size");
  const value = sizeValue(kind, rawValue);
  if (value === undefined) throw new ListError("invalid-size");
  await withFamily(viewer.familyId, async (tx) => {
    await requireListEditor(tx, viewer, ownerId);
    const scope = and(
      eq(sizes.familyId, viewer.familyId), eq(sizes.personId, ownerId), eq(sizes.kind, kind),
    );
    if (!value) {
      await tx.delete(sizes).where(scope);
      return;
    }
    await tx.insert(sizes).values({familyId: viewer.familyId, personId: ownerId, kind, value})
      .onConflictDoUpdate({
        target: [sizes.familyId, sizes.personId, sizes.kind],
        set: {value, updatedAt: new Date()},
        setWhere: ne(sizes.value, value),
      });
  });
}

export async function saveNoClothes(viewer: ListViewer, ownerId: string, noClothes: boolean) {
  await withFamily(viewer.familyId, async (tx) => {
    await requireListEditor(tx, viewer, ownerId);
    await tx.update(people).set({noClothes}).where(and(
      eq(people.familyId, viewer.familyId), eq(people.id, ownerId),
    ));
  });
}

export async function saveAboutField(viewer: ListViewer, ownerId: string, field: AboutField, rawValue: string) {
  const value = listText(rawValue, 500);
  if (!aboutFields.includes(field) || value === undefined) throw new ListError("invalid-profile");
  const update = {[field]: value || null};
  await withFamily(viewer.familyId, async (tx) => {
    await requireListEditor(tx, viewer, ownerId);
    await tx.insert(aboutMe).values({familyId: viewer.familyId, personId: ownerId, ...update})
      .onConflictDoUpdate({target: [aboutMe.familyId, aboutMe.personId], set: update});
  });
}

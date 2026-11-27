"use client";

import {useOptimistic, useState, useTransition} from "react";
import {useFormatter, useLocale, useTranslations} from "next-intl";
import {Button, ButtonLink, TextButton} from "@/components/ui/button";
import {Card, Chevron, IconDisc, ListRow, Rows} from "@/components/ui/card";
import {EmptyBlock} from "@/components/ui/blocks";
import {HeartToggle, ItemCard} from "@/components/ui/item-card";
import {KnitIn} from "@/components/ui/motion/knit-in";
import {haptic} from "@/components/ui/motion/haptic";
import {AppLink} from "@/components/ui/navigation";
import {Link, useRouter} from "@/i18n/navigation";
import {Sheet} from "@/components/ui/sheet";
import {toast} from "@/components/ui/toast";
import type {ItemKind} from "@/server/lists/validation";
import {itemCommand, setItemStar} from "../actions";
import {ItemForm} from "../item-form";
import {runListAction} from "../client-action";
import {ItemThumb, missesPicture, type ListItemView} from "../item-view";
import {commitPendingRemovals, removeWithUndo, usePendingRemovals} from "../pending-removals";

const ADD_OPTIONS = [
  {kind: "note", icon: "pencil", title: "newNote", sub: "addNoteSub"},
  {kind: "link", icon: "link", title: "newLink", sub: "addLinkSub"},
  {kind: "photo", icon: "camera", title: "addPhotoTitle", sub: "addPhotoSub"},
] as const;

/**
 * Your own list (or the list of someone you help): words first, one big "Add something", your sizes, then
 * each thing with its heart. Tapping a thing opens it in a sheet over the list. Taking something off has
 * Undo instead of a confirm: it disappears at once.
 */
export function OwnList({ownerId, items, sizes, closeLabel}: {
  ownerId: string;
  items: readonly ListItemView[];
  /** The "My sizes" row's line, or null when there are none yet. */
  sizes: string | null;
  closeLabel: string;
}) {
  const t = useTranslations("lists");
  const format = useFormatter();
  const locale = useLocale();
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const hidden = usePendingRemovals(ownerId, items);
  const [optimisticItems, setStar] = useOptimistic(items, (current, change: {id: string; starred: boolean}) =>
    current.map((item) => item.id === change.id ? {...item, starred: change.starred} : item));
  const [, startTransition] = useTransition();

  const shown = optimisticItems.filter((item) => !hidden.has(item.id));
  const editingItem = optimisticItems.find((item) => item.id === editing);
  const goldId = shown.find(missesPicture)?.id;
  const editHref = (itemId: string) => `/lists/${ownerId}/items/${itemId}/edit`;
  const open = (itemId: string) => {
    setRound((count) => count + 1);
    setEditing(itemId);
  };

  const takeOff = (item: ListItemView) => {
    setEditing(null);
    haptic("soft");
    removeWithUndo(locale, ownerId, item.id, t("tookOff", {title: item.title}), (error) => t(`feedback.${error}`), router.refresh);
  };

  const star = (item: ListItemView, on: boolean) => {
    haptic("tick");
    startTransition(async () => {
      setStar({id: item.id, starred: on});
      const result = await runListAction(() => setItemStar(ownerId, item.id, on));
      if (result.error) {
        toast({message: t(`feedback.${result.error}`), icon: "alert"});
      }
    });
  };

  const command = (item: ListItemView, name: "up" | "down" | "refresh") => {
    setEditing(null);
    startTransition(async () => {
      if ((name === "up" || name === "down") && !await commitPendingRemovals(ownerId)) return;
      const result = await runListAction(() => itemCommand(ownerId, item.id, name));
      if (result?.error) toast({message: t(`feedback.${result.error}`), icon: "alert"});
    });
  };

  const addOptions = (
    <Rows>
      {ADD_OPTIONS.map(({kind, icon, title, sub}) => (
        <AppLink key={kind} href={`/lists/${ownerId}/items/new?kind=${kind}`} transition="push"
          className="fge-press block w-full" onClick={() => setAdding(false)}>
          <ListRow as="span" lead={<IconDisc icon={icon} size={52} iconSize={24} />} title={t(title)} sub={t(sub)}
            trail={<Chevron />} className="min-h-[76px]" />
        </AppLink>
      ))}
    </Rows>
  );

  return (
    <>
      <div className="flex flex-col gap-card-gap px-edge pt-5 pb-6">
        {shown.length > 0 && (
          <Button icon="plus" onClick={() => {
            haptic("soft");
            setAdding(true);
          }}>{t("addSomething")}</Button>
        )}
        {shown.length > 0 && (
          <Card flush className="px-[18px] py-1">
            <AppLink href={`/lists/${ownerId}/profile`} transition="push" className="fge-press block rounded-[24px]">
              <ListRow as="span" lead={<IconDisc icon="shirt" />} title={t("mySizes")} sub={sizes ?? t("sizesEmpty")} trail={<Chevron />} />
            </AppLink>
          </Card>
        )}
        {shown.length === 0 && (
          <div className="pt-3">
            <EmptyBlock title={t("emptyTitle")} actions={<>
              <ButtonLink variant="card" transition="push" href={`/lists/${ownerId}/items/new?kind=note`} icon="pencil">{t("newNote")}</ButtonLink>
              <div className="grid grid-cols-[1.25fr_1fr] gap-2">
                <ButtonLink variant="soft" transition="push" href={`/lists/${ownerId}/items/new?kind=link`} icon="link">{t("newLink")}</ButtonLink>
                <ButtonLink variant="soft" transition="push" href={`/lists/${ownerId}/items/new?kind=photo`} icon="camera">{t("photoShort")}</ButtonLink>
              </div>
            </>}>
              {t("emptyLead")}
            </EmptyBlock>
          </div>
        )}
        <KnitIn as="ul" className="flex flex-col gap-card-gap">
          {shown.map((item) => {
            const gold = item.id === goldId;
            const starred = item.starred;
            return (
              <li key={item.id}>
                <article aria-label={item.title}>
                <ItemCard tone={gold ? "next" : "info"} titleAs="h2"
                  picture={<ItemThumb item={item} on={gold ? "next" : "info"} camera={missesPicture(item)} />}
                  title={(
                    <Link href={editHref(item.id)} aria-label={t("editNamedItem", {title: item.title})}
                      className="break-words after:absolute after:inset-0 after:rounded-item after:content-['']"
                      onClick={(event) => {
                        event.preventDefault();
                        haptic("soft");
                        open(item.id);
                      }}>
                      <span aria-hidden="true" className="hyphens-auto">{item.title}</span>
                    </Link>
                  )}
                  store={item.store ?? undefined}
                  price={item.price !== null ? format.number(Number(item.price), {style: "currency", currency: "USD"}) : undefined}
                  heart={<span className="relative z-[1]"><HeartToggle on={starred} label={t("star")} onToggle={() => star(item, !starred)} /></span>}
                  note={item.note ? <span className="whitespace-pre-wrap break-words">{item.note}</span> : undefined}
                  after={gold ? (
                    <div className="relative z-[1] flex flex-col items-start">
                      <p className="pt-3 text-body">{t("noPicture", {store: item.store ?? ""})}</p>
                      <Button variant="small" icon="camera" className="mt-2.5" onClick={() => open(item.id)}>{t("newPhoto")}</Button>
                    </div>
                  ) : undefined}
                  className="[&_h2]:break-words" />
                </article>
              </li>
            );
          })}
        </KnitIn>
      </div>

      <Sheet open={adding} onClose={() => setAdding(false)} title={t("addSomething")} closeLabel={closeLabel}>
        {addOptions}
      </Sheet>

      <Sheet open={Boolean(editingItem)} onClose={() => setEditing(null)} title={t("editItem")} closeLabel={closeLabel}>
        {editingItem && (
          <ItemForm key={`${editingItem.id}-${round}`} ownerId={ownerId} kind={editingItem.kind as ItemKind} mode="sheet"
            initial={editingItem}
            onSaved={() => {
              setEditing(null);
              toast(t("saved"));
            }}
            onRemove={() => takeOff(editingItem)}
            footer={<ItemOrder item={editingItem} items={shown} onCommand={command} />} />
        )}
      </Sheet>
    </>
  );
}

/** Moving a thing up or down the list, and fetching a link's picture again: quiet text buttons. */
function ItemOrder({item, items, onCommand}: {
  item: ListItemView; items: readonly ListItemView[]; onCommand: (item: ListItemView, name: "up" | "down" | "refresh") => void;
}) {
  const t = useTranslations("lists");
  const index = items.findIndex(({id}) => id === item.id);
  const first = index <= 0, last = index === items.length - 1;
  if (first && last && !item.url) return null;
  return (
    <div className="flex flex-wrap justify-center gap-x-2">
      {!first && <TextButton onClick={() => onCommand(item, "up")}>{t("moveUp")}</TextButton>}
      {!last && <TextButton onClick={() => onCommand(item, "down")}>{t("moveDown")}</TextButton>}
      {item.url && <TextButton onClick={() => onCommand(item, "refresh")}>{t("refresh")}</TextButton>}
    </div>
  );
}

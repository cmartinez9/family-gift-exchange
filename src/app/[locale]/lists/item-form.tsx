"use client";

import {useActionState, useEffect, useId, useRef, useState, type ReactNode} from "react";
import {useFormatter, useLocale, useTranslations} from "next-intl";
import {Button, TextButton} from "@/components/ui/button";
import {cn} from "@/components/ui/cn";
import {Icon} from "@/components/ui/icon";
import {TextArea, TextField} from "@/components/ui/inputs";
import {ItemPicture, NoPicture} from "@/components/ui/item-card";
import {haptic} from "@/components/ui/motion/haptic";
import {NOTE_LIMIT, TITLE_LIMIT, type ItemKind} from "@/server/lists/validation";
import type {Feedback, FormState, PreviewState} from "./action-types";
import {saveItem} from "./actions";
import {runListAction} from "./client-action";
import {FormFeedback} from "./controls";

type InitialItem = {
  id: string;
  title: string;
  note: string | null;
  price: string | null;
  starred: boolean;
  url: string | null;
  store?: string | null;
  photo?: string;
};

export async function preparePhoto(file: File) {
  if (file.size <= 3_000_000 && !/hei[cf]$/i.test(file.type || file.name)) return file;
  const url = URL.createObjectURL(file);
  try {
    const image = new window.Image();
    image.src = url;
    await image.decode();
    const scale = Math.min(1, 1500 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error();
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const result = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!result || result.size > 3_000_000) throw new Error();
    return new File([result], "photo.jpg", {type: result.type});
  } catch (error) {
    if (file.size <= 3_000_000) return file;
    throw error;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const limit = (value: string, length: number) => [...value].slice(0, length).join("");

/**
 * `page` is a pushed page that returns to the list; `sheet` sits in the edit sheet over the list, saves
 * without leaving it, and offers to take the thing off the list.
 */
export function ItemForm({ownerId, kind, initial, mode = "page", onSaved, onRemove, footer}: {
  ownerId: string;
  kind: ItemKind;
  initial?: InitialItem;
  mode?: "page" | "sheet";
  onSaved?: () => void;
  onRemove?: () => void;
  footer?: ReactNode;
}) {
  const t = useTranslations("lists");
  const locale = useLocale();
  const formatter = useFormatter();
  const sheet = mode === "sheet";
  const [state, dispatch, pending] = useActionState<FormState, FormData>(
    (previous, form) => runListAction(() => saveItem(ownerId, initial?.id ?? null, kind, sheet, previous, form)), {},
  );
  const [title, setTitle] = useState(initial?.title ?? "");
  const [price, setPrice] = useState(initial?.price ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [starred, setStarred] = useState(initial?.starred ?? false);
  const [link, setLink] = useState(initial?.url ?? "");
  const [upload, setUpload] = useState<{file: File; url: string} | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [photoError, setPhotoError] = useState<Feedback>();
  const [preview, setPreview] = useState<PreviewState>({});
  const [loading, setLoading] = useState(false);
  const [priceEdited, setPriceEdited] = useState(false);
  const requestId = useRef(0);
  const previewRequest = useRef<AbortController | null>(null);
  const requested = useRef(initial?.url ?? "");
  const touchedTitle = useRef(Boolean(initial?.title));
  const touchedPrice = useRef(Boolean(initial));
  const photoInput = useRef<HTMLInputElement>(null);
  const savedOnce = useRef(false);
  const ids = useId();

  useEffect(() => () => {
    if (upload) URL.revokeObjectURL(upload.url);
  }, [upload]);

  useEffect(() => {
    if (state.status !== "saved" || savedOnce.current) return;
    savedOnce.current = true;
    haptic("success");
    onSaved?.();
  }, [state, onSaved]);

  async function loadPreview(input: string) {
    if (!input.trim() || requested.current === input) return;
    requested.current = input;
    const id = ++requestId.current;
    setLoading(true);
    previewRequest.current?.abort();
    const request = previewRequest.current = new AbortController();
    let response: PreviewState;
    try {
      const reply = await fetch(`/${locale}/lists/${ownerId}/link-preview`, {
        method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({link: input}), signal: request.signal,
      });
      response = await reply.json() as PreviewState;
    } catch {
      response = request.signal.aborted ? {} : {error: "could-not-save"};
    }
    if (id !== requestId.current) return;
    setPreview(response);
    setLoading(false);
    if (response.card) {
      haptic("light");
      if (!touchedTitle.current) setTitle(response.card.title ?? "");
      if (!touchedPrice.current) setPrice(response.card.price ?? "");
    }
  }

  function changeLink(input: string) {
    setLink(input);
    requestId.current++;
    previewRequest.current?.abort();
    setPreview({});
    setLoading(false);
    if (!touchedTitle.current) setTitle("");
    if (!touchedPrice.current) setPrice("");
    requested.current = input === initial?.url ? input : "";
  }

  const previewCard = preview.card;
  const displayPhoto = upload?.url ?? previewCard?.photo ?? initial?.photo;
  const store = previewCard?.store ?? initial?.store ?? null;
  function submit(form: FormData) {
    savedOnce.current = false;
    // A preview still loading must not hold up the save: the list shows it at once and reads the page later.
    if (loading) {
      requestId.current++;
      previewRequest.current?.abort();
      setLoading(false);
    }
    if (upload) form.set("photo", upload.file);
    dispatch(form);
  }

  const photoRow = kind !== "note" && (
    <div className="flex flex-col gap-2">
      {/* at the largest text size the photo button drops under the picture */}
      <div className="flex items-center gap-4 max-[299px]:flex-col max-[299px]:items-start max-[299px]:gap-3">
        {displayPhoto ? <ItemPicture src={displayPhoto} /> : <NoPicture camera={false} />}
        <div className="flex min-w-0 flex-1 flex-col items-start gap-1.5">
          {store && <p className="text-body font-semibold text-[var(--fg-muted)]">{t("fromStore", {store})}</p>}
          <label className={cn("fge-press relative inline-flex min-h-12 max-w-full cursor-pointer items-center gap-2.5 rounded-pill bg-[var(--track,var(--card-track))] px-[18px] py-2 text-body-strong",
            "has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-3 has-[:focus-visible]:outline-[var(--focus,var(--color-ink))]",
            preparing && "opacity-60")}>
            <Icon name="camera" size={22} strokeWidth={2.3} />
            <span>{displayPhoto ? t("replacePhoto") : t("photo")}</span>
            <input className="absolute inset-0 cursor-pointer rounded-pill opacity-0" name="photo" type="file" accept="image/*" ref={photoInput} disabled={preparing}
              onChange={async (event) => {
                const input = event.currentTarget;
                const file = input.files?.[0];
                setUpload(null);
                setPhotoError(undefined);
                if (!file) return;
                setPreparing(true);
                try {
                  const prepared = await preparePhoto(file);
                  setUpload({file: prepared, url: URL.createObjectURL(prepared)});
                  haptic("light");
                } catch {
                  setPhotoError("invalid-photo");
                  input.value = "";
                } finally {
                  setPreparing(false);
                }
              }}
            />
          </label>
        </div>
      </div>
      {preparing && <p role="status" className="text-body text-[var(--fg-muted)]">{t("preparingPhoto")}</p>}
      <FormFeedback error={photoError} />
    </div>
  );

  return (
    <form action={submit} onReset={(event) => event.preventDefault()} className="flex flex-col gap-4" data-item-form={mode}>
      {kind === "link" && (
        <>
          <TextArea id={`${ids}-link`} label={t("url")} hint={t("linkHint")} name="link" rows={2} value={link} required maxLength={3000}
            onChange={(event) => changeLink(event.currentTarget.value)}
            onPaste={(event) => {
              const input = event.clipboardData.getData("text");
              if (!input) return;
              event.preventDefault();
              const pasted = input.slice(0, 3000);
              changeLink(pasted);
              void loadPreview(pasted);
            }}
          />
          {!previewCard && (
            <TextButton className="-mt-2 -ml-3 self-start" disabled={loading || !link.trim()} onClick={() => {
              requested.current = "";
              void loadPreview(link);
            }}>{t("preview")}</TextButton>
          )}
          {loading && (
            <p role="status" className="flex items-center gap-2.5 text-body font-semibold text-[var(--fg-muted)]">
              <Icon name="link" size={20} />{t("previewLoading")}
            </p>
          )}
          <FormFeedback error={preview.error} />
          {previewCard && (
            <section className="flex flex-col gap-1 rounded-[24px] bg-[var(--track,var(--card-track))] px-4 py-3.5" aria-label={t("previewTitle")}>
              <p className="flex items-center gap-2 text-body font-semibold text-[var(--fg-muted)]">
                <Icon name="link" size={20} /><span className="min-w-0 break-all">{previewCard.store}</span>
              </p>
              {previewCard.title && <p className="break-words text-item-title">{previewCard.title}</p>}
              {previewCard.price !== null && (
                <p className="text-body font-bold">{formatter.number(Number(previewCard.price), {style: "currency", currency: "USD"})}</p>
              )}
              {!displayPhoto && <p className="text-body">{t("noPicture", {store: previewCard.store})}</p>}
              <a href={previewCard.url} className="inline-flex min-h-12 items-center self-start text-body font-semibold underline underline-offset-4"
                target="_blank" rel="noreferrer">{t("openProduct")}</a>
            </section>
          )}
          {previewCard?.ticket && <input type="hidden" name="draft" value={previewCard.ticket} />}
          <input type="hidden" name="priceEdited" value={String(priceEdited)} />
        </>
      )}
      {photoRow}
      <TextField id={`${ids}-title`} label={t("title")} name="title" value={title} required={kind !== "link" || Boolean(initial)}
        maxLength={TITLE_LIMIT * 2} autoComplete="off" onChange={(event) => {
          touchedTitle.current = true;
          setTitle(limit(event.currentTarget.value, TITLE_LIMIT));
        }} />
      <div className="grid grid-cols-2 gap-3 max-[299px]:grid-cols-1">
        <TextField id={`${ids}-price`} label={t("price")} name="price" inputMode="decimal" value={price} maxLength={11}
          placeholder="$" onChange={(event) => {
            touchedPrice.current = true;
            setPriceEdited(true);
            setPrice(event.currentTarget.value);
          }} />
        <div className="flex min-w-0 flex-col gap-1.5">
          <span aria-hidden="true" className="text-body font-bold text-[var(--fg-muted,var(--color-muted-ink))]">{t("star")}</span>
          <label className={cn("fge-press relative flex h-14 cursor-pointer items-center justify-center gap-2.5 rounded-pill px-4 text-body-strong",
            "has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-3 has-[:focus-visible]:outline-[var(--focus,var(--color-ink))]",
            starred ? "bg-ink text-snow-white" : "bg-[var(--track,var(--card-track))] text-ink")}>
            <input className="absolute inset-0 cursor-pointer rounded-pill opacity-0" type="checkbox" name="starred" checked={starred} aria-label={t("star")}
              onChange={(event) => {
                setStarred(event.currentTarget.checked);
                haptic("tick");
              }} />
            <Icon name="heart" size={22} strokeWidth={2.2} style={starred ? {fill: "currentColor"} : undefined} />
            <span aria-hidden="true">{starred ? t("starOn") : t("starOff")}</span>
          </label>
        </div>
      </div>
      <TextArea id={`${ids}-note`} label={t("note")} name="note" value={note} maxLength={NOTE_LIMIT * 2} rows={2}
        onChange={(event) => setNote(limit(event.currentTarget.value, NOTE_LIMIT))} />
      {initial && (
        <p className="flex items-start gap-3 rounded-[24px] bg-[var(--track,var(--card-track))] px-4 py-3.5 text-body max-[299px]:flex-col max-[299px]:gap-2 max-[299px]:px-3.5">
          <Icon name="bell" size={22} strokeWidth={2.3} className="mt-0.5 text-pine" />
          <span>{t("editNotice")}</span>
        </p>
      )}
      <Button type="submit" variant="card" disabled={preparing || pending || (kind === "photo" && !initial && !upload)}>
        {pending ? t("saving") : t("saveItem")}
      </Button>
      <FormFeedback error={state.error} />
      {footer}
      {onRemove && (
        <TextButton className="self-center text-danger" onClick={onRemove}>{t("deleteItem")}</TextButton>
      )}
    </form>
  );
}

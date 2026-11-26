"use client";

import Image from "next/image";
import {useActionState, useEffect, useRef, useState} from "react";
import {useFormatter, useTranslations} from "next-intl";
import {NOTE_LIMIT, TITLE_LIMIT, type ItemKind} from "@/server/lists/validation";
import type {Feedback, PreviewState} from "./action-types";
import {previewItemLink, saveItem} from "./actions";
import {FormFeedback} from "./controls";
import {StoreIcon} from "./store-icon";
import {buttonClass, inputClass, linkClass, panelClass} from "./styles";

type InitialItem = {
  id: string;
  title: string;
  note: string | null;
  price: string | null;
  starred: boolean;
  url: string | null;
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

export function ItemForm({ownerId, kind, initial}: {ownerId: string; kind: ItemKind; initial?: InitialItem}) {
  const t = useTranslations("lists");
  const formatter = useFormatter();
  const [state, dispatch, pending] = useActionState(saveItem.bind(null, ownerId, initial?.id ?? null, kind), {});
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
  const requested = useRef(initial?.url ?? "");
  const touchedTitle = useRef(Boolean(initial?.title));
  const touchedPrice = useRef(Boolean(initial));
  const photoInput = useRef<HTMLInputElement>(null);

  useEffect(() => () => {
    if (upload) URL.revokeObjectURL(upload.url);
  }, [upload]);

  async function loadPreview(input: string) {
    if (!input.trim() || requested.current === input) return;
    requested.current = input;
    const id = ++requestId.current;
    setLoading(true);
    let response: PreviewState;
    try {
      response = await previewItemLink(ownerId, input);
    } catch {
      response = {error: "could-not-save"};
    }
    if (id !== requestId.current) return;
    setPreview(response);
    setLoading(false);
    if (response.card) {
      if (!touchedTitle.current) setTitle(response.card.title ?? "");
      if (!touchedPrice.current) setPrice(response.card.price ?? "");
    }
  }

  function changeLink(input: string) {
    setLink(input);
    requestId.current++;
    setPreview({});
    setLoading(false);
    if (!touchedTitle.current) setTitle("");
    if (!touchedPrice.current) setPrice("");
    requested.current = input === initial?.url ? input : "";
  }

  const previewCard = preview.card;
  const displayPhoto = upload?.url ?? previewCard?.photo ?? initial?.photo;
  const picture = displayPhoto && <Image src={displayPhoto} unoptimized alt="" width={400} height={300}
    className="h-auto max-h-64 w-auto max-w-full rounded object-contain" />;
  function submit(form: FormData) {
    if (upload) form.set("photo", upload.file);
    dispatch(form);
  }

  return (
    <form action={submit} className="space-y-4">
      {kind === "link" && (
        <>
          <div>
            <label htmlFor="item-link">{t("url")}</label>
            <textarea
              id="item-link" className={inputClass} name="link" rows={2} value={link} required maxLength={3000}
              aria-describedby="link-hint"
              onChange={(event) => changeLink(event.currentTarget.value)}
              onBlur={() => void loadPreview(link)}
              onPaste={(event) => {
                const input = event.clipboardData.getData("text");
                if (!input) return;
                event.preventDefault();
                const pasted = input.slice(0, 3000);
                changeLink(pasted);
                void loadPreview(pasted);
              }}
            />
          </div>
          <p id="link-hint">{t("linkHint")}</p>
          <button type="button" className={linkClass} disabled={loading || !link.trim()} onClick={() => {
            requested.current = "";
            void loadPreview(link);
          }}>{t("preview")}</button>
          {loading && <p role="status">{t("previewLoading")}</p>}
          <FormFeedback error={preview.error} />
          {previewCard && (
            <section className={panelClass} aria-label={t("previewTitle")}>
              <div className="flex items-center gap-2 break-all">
                <StoreIcon icon={previewCard.icon} src={previewCard.favicon} /> {previewCard.store}
              </div>
              {picture}
              {previewCard.title && <p className="break-words font-semibold">{previewCard.title}</p>}
              {previewCard.price !== null && <p>{formatter.number(Number(previewCard.price), {style: "currency", currency: "USD"})}</p>}
              {!displayPhoto && <button type="button" className={linkClass} onClick={() => photoInput.current?.click()}>{t("photoFallback")}</button>}
              <a href={previewCard.url} className={linkClass} target="_blank" rel="noreferrer">{t("openProduct")}</a>
            </section>
          )}
          {previewCard?.ticket && <input type="hidden" name="draft" value={previewCard.ticket} />}
          <input type="hidden" name="priceEdited" value={String(priceEdited)} />
        </>
      )}
      {kind !== "note" && (
        <>
          {!previewCard && picture}
          <label className="block">
            {displayPhoto ? t("replacePhoto") : t("photo")}
            <input className={inputClass} name="photo" type="file" accept="image/*" ref={photoInput} disabled={preparing}
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
                } catch {
                  setPhotoError("invalid-photo");
                  input.value = "";
                } finally {
                  setPreparing(false);
                }
              }}
            />
          </label>
          {preparing && <p role="status">{t("preparingPhoto")}</p>}
          <FormFeedback error={photoError} />
        </>
      )}
      <label className="block">
        {t("title")}
        <input className={inputClass} name="title" value={title} required={kind !== "link" || Boolean(initial)}
          maxLength={TITLE_LIMIT * 2} onChange={(event) => {
            touchedTitle.current = true;
            setTitle(limit(event.currentTarget.value, TITLE_LIMIT));
          }} />
      </label>
      <div>
        <label htmlFor="item-note">{t("note")}</label>
        <textarea id="item-note" className={inputClass} name="note" value={note} maxLength={NOTE_LIMIT * 2}
          aria-describedby="note-hint" rows={3} onChange={(event) => setNote(limit(event.currentTarget.value, NOTE_LIMIT))} />
      </div>
      <p id="note-hint">{t("noteHelp")}</p>
      <label className="block">
        {t("price")}
        <input className={inputClass} name="price" inputMode="decimal" value={price} maxLength={11}
          onChange={(event) => {
            touchedPrice.current = true;
            setPriceEdited(true);
            setPrice(event.currentTarget.value);
          }} />
      </label>
      <label className="flex min-h-12 cursor-pointer items-center gap-3">
        <input className="size-6 accent-foreground" type="checkbox" name="starred" checked={starred}
          onChange={(event) => setStarred(event.currentTarget.checked)} />
        {t("star")}
      </label>
      <button className={buttonClass} disabled={preparing || pending || (kind === "photo" && !initial && !upload)}>
        {pending ? t("saving") : t("saveItem")}
      </button>
      <FormFeedback error={state.error} />
    </form>
  );
}

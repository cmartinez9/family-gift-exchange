"use client";

import {useActionState, useEffect, useRef, useState, useTransition, type ReactNode} from "react";
import {useLocale, useTranslations} from "next-intl";
import {unstable_rethrow} from "next/navigation";
import {useRouter} from "@/i18n/navigation";
import {ErrorBlock} from "@/components/ui/blocks";
import {Button, IconButton, TextButton, TextLink} from "@/components/ui/button";
import {Card, Chevron, IconDisc, Rows, stackRow, stackWords} from "@/components/ui/card";
import {Chip, ChoiceChips} from "@/components/ui/chip";
import {cn} from "@/components/ui/cn";
import {Heart, Icon} from "@/components/ui/icon";
import {Switch, TextField, Tick} from "@/components/ui/inputs";
import {ItemCard, ItemPicture, LoadingPicture, NoPicture} from "@/components/ui/item-card";
import {haptic} from "@/components/ui/motion/haptic";
import {PageTitle} from "@/components/ui/page-header";
import {Screen} from "@/components/ui/screen";
import {Sheet} from "@/components/ui/sheet";
import {toast} from "@/components/ui/toast";
import {parseLink} from "@/server/lists/link-preview/url";
import {sizePresets} from "@/server/lists/validation";
import {saveProfileField} from "../lists/actions";
import type {FormState, PreviewCard, PreviewState} from "../lists/action-types";
import {shoeOptions} from "../lists/[personId]/profile/profile-form";
import {preparePhoto} from "../lists/item-form";
import {WelcomeSteps} from "../sign-in/get-in";
import {addFirstThing, type FirstThingState} from "./actions";
import {shoeLabel} from "./shoe-label";

/** The design's six chips; the stored value for 2XL is the preset's XXL. */
const LETTER_SIZES = [["XS", "XS"], ["S", "S"], ["M", "M"], ["L", "L"], ["XL", "XL"], ["XXL", "2XL"]] as const;
const SHOE_SYSTEMS = sizePresets.shoeSystem;
const ADULT_SHOES = sizePresets.shoes.filter((value) => !value.endsWith("Y"));
type ShoeSystem = typeof SHOE_SYSTEMS[number];

/** A heading row inside the sizes card: the group's name, and an optional link on the right. */
function GroupHead({title, id, right}: {title: string; id: string; right?: ReactNode}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
      <p id={id} className="text-body font-extrabold">{title}</p>
      {right}
    </div>
  );
}

/**
 * Your sizes (2.5, 2.6): tops and bottoms as chips, shoes on a stepper, or "No clothes, please".
 * Each choice saves as it is made; skipping is always fine.
 */
export function SizesStep({ownerId, initial, profileHref, personOpened = false, replace = false, borrowedSessionId}: {
  ownerId: string; initial: {noClothes: boolean; sizes: Record<string, string>}; profileHref: string;
  personOpened?: boolean;
  /** On a borrowed phone each step replaces the last, so the history keeps nothing of the relative's. */
  replace?: boolean;
  borrowedSessionId?: string;
}) {
  const t = useTranslations("getIn.sizes");
  const ui = useTranslations("ui");
  const router = useRouter();
  const [noClothes, setNoClothes] = useState(initial.noClothes);
  const [sizes, setSizes] = useState(initial.sizes);
  const [systemOpen, setSystemOpen] = useState(false);
  const [changingSystem, startSystemChange] = useTransition();
  const [, start] = useTransition();
  const saved = useRef<Record<string, string>>({...initial.sizes, noClothes: String(initial.noClothes)});
  const latest = useRef(new Map<string, number>());
  const request = useRef(0);
  const queue = useRef(Promise.resolve());
  const failed = t("failed");
  const nextHref = borrowedSessionId ? `/welcome/list?borrowed=${borrowedSessionId}` : "/welcome/list";

  function show(field: string, value: string, group: "size" | "noClothes") {
    if (group === "noClothes") setNoClothes(value === "true");
    else setSizes((current) => ({...current, [field]: value}));
  }
  async function persist(field: string, value: string, group: "size" | "noClothes" = "size") {
    let result: FormState;
    try {
      result = await saveProfileField(ownerId, field, value, group);
    } catch (error) {
      unstable_rethrow(error);
      result = {error: "could-not-save"};
    }
    if (result.error) {
      toast({message: failed, icon: "alert"});
      return false;
    }
    saved.current[field] = value;
    return true;
  }
  function save(field: string, value: string, group: "size" | "noClothes" = "size") {
    const version = ++request.current;
    latest.current.set(field, version);
    show(field, value, group);
    start(async () => {
      queue.current = queue.current.then(async () => {
        if (!await persist(field, value, group) && latest.current.get(field) === version) {
          show(field, saved.current[field] ?? "", group);
        }
      });
      await queue.current;
    });
  }
  function step(direction: 1 | -1) {
    const options = shoeOptions[system ?? ""] ?? ADULT_SHOES;
    const index = options.indexOf(sizes.shoes ?? "");
    const first = system === "eu" ? "38" : system === "us-kids" ? "1C" : "7.5";
    const next = index < 0 ? options.indexOf(first) : Math.max(0, Math.min(options.length - 1, index + direction));
    haptic("tick");
    save("shoes", options[next]);
  }
  const system = sizes.shoeSystem as ShoeSystem | undefined;
  const shoe = sizes.shoes;

  function changeSystem(value: string) {
    setSystemOpen(false);
    if (value === system) return;
    startSystemChange(async () => {
      queue.current = queue.current.then(async () => {
        if (!await persist("shoes", "")) return;
        setSizes((current) => ({...current, shoes: ""}));
        if (await persist("shoeSystem", value)) setSizes((current) => ({...current, shoeSystem: value}));
      });
      await queue.current;
    });
  }

  return (
    <Screen actions={<>
      <Button icon="arrow" onClick={() => (replace ? router.replace(nextHref) : router.push(nextHref))}>{t("next")}</Button>
      <TextLink href={nextHref} replace={replace} className="self-center">{t("skip")}</TextLink>
    </>}>
      <WelcomeSteps step={3} waitingStep={personOpened ? undefined : 2} />
      <PageTitle title={t("title")} lead={t("lead")} />
      <div className="flex flex-col gap-3 px-edge pt-4">
        <Card className="rounded-item px-[18px] py-3.5">
          {/* at the largest text size the switch moves under its words */}
          <div className="flex items-center gap-3 max-[299px]:flex-col max-[299px]:items-start">
            <div className="flex min-w-0 flex-1 flex-col">
              <p className="text-card-title">{t("noClothes")}</p>
              <p className="text-body text-muted-ink">{t("noClothesSub")}</p>
            </div>
            <Switch checked={noClothes} label={t("noClothes")} onCheckedChange={(on) => {
              haptic("light");
              save("noClothes", String(on), "noClothes");
            }} />
          </div>
        </Card>
        {noClothes ? (
          <Card className="fge-drop rounded-item px-5 py-[18px]" role="status">
            <div className="flex items-center gap-3">
              <Tick done />
              <p className="text-body">{t("noClothesDone")}</p>
            </div>
          </Card>
        ) : (
          <Card className="fge-arrive-one flex flex-col gap-4 rounded-item p-[18px]">
            <div className="flex flex-col gap-2">
              <GroupHead id="tops" title={t("tops")} />
              <ChoiceChips round legend={t("tops")} legendClassName="sr-only" name="tops" value={sizes.tops ?? null}
                options={LETTER_SIZES.map(([value, label]) => ({value, label}))} onChange={(value) => save("tops", value)} />
            </div>
            <div className="flex flex-col gap-2">
              <GroupHead id="bottoms" title={t("bottoms")}
                right={<TextLink href={profileHref} replace={replace} transition={replace ? undefined : "push"} className="min-h-12 px-0 text-ink">{t("waistLength")}</TextLink>} />
              <ChoiceChips round legend={t("bottoms")} legendClassName="sr-only" name="bottoms" value={sizes.bottoms ?? null}
                options={LETTER_SIZES.map(([value, label]) => ({value, label}))} onChange={(value) => save("bottoms", value)} />
            </div>
            <div className="flex flex-col gap-2" role="group" aria-labelledby="shoes">
              <GroupHead id="shoes" title={t("shoes")}
                right={<TextButton className="px-0 text-ink" disabled={changingSystem} onClick={() => setSystemOpen(true)}>
                  {system ? t(`system.${system}`) : t("systemNone")}
                </TextButton>} />
              {system === "other" ? (
                <TextField label={t("shoes")} value={shoe ?? ""} maxLength={40} surface="white" disabled={changingSystem}
                  onChange={(event) => {
                    latest.current.set("shoes", ++request.current);
                    show("shoes", event.target.value, "size");
                  }} onBlur={(event) => save("shoes", event.currentTarget.value)} />
              ) : <div className="flex items-center gap-2.5 max-[299px]:flex-wrap max-[299px]:justify-between">
                <IconButton icon="minus" label={t("smaller")} disabled={changingSystem} onClick={() => step(-1)} />
                {/* at the largest text size the size has the whole width, over smaller and bigger */}
                <p aria-live="polite" className={cn("flex h-12 flex-1 items-center justify-center rounded-pill text-card-title max-[299px]:order-first max-[299px]:basis-full",
                  shoe ? "bg-ink text-snow-white" : "bg-[var(--track)] text-muted-ink")}>
                  {shoe ? shoeLabel(shoe) : t("pickOne")}
                </p>
                <IconButton icon="plus" label={t("bigger")} disabled={changingSystem} onClick={() => step(1)} />
              </div>}
            </div>
          </Card>
        )}
        {!noClothes && <TextLink href={profileHref} replace={replace} transition={replace ? undefined : "push"} className="self-center text-center">{t("more")}</TextLink>}
      </div>
      <Sheet open={systemOpen} onClose={() => setSystemOpen(false)} title={t("systemTitle")} closeLabel={ui("close")}>
        <ChoiceChips legend={t("systemTitle")} legendClassName="sr-only" name="shoeSystem" value={system ?? null}
          options={SHOE_SYSTEMS.map((value) => ({value, label: t(`system.${value}`)}))}
          onChange={changeSystem} />
      </Sheet>
    </Screen>
  );
}

function pastedLink(value: string) {
  try {
    return parseLink(value);
  } catch {
    return null;
  }
}

type Mode = "words" | "paste" | "photo";

/** Add one thing you'd like (2.7 to 2.9): a few words, a pasted link, or a photo. */
export function AddStep({ownerId, personOpened = false, replace = false, borrowedSessionId}: {
  ownerId: string; personOpened?: boolean; replace?: boolean; borrowedSessionId?: string;
}) {
  const t = useTranslations("getIn.add");
  const lists = useTranslations("lists");
  const back = useTranslations("getIn.hello");
  const doneHref = borrowedSessionId ? `/welcome/done?borrowed=${borrowedSessionId}` : "/welcome/done";
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("words");
  const [title, setTitle] = useState("");
  const [state, submit, pending] = useActionState(async (previous: FirstThingState, form: FormData): Promise<FirstThingState> => {
    try {
      return await addFirstThing(ownerId, previous, form);
    } catch (error) {
      unstable_rethrow(error);
      return {error: "could-not-save"};
    }
  }, {});
  const camera = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<{file: File; url: string} | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [photoError, setPhotoError] = useState(false);

  useEffect(() => () => {
    if (photo) URL.revokeObjectURL(photo.url);
  }, [photo]);

  useEffect(() => {
    if (!state.added) return;
    haptic("success");
    toast(state.pictureComing ? lists("pictureComingSub") : t("added"));
    if (replace) router.replace(doneHref);
    else router.push(doneHref);
  }, [state, router, t, lists, replace, doneHref]);

  function save(form: FormData) {
    if (form.get("kind") === "photo") {
      if (preparing || !photo) return;
      form.set("photo", photo.file);
    }
    submit(form);
  }

  const error = (state.error || photoError) && <ErrorBlock title={t("failed")}>{t("failedSub")}</ErrorBlock>;
  const cameraInput = (
    <input ref={camera} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1}
      disabled={preparing || pending} aria-hidden="true" onChange={async (event) => {
        const input = event.currentTarget;
        const file = input.files?.[0];
        if (!file) return;
        input.value = "";
        setPhoto(null);
        setPhotoError(false);
        setPreparing(true);
        setMode("photo");
        try {
          const prepared = await preparePhoto(file);
          setPhoto({file: prepared, url: URL.createObjectURL(prepared)});
        } catch {
          setPhotoError(true);
        } finally {
          setPreparing(false);
        }
      }} />
  );

  if (mode === "paste") {
    return <PasteLink ownerId={ownerId} personOpened={personOpened} submit={submit} pending={pending} error={error}
      onBack={() => setMode("words")} backLabel={back("helperBack")} />;
  }

  return (
    <form action={save} className="contents">
      <Screen actions={mode === "photo"
        ? <>
          <Button type="submit" icon="plus" disabled={pending || preparing || !photo}>{t("add")}</Button>
          <TextButton className="self-center" disabled={preparing || pending} onClick={() => setMode("words")}>{back("helperBack")}</TextButton>
        </>
        : <TextLink href={doneHref} replace={replace} className="self-center">{t("later")}</TextLink>}>
        <WelcomeSteps step={4} waitingStep={personOpened ? undefined : 2} />
        <PageTitle title={t("title")} lead={t("lead")} />
        {cameraInput}
        {mode === "photo" ? (
          <div className="flex flex-col gap-3 px-edge pt-5">
            <input type="hidden" name="kind" value="photo" />
            <Card className="flex flex-col gap-3 rounded-item p-4">
              <div className="flex items-center gap-3.5">
                {photo && <ItemPicture src={photo.url} alt={t("photoAlt")} size={80} />}
                <TextButton className="px-0 text-ink" disabled={preparing || pending} onClick={() => camera.current?.click()}>{t("photoChange")}</TextButton>
              </div>
              {preparing && <p role="status">{lists("preparingPhoto")}</p>}
              <TextField label={t("photoTitle")} name="title" required maxLength={200} placeholder={t("photoPlaceholder")} surface="white"
                value={title} onChange={(event) => setTitle(event.target.value)} />
            </Card>
            {error}
          </div>
        ) : (
          <div className="flex flex-col gap-3 px-edge pt-5">
            <input type="hidden" name="kind" value="note" />
            <Card className="flex flex-col gap-3 rounded-item p-[18px]">
              <TextField label={t("what")} name="title" required maxLength={200} placeholder={t("placeholder")} surface="white"
                value={title} onChange={(event) => setTitle(event.target.value)}
                className="[&_label]:font-extrabold [&_label]:text-ink" />
              <Button type="submit" variant="card" icon="plus" disabled={pending}>{t("add")}</Button>
            </Card>
            {error}
            <Card flush className="rounded-item px-[18px] py-1">
              <Rows>
                <button type="button" className={cn("fge-press flex min-h-16 w-full cursor-pointer items-center gap-3.5 text-left max-[299px]:py-2", stackRow)}
                  onClick={() => setMode("paste")}>
                  <IconDisc icon="link" />
                  <span className={cn("flex-1 text-row-title", stackWords)}>{t("paste")}</span>
                  <Chevron />
                </button>
                <button type="button" className={cn("fge-press flex min-h-16 w-full cursor-pointer items-center gap-3.5 text-left max-[299px]:py-2", stackRow)}
                  onClick={() => camera.current?.click()}>
                  <IconDisc icon="camera" />
                  <span className={cn("flex-1 text-row-title", stackWords)}>{t("photo")}</span>
                  <Chevron />
                </button>
              </Rows>
            </Card>
          </div>
        )}
      </Screen>
    </form>
  );
}

/** Paste a link (2.8, 2.9): the preview loads on its own, then "Really want this" and a note. */
function PasteLink({ownerId, personOpened, submit, pending, error, onBack, backLabel}: {
  ownerId: string; personOpened: boolean; submit: (data: FormData) => void; pending: boolean;
  error: ReactNode; onBack: () => void; backLabel: string;
}) {
  const t = useTranslations("getIn.paste");
  const add = useTranslations("getIn.add");
  const locale = useLocale();
  const [link, setLink] = useState("");
  const [card, setCard] = useState<PreviewCard | null>(null);
  const [failed, setFailed] = useState(false);
  const [want, setWant] = useState(false);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const version = useRef(0);
  const previewRequest = useRef<AbortController | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const parsed = pastedLink(link);
  const name = parsed?.url.hostname.replace(/^www\./, "").split(".")[0] ?? "";
  const store = card?.store || (name ? name[0].toUpperCase() + name.slice(1) : "");

  useEffect(() => {
    field.current?.focus();
  }, []);

  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => {
    window.clearTimeout(timer.current);
    previewRequest.current?.abort();
    version.current++;
  }, []);

  /** Each change waits a beat, then asks the store for its preview; only the latest answer counts. */
  function change(value: string) {
    setLink(value);
    window.clearTimeout(timer.current);
    previewRequest.current?.abort();
    const request = ++version.current;
    const typed = value.trim();
    setCard(null);
    setFailed(false);
    if (!pastedLink(typed)) {
      setLoading(false);
      return;
    }
    setLoading(true);
    timer.current = window.setTimeout(async () => {
      const controller = previewRequest.current = new AbortController();
      let result: PreviewState;
      try {
        const response = await fetch(`/${locale}/lists/${ownerId}/link-preview`, {
          method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({link: typed}), signal: controller.signal,
        });
        result = await response.json() as PreviewState;
      } catch {
        result = {};
      }
      if (request !== version.current) return;
      setLoading(false);
      if (result.card) {
        haptic("light");
        setCard(result.card);
      } else {
        setFailed(true);
      }
    }, 500);
  }

  function save(data: FormData) {
    window.clearTimeout(timer.current);
    previewRequest.current?.abort();
    version.current++;
    setLoading(false);
    data.set("note", note);
    submit(data);
  }

  const ready = Boolean(parsed);
  return (
    <form action={save} className="contents">
      <Screen actions={<>
        <Button type="submit" icon={ready ? "plus" : undefined} disabled={!ready || pending}>
          {ready ? add("add") : link.trim() ? t("waiting", {store: store || "…"}) : t("first")}
        </Button>
        <TextButton className="self-center" onClick={onBack}>{backLabel}</TextButton>
      </>}>
        <WelcomeSteps step={4} waitingStep={personOpened ? undefined : 2} />
        <PageTitle title={t("title")} />
        <input type="hidden" name="kind" value="link" />
        {card?.ticket && <input type="hidden" name="draft" value={card.ticket} />}
        {want && <input type="hidden" name="starred" value="on" />}
        <div className="flex flex-col gap-3 px-edge pt-4">
          <div className="flex h-14 items-center gap-2.5 rounded-pill bg-snow-white pr-1 pl-[18px] text-ink">
            <Icon name="link" size={22} className="text-muted-ink" />
            <label htmlFor="paste-link" className="sr-only">{t("field")}</label>
            <textarea ref={field} id="paste-link" name="link" rows={1} inputMode="url" autoCapitalize="none" autoComplete="off"
              spellCheck={false} maxLength={3000} value={link} placeholder={t("placeholder")}
              className="min-w-0 flex-1 resize-none bg-transparent text-body font-semibold outline-none placeholder:font-normal placeholder:text-muted-ink"
              onChange={(event) => change(event.target.value)} />
            {link && <IconButton icon="close" label={t("clear")} className="bg-[#F3EEEC]" iconSize={20} onClick={() => {
              change("");
              field.current?.focus();
            }} />}
          </div>
          {loading && (
            <Card size="item" aria-busy="true" className="fge-drop">
              <div className={cn("flex items-center gap-3.5", stackRow)}>
                <LoadingPicture size={80} />
                <div role="status" className={cn("flex min-w-0 flex-1 flex-col gap-0.5", stackWords)}>
                  <p className="text-item-title">{store ? t("loading", {store}) : t("wait")}</p>
                  <p className="text-body text-muted-ink">{t("wait")}</p>
                </div>
              </div>
            </Card>
          )}
          {ready && card && (
            <ItemCard className="fge-drop" titleAs="h2"
              picture={card.photo ? <ItemPicture src={card.photo} size={80} /> : <NoPicture size={80} camera={false} />}
              title={card.title || store} store={card.store} price={card.price ? `$${card.price}` : undefined}
              after={<div className="flex flex-col gap-2.5 pt-3.5">
                <Chip pressed={want} onPressedChange={setWant} className="self-start pr-4 pl-3 max-[299px]:h-auto max-[299px]:min-h-12 max-[299px]:max-w-full max-[299px]:rounded-[24px] max-[299px]:px-2 max-[299px]:py-2.5 max-[299px]:whitespace-normal">
                  <span className="flex items-center gap-2 max-[299px]:flex-col max-[299px]:gap-1 max-[299px]:text-center"><Heart on={want} />{t("want")}</span>
                </Chip>
                <TextField label={t("noteField")} name="note" maxLength={500} className="[&_label]:sr-only" placeholder={t("noteField")}
                  value={note} onChange={(event) => setNote(event.target.value)} />
              </div>} />
          )}
          {failed && <ErrorBlock title={t("failed")}>{t("failedSub")}</ErrorBlock>}
          {loading && <p className="text-body font-semibold">{t("note")}</p>}
          {error}
        </div>
      </Screen>
    </form>
  );
}

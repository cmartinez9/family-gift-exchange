"use client";

import {useId, useRef, useState} from "react";
import {useTranslations} from "next-intl";
import {IconButton, TextButton} from "@/components/ui/button";
import {Card} from "@/components/ui/card";
import {ChoiceChips} from "@/components/ui/chip";
import {cn} from "@/components/ui/cn";
import {Icon} from "@/components/ui/icon";
import {Switch, TextArea, TextField} from "@/components/ui/inputs";
import {haptic} from "@/components/ui/motion/haptic";
import {toast} from "@/components/ui/toast";
import {aboutFields, sizePresets, type AboutField, type SizeKind} from "@/server/lists/validation";
import {saveProfileField} from "../../actions";
import type {FormState} from "../../action-types";
import {FormFeedback} from "../../controls";
import {sizeLabel} from "../../tabs";

const LETTERS = ["XS", "S", "M", "L", "XL", "XXL"] as const;
const extraSizes = ["dress", "ring", "hat", "gloves", "other"] as const;

export const shoeOptions: Record<string, readonly string[]> = {
  "us-women": Array.from({length: 19}, (_, index) => String(4 + index / 2)),
  "us-men": Array.from({length: 21}, (_, index) => String(5 + index / 2)),
  eu: Array.from({length: 35}, (_, index) => String(index + 16)),
  "us-kids": ["1C", "2C", "3C", "4C", "5C", "6C", "7C", "8C", "9C", "10C", "11C", "12C", "13C",
    "1Y", "2Y", "3Y", "4Y", "5Y", "6Y", "7Y"],
  uk: Array.from({length: 31}, (_, index) => String(1 + index / 2)),
};
/** Where the stepper starts when there is no size yet. */
const shoeStart: Record<string, string> = {"us-women": "7", "us-men": "9", eu: "39", "us-kids": "1Y", uk: "6"};
type Group = "size" | "about" | "noClothes";

/**
 * Sizes and About me. Every answer saves as you go: a chip or a step at once, a typed answer when you
 * leave the field. Each save says "Saved" in the toast.
 */
export function ProfileForm({ownerId, initialSizes, initialAbout, initialNoClothes}: {
  ownerId: string;
  initialSizes: Record<string, string>;
  initialAbout: Record<AboutField, string | null>;
  initialNoClothes: boolean;
}) {
  const t = useTranslations("lists");
  const ids = useId();
  const [noClothes, setNoClothes] = useState(initialNoClothes);
  const [sizes, setSizes] = useState<Record<string, string>>(initialSizes);
  const [shoeSystem, setShoeSystem] = useState(initialSizes.shoeSystem ?? "");
  const [waist, setWaist] = useState(Boolean(initialSizes.waist || initialSizes.length));
  const [otherTops, setOtherTops] = useState(Boolean(initialSizes.tops && !LETTERS.some((size) => size === initialSizes.tops)));
  const [otherBottoms, setOtherBottoms] = useState(Boolean(initialSizes.bottoms && !LETTERS.some((size) => size === initialSizes.bottoms)));
  const [state, setState] = useState<FormState>({});
  const queue = useRef(Promise.resolve());
  const queuedCount = useRef(0);
  const saved = useRef(new Map<string, string>([
    ...Object.entries(initialSizes).map(([field, value]) => [`size.${field}`, value] as const),
    ...aboutFields.map((field) => [`about.${field}`, initialAbout[field] ?? ""] as const),
    ["noClothes.noClothes", String(initialNoClothes)],
  ]));

  function update(group: Group, field: string, value: string) {
    const cleaned = value.trim();
    const key = `${group}.${field}`;
    if (!queuedCount.current && (saved.current.get(key) ?? "") === cleaned) return;
    queuedCount.current++;
    queue.current = queue.current.then(async () => {
      if ((saved.current.get(key) ?? "") === cleaned) return;
      const result = await saveProfileField(ownerId, field, cleaned, group);
      if (result.status === "saved") {
        saved.current.set(key, cleaned);
        toast(t("saved"));
      }
      setState(result);
    }).catch(() => {
      setState({error: "could-not-save"});
    }).finally(() => {
      queuedCount.current--;
    });
  }

  function setSize(field: SizeKind, value: string, save = true) {
    setSizes((current) => ({...current, [field]: value}));
    if (save) update("size", field, value);
  }

  function sizeField(field: SizeKind, presets: readonly string[] = sizePresets[field]) {
    const listId = `${ids}-preset-${field}`;
    return (
      <div key={field}>
        <TextField id={`${ids}-${field}`} label={t(`size.${field}`)} list={presets.length ? listId : undefined}
          value={sizes[field] ?? ""} maxLength={field === "other" ? 160 : 40} autoComplete="off"
          onChange={(event) => setSize(field, event.currentTarget.value, false)}
          onBlur={(event) => update("size", field, event.currentTarget.value)} />
        {presets.length > 0 && <datalist id={listId}>{presets.map((value) => <option key={value} value={value} />)}</datalist>}
      </div>
    );
  }

  function letters(field: "tops" | "bottoms", other: boolean, setOther: (on: boolean) => void) {
    return (
      <div className="relative flex flex-col gap-1">
        <ChoiceChips legend={t(`size.${field}`)} name={`${ids}-${field}`} value={other ? null : sizes[field] ?? null}
          className="[&>div]:grid [&>div]:grid-cols-6 [&>div]:gap-1 [&_label]:min-w-0 [&_label]:px-0"
          options={LETTERS.map((value) => ({value, label: sizeLabel(value)}))}
          onChange={(value) => {
            setOther(false);
            setSize(field, value);
          }} />
        {/* kids' and other sizes: a typed answer, from the link beside the heading */}
        {other
          ? <div className="pt-2">{sizeField(field)}</div>
          : <TextButton className="absolute -top-3 right-0 -mr-3" onClick={() => setOther(true)}>{t("otherSize")}</TextButton>}
      </div>
    );
  }

  const shoes = shoeOptions[shoeSystem];
  const step = (by: -1 | 1) => {
    if (!shoes) return;
    const current = shoes.indexOf(sizes.shoes ?? "");
    const start = shoes.indexOf(shoeStart[shoeSystem] ?? shoes[0]);
    const next = shoes[Math.min(shoes.length - 1, Math.max(0, current < 0 ? start : current + by))];
    haptic("tick");
    setSize("shoes", next);
  };

  return (
    <div className="flex flex-col gap-card-gap px-edge pt-5 pb-8">
      <FormFeedback error={state.error} className="rounded-card bg-gold px-5 py-4 text-ink" />
      <Card>
        <div className="flex items-center justify-between gap-3">
          <p className="text-row-title">{t("noClothes")}</p>
          <Switch label={t("noClothes")} checked={noClothes} onCheckedChange={(checked) => {
            setNoClothes(checked);
            haptic("tick");
            update("noClothes", "noClothes", String(checked));
          }} />
        </div>
      </Card>
      <section aria-labelledby={`${ids}-sizes`} hidden={noClothes}>
        <Card>
          <h2 id={`${ids}-sizes`} className="sr-only">{t("sizes")}</h2>
          <div className="flex flex-col gap-5">
            {letters("tops", otherTops, setOtherTops)}
            {letters("bottoms", otherBottoms, setOtherBottoms)}
            {waist
              ? <div className="-mt-2 grid grid-cols-2 gap-3">{sizeField("waist")}{sizeField("length")}</div>
              : <TextButton className="-mt-3 -ml-3 self-start" onClick={() => setWaist(true)}>{t("waistAndLength")}</TextButton>}
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-x-3">
                <label htmlFor={`${ids}-shoes`} className="text-body font-extrabold">{t("size.shoes")}</label>
                <label className="relative inline-flex min-h-12 items-center text-body font-semibold underline underline-offset-4">
                  <span className="sr-only">{t("size.shoeSystem")}</span>
                  <select className="absolute inset-0 cursor-pointer opacity-0" value={shoeSystem} aria-label={t("size.shoeSystem")}
                    onChange={(event) => {
                      setShoeSystem(event.currentTarget.value);
                      update("size", "shoeSystem", event.currentTarget.value);
                    }}>
                    <option value="">{t("chooseShoeSystem")}</option>
                    {sizePresets.shoeSystem.map((system) => <option value={system} key={system}>{t(`shoe.${system}`)}</option>)}
                  </select>
                  <span aria-hidden="true" className="flex items-center gap-1">
                    {shoeSystem ? t(`shoe.${shoeSystem as (typeof sizePresets.shoeSystem)[number]}`) : t("chooseShoeSystem")}
                    <Icon name="chevron" size={18} className="rotate-90" />
                  </span>
                </label>
              </div>
              <div className="flex items-center gap-3">
                {shoes && <IconButton icon="minus" label={t("shoeSmaller")} onClick={() => step(-1)} />}
                <input id={`${ids}-shoes`} list={`${ids}-shoe-list`} value={sizes.shoes ? sizeLabel(sizes.shoes) : ""} maxLength={40}
                  inputMode={shoeSystem === "us-kids" || shoeSystem === "other" ? "text" : "decimal"} autoComplete="off"
                  className={cn("h-12 min-w-0 flex-1 rounded-pill border-0 px-4 text-center text-body-strong",
                    "focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-ink",
                    sizes.shoes ? "bg-ink text-snow-white" : "bg-[var(--track)] text-ink")}
                  onChange={(event) => setSize("shoes", event.currentTarget.value.replace("½", ".5"), false)}
                  onBlur={(event) => update("size", "shoes", event.currentTarget.value.replace("½", ".5"))} />
                {shoes && <IconButton icon="plus" label={t("shoeBigger")} onClick={() => step(1)} />}
              </div>
              <datalist id={`${ids}-shoe-list`}>
                {(shoeSystem === "other" ? [] : shoes ?? sizePresets.shoes).map((value) => <option key={value} value={value} />)}
              </datalist>
            </div>
          </div>
        </Card>
        <details className="group pt-card-gap">
          <summary className="fge-press inline-flex min-h-12 cursor-pointer list-none items-center gap-2 text-body font-semibold text-snow-white underline underline-offset-4">
            {t("moreSizes")}
            <Icon name="chevron" size={18} className="rotate-90 transition-transform group-open:-rotate-90" />
          </summary>
          <Card className="mt-2">
            <div className="flex flex-col gap-4">{extraSizes.map((field) => sizeField(field))}</div>
          </Card>
        </details>
      </section>
      <section aria-labelledby={`${ids}-about`}>
        <Card>
          <h2 id={`${ids}-about`} className="pb-3 text-section">{t("about")}</h2>
          <div className="flex flex-col gap-3">
            {aboutFields.map((field) => (
              <TextArea key={field} id={`about-${field}`} label={t(`aboutField.${field}`)} rows={2} maxLength={500}
                defaultValue={initialAbout[field] ?? ""} onBlur={(event) => update("about", field, event.currentTarget.value)} />
            ))}
          </div>
        </Card>
      </section>
    </div>
  );
}

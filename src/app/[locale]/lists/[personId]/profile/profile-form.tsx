"use client";

import {useRef, useState} from "react";
import {useTranslations} from "next-intl";
import {aboutFields, sizePresets, type AboutField, type SizeKind} from "@/server/lists/validation";
import {saveProfileField} from "../../actions";
import type {FormState} from "../../action-types";
import {FormFeedback} from "../../controls";
import {inputClass, linkClass, panelClass} from "../../styles";

const standardSizes = ["tops", "bottoms", "waist", "length"] as const;
const extraSizes = ["dress", "ring", "hat", "gloves", "other"] as const;

const shoeOptions: Record<string, readonly string[]> = {
  eu: Array.from({length: 35}, (_, index) => String(index + 16)),
  "us-kids": ["1C", "2C", "3C", "4C", "5C", "6C", "7C", "8C", "9C", "10C", "11C", "12C", "13C",
    "1Y", "2Y", "3Y", "4Y", "5Y", "6Y", "7Y"],
  uk: Array.from({length: 31}, (_, index) => String(1 + index / 2)),
};
type Group = "size" | "about" | "noClothes";

export function ProfileForm({ownerId, initialSizes, initialAbout, initialNoClothes}: {
  ownerId: string;
  initialSizes: Record<string, string>;
  initialAbout: Record<AboutField, string | null>;
  initialNoClothes: boolean;
}) {
  const t = useTranslations("lists");
  const [noClothes, setNoClothes] = useState(initialNoClothes);
  const [shoeSystem, setShoeSystem] = useState(initialSizes.shoeSystem ?? "");
  const [state, setState] = useState<FormState>({});
  const [pending, setPending] = useState(false);
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
    setPending(true);
    queue.current = queue.current.then(async () => {
      if ((saved.current.get(key) ?? "") === cleaned) return;
      const result = await saveProfileField(ownerId, field, cleaned, group);
      if (result.status === "saved") saved.current.set(key, cleaned);
      setState(result);
    }).catch(() => {
      setState({error: "could-not-save"});
    }).finally(() => {
      if (--queuedCount.current === 0) setPending(false);
    });
  }

  function sizeInput(field: SizeKind, presets: readonly string[] = sizePresets[field]) {
    const listId = `preset-${field}`;
    return (
      <div key={field}>
        <label className="block">
          {t(`size.${field}`)}
          <input className={inputClass} list={presets.length ? listId : undefined} defaultValue={initialSizes[field] ?? ""}
            maxLength={field === "other" ? 160 : 40} onBlur={(event) => update("size", field, event.currentTarget.value)} />
        </label>
        {presets.length > 0 && <datalist id={listId}>{presets.map((value) => <option key={value} value={value} />)}</datalist>}
      </div>
    );
  }

  return (
    <>
      <p>{t("saveOnLeave")}</p>
      <p role="status">{pending ? t("saving") : state.status === "saved" ? t("saved") : ""}</p>
      <FormFeedback error={state.error} />
      <section className={panelClass} aria-labelledby="editing-sizes">
        <h2 id="editing-sizes" className="text-xl font-semibold">{t("sizes")}</h2>
        <label className="flex min-h-12 cursor-pointer items-center gap-3">
          <input type="checkbox" className="size-6 accent-foreground" checked={noClothes} onChange={(event) => {
            const checked = event.currentTarget.checked;
            setNoClothes(checked);
            update("noClothes", "noClothes", String(checked));
          }} />
          {t("noClothes")}
        </label>
        <div hidden={noClothes} className="space-y-3">
          {standardSizes.map((field) => sizeInput(field))}
          <label className="block">
            {t("size.shoeSystem")}
            <select className={inputClass} value={shoeSystem} onChange={(event) => setShoeSystem(event.currentTarget.value)}
              onBlur={(event) => update("size", "shoeSystem", event.currentTarget.value)}>
              <option value="">{t("chooseShoeSystem")}</option>
              {sizePresets.shoeSystem.map((system) => <option value={system} key={system}>{t(`shoe.${system}`)}</option>)}
            </select>
          </label>
          {sizeInput("shoes", shoeSystem === "other" ? [] : shoeOptions[shoeSystem] ?? sizePresets.shoes)}
          <details className="space-y-3">
            <summary className={linkClass}>{t("moreSizes")}</summary>
            {extraSizes.map((field) => sizeInput(field))}
          </details>
        </div>
      </section>
      <section className={panelClass} aria-labelledby="editing-about">
        <h2 id="editing-about" className="text-xl font-semibold">{t("about")}</h2>
        {aboutFields.map((field) => (
          <div key={field}>
            <label htmlFor={`about-${field}`}>{t(`aboutField.${field}`)}</label>
            <textarea id={`about-${field}`} className={inputClass} rows={2} maxLength={500} defaultValue={initialAbout[field] ?? ""}
              onBlur={(event) => update("about", field, event.currentTarget.value)} />
          </div>
        ))}
      </section>
    </>
  );
}

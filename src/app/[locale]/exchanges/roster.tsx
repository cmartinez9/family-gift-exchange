import {Avatar} from "@/components/ui/avatar";
import {stackRow, stackWords} from "@/components/ui/card";
import {cn} from "@/components/ui/cn";
import {Icon} from "@/components/ui/icon";

type Person = {id: string; displayName: string; participating: boolean; available: boolean};

/**
 * Who's taking part, as rows you tick: an avatar, the name and an ink tick (neutral means neutral).
 * Real checkboxes underneath, so forms and screen readers work as they always have.
 */
export function RosterFields({people, legend, you, hideLegend = false}: {
  people: readonly Person[]; legend: string; you?: {id: string; label: string}; hideLegend?: boolean;
}) {
  return (
    <fieldset className="flex min-w-0 flex-col">
      <legend className={hideLegend ? "sr-only" : "pb-1 text-body font-bold text-[var(--fg-muted)]"}>{legend}</legend>
      <div className="fge-rows flex flex-col">
        {people.map(({id, displayName, participating, available}) => (
          <label key={id} className={cn("relative flex min-h-16 cursor-pointer items-center gap-3.5 py-2 has-[:disabled]:cursor-default has-[:disabled]:opacity-60", stackRow)}>
            <Avatar name={displayName} size={44} />
            <span className={cn("min-w-0 flex-1 text-row-title break-words", stackWords)}>
              {displayName}{you?.id === id && <span className="font-medium text-[var(--fg-muted)]"> · {you.label}</span>}
            </span>
            <input name="people" value={id} type="checkbox" defaultChecked={participating && available} disabled={!available}
              className="peer absolute top-1/2 right-0 size-12 -translate-y-1/2 cursor-pointer appearance-none opacity-0 max-[299px]:top-1.5 max-[299px]:translate-y-0" />
            <span aria-hidden="true" className="pointer-events-none flex size-8 shrink-0 items-center justify-center rounded-full border-[2.5px] border-ink/30 text-transparent
              peer-checked:border-ink peer-checked:bg-ink peer-checked:text-snow-white peer-focus-visible:outline-3 peer-focus-visible:outline-offset-3 peer-focus-visible:outline-ink">
              <Icon name="check" size={19} strokeWidth={3} />
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** One person from the family, on a track-tone pill. */
export function PersonSelect({label, people, name = "person", placeholder}: {
  label: string; people: ReadonlyArray<{id: string; displayName: string}>; name?: string; placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-body font-bold text-[var(--fg-muted)]">
      {label}
      <select className="h-14 w-full cursor-pointer appearance-none rounded-pill bg-[var(--track,var(--card-track))] px-5 text-lead font-semibold text-ink
        focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-ink" name={name} required defaultValue="">
        <option disabled value="">{placeholder ?? label}</option>
        {people.map(({id, displayName}) => <option key={id} value={id}>{displayName}</option>)}
      </select>
    </label>
  );
}

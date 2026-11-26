// Drawn stand-ins for store photos, from the design (the build shows the fetched photo on the same tile).
// Dev gallery only.
const BG = {
  robe: "#E9E4E0", crossword: "#E6ECF3", pruners: "#E5EDE3", coffee: "#F1E7DF", baking: "#EAE6F1", socks: "#E9EEF1",
  skillet: "#EFEAE4", hikesocks: "#E8EDE6", earbuds: "#ECEEF2",
} as const;

const ART: Readonly<Record<keyof typeof BG, string>> = {
  robe: '<path d="M30 22l10-6h20l10 6 8 54-14 6H36l-14-6z" fill="#2F3438"/><path d="M40 16l10 18 10-18" fill="none" stroke="#4A5156" stroke-width="4" stroke-linejoin="round"/><path d="M50 34v48" stroke="#22272A" stroke-width="2"/><path d="M30 52h40" stroke="#5B6267" stroke-width="5" stroke-linecap="round"/><path d="M47 52l-6 14M53 52l6 14" stroke="#5B6267" stroke-width="4" stroke-linecap="round"/>',
  crossword: '<rect x="28" y="18" width="44" height="62" rx="3" fill="#2F5E9E"/><rect x="34" y="28" width="32" height="32" fill="#fff"/><path d="M42 28v32M50 28v32M58 28v32M34 36h32M34 44h32M34 52h32" stroke="#2F5E9E" stroke-width="1.2"/><rect x="42" y="36" width="8" height="8" fill="#2F5E9E"/><rect x="58" y="44" width="8" height="8" fill="#2F5E9E"/><rect x="34" y="52" width="8" height="8" fill="#2F5E9E"/><rect x="34" y="66" width="24" height="4" rx="2" fill="#fff" opacity=".85"/>',
  pruners: '<path d="M48 50 28 22c-2-3 1-6 4-4l22 26z" fill="#B9C0C4"/><path d="M52 50 72 22c2-3-1-6-4-4L46 44z" fill="#D7DCDF"/><path d="M47 48 34 80c-1 3 3 5 5 3l14-28z" fill="#D2452F"/><path d="M53 48l13 32c1 3-3 5-5 3L47 55z" fill="#E86A3E"/><circle cx="50" cy="48" r="3.4" fill="#5C6266"/>',
  coffee: '<path d="M30 40h34l-4 34a4 4 0 0 1-4 3.5H38a4 4 0 0 1-4-3.5z" fill="#C0643E"/><path d="M64 46h4a7 7 0 0 1 0 14h-6" fill="none" stroke="#C0643E" stroke-width="4"/><path d="M34 26h26l-6 14H40z" fill="#E7D6C8"/><path d="M40 20c0-4 4-4 4-8M50 20c0-4 4-4 4-8" stroke="#B69C88" stroke-width="2.4" fill="none" stroke-linecap="round"/>',
  baking: '<rect x="30" y="20" width="40" height="58" rx="3" fill="#3C6AA8"/><rect x="30" y="20" width="6" height="58" fill="#2E5487"/><ellipse cx="54" cy="52" rx="11" ry="8" fill="#E8C68A"/><path d="M47 50c3-3 11-3 14 0" stroke="#B98A47" stroke-width="2" fill="none"/><rect x="42" y="30" width="22" height="4" rx="2" fill="#fff" opacity=".85"/>',
  socks: '<path d="M34 18h14v34l8 10c4 5 0 12-6 12H36c-5 0-8-4-6-8l4-6z" fill="#8B6FB5"/><path d="M34 18h14v8H34z" fill="#6E549B"/><path d="M52 24h14v30l7 9c4 5 0 11-6 11H55c-5 0-7-4-5-8l2-5z" fill="#B49BDA"/><path d="M52 24h14v8H52z" fill="#957BC2"/>',
  skillet: '<circle cx="44" cy="54" r="24" fill="#2A2C2E"/><circle cx="44" cy="54" r="18" fill="#3B3E41"/><path d="M66 46 84 34c3-2 6 2 3 5L70 52z" fill="#2A2C2E"/>',
  hikesocks: '<path d="M32 16h16v36l9 10c4 5 0 12-6 12H35c-6 0-9-4-6-9l3-5z" fill="#6E7F5C"/><path d="M32 16h16v7H32z" fill="#C9542F"/><path d="M32 40h16" stroke="#C9542F" stroke-width="3"/><path d="M54 22h16v32l8 10c4 5 0 11-6 11H58c-5 0-8-4-5-8l1-6z" fill="#8A9B76"/><path d="M54 22h16v7H54z" fill="#C9542F"/>',
  earbuds: '<rect x="27" y="44" width="46" height="34" rx="16" fill="#2B2E33"/><path d="M27 58h46" stroke="#3E434A" stroke-width="2"/><circle cx="50" cy="66" r="2.2" fill="#7FD19B"/><circle cx="39" cy="30" r="8.5" fill="#33373D"/><rect x="35.5" y="34" width="7" height="15" rx="3.5" fill="#33373D"/><circle cx="61" cy="30" r="8.5" fill="#33373D"/><rect x="57.5" y="34" width="7" height="15" rx="3.5" fill="#33373D"/><circle cx="37" cy="28" r="2.4" fill="#5A6069"/><circle cx="59" cy="28" r="2.4" fill="#5A6069"/>',
};

export type StandIn = keyof typeof BG;

export function ProductStandIn({kind, size = 72}: {kind: StandIn; size?: number}) {
  return (
    <span aria-hidden="true" className="flex shrink-0 items-center justify-center overflow-hidden rounded-picture" style={{width: size, height: size, background: BG[kind]}}>
      <svg width={size} height={size} viewBox="0 0 100 100" className="block" dangerouslySetInnerHTML={{__html: ART[kind]}} />
    </span>
  );
}

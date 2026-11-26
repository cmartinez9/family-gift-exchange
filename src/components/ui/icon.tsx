import type {CSSProperties} from "react";
import {cn} from "./cn";

// One set: line icons on a 24px grid, round caps and joins, 2.2 to 2.4 stroke. Ported from the round-3 generator.
// The markup is a fixed, trusted constant.
const ICONS = {
  home: '<path d="M4 10.4 12 4l8 6.4V19a1.5 1.5 0 0 1-1.5 1.5H15v-5.5H9v5.5H5.5A1.5 1.5 0 0 1 4 19z"/>',
  list: '<path d="M9.5 6.5H20M9.5 12H20M9.5 17.5H20"/><circle cx="5" cy="6.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="5" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="5" cy="17.5" r="1.2" fill="currentColor" stroke="none"/>',
  family: '<circle cx="9" cy="8" r="3.4"/><path d="M2.8 20c.7-3.5 3.2-5.6 6.2-5.6s5.5 2.1 6.2 5.6"/><path d="M15.6 4.9a3.3 3.3 0 0 1 0 6.3M17.6 14.9c1.8.8 3 2.5 3.4 5.1"/>',
  gift: '<rect x="4" y="10" width="16" height="10.5" rx="1.5"/><rect x="3" y="6.5" width="18" height="3.5" rx="1"/><path d="M12 6.5v14"/><path d="M12 6.5C10.6 3.8 7.2 3.3 7.2 5.3c0 1.4 2.4 1.2 4.8 1.2zM12 6.5c1.4-2.7 4.8-3.2 4.8-1.2 0 1.4-2.4 1.2-4.8 1.2z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  link: '<path d="M10.2 13.8a4 4 0 0 0 5.6 0l3-3a4 4 0 0 0-5.6-5.6l-1 1"/><path d="M13.8 10.2a4 4 0 0 0-5.6 0l-3 3a4 4 0 0 0 5.6 5.6l1-1"/>',
  camera: '<path d="M4.5 8h2.8l1.8-2.6h5.8L16.7 8h2.8A1.5 1.5 0 0 1 21 9.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5v-9A1.5 1.5 0 0 1 4.5 8z"/><circle cx="12" cy="13.6" r="3.6"/>',
  pencil: '<path d="M4.5 19.5l1-4.2L15.8 5a2 2 0 0 1 2.9 0l.3.3a2 2 0 0 1 0 2.9L8.7 18.5z"/><path d="M13.8 7l3.2 3.2"/>',
  check: '<path d="M5 12.6l4.4 4.4L19 7.4"/>',
  chevron: '<path d="M9.5 5.5 16 12l-6.5 6.5"/>',
  arrow: '<path d="M4.5 12h15M13.5 6l6 6-6 6"/>',
  back: '<path d="M14.5 5.5 8 12l6.5 6.5"/>',
  lock: '<rect x="5.5" y="10.5" width="13" height="10" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  faceid: '<path d="M4 8.5V6.5A2.5 2.5 0 0 1 6.5 4h2M15.5 4h2A2.5 2.5 0 0 1 20 6.5v2M20 15.5v2a2.5 2.5 0 0 1-2.5 2.5h-2M8.5 20h-2A2.5 2.5 0 0 1 4 17.5v-2"/><path d="M9 9.2v1.3M15 9.2v1.3M12.3 9.2v3.8h-1.1M9.2 15.6c1.7 1.3 3.9 1.3 5.6 0"/>',
  calendar: '<rect x="4" y="5.5" width="16" height="15" rx="2"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
  pin: '<path d="M12 21s-6.8-6-6.8-11.2a6.8 6.8 0 0 1 13.6 0C18.8 15 12 21 12 21z"/><circle cx="12" cy="9.8" r="2.5"/>',
  tag: '<path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1 1 0 0 1 0 1.4l-7.3 7.3a1 1 0 0 1-1.4 0z"/><circle cx="8" cy="8" r="1.5"/>',
  message: '<path d="M5 4.5h14A1.5 1.5 0 0 1 20.5 6v9.5A1.5 1.5 0 0 1 19 17h-8.5l-5 4v-4H5a1.5 1.5 0 0 1-1.5-1.5V6A1.5 1.5 0 0 1 5 4.5z"/>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  share: '<path d="M12 3.5v11.5M7.5 8 12 3.5 16.5 8"/><path d="M5 12.5v6.5A1.5 1.5 0 0 0 6.5 20.5h11a1.5 1.5 0 0 0 1.5-1.5v-6.5"/>',
  star: '<path d="M12 3.6l2.6 5.2 5.8.9-4.2 4.1 1 5.7L12 16.8l-5.2 2.7 1-5.7-4.2-4.1 5.8-.9z"/>',
  backspace: '<path d="M9 5.5h10.5A1.5 1.5 0 0 1 21 7v10a1.5 1.5 0 0 1-1.5 1.5H9L3 12z"/><path d="M12.5 9.5l5 5M17.5 9.5l-5 5"/>',
  shuffle: '<path d="M3.5 7H7c4.3 0 5.7 10 10 10h3.5M17.5 14l3 3-3 3M3.5 17H7c1.6 0 2.8-1.4 3.9-3.1M13.1 10.1C14.2 8.4 15.4 7 17 7h3.5M17.5 4l3 3-3 3"/>',
  note: '<path d="M6 3.5h8.5L19 8v11a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19V5a1.5 1.5 0 0 1 1-1.5z"/><path d="M8.5 12h7M8.5 15.5h5"/>',
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.5 3.4 5.4 3.4 8.5s-1 6-3.4 8.5c-2.4-2.5-3.4-5.4-3.4-8.5s1-6 3.4-8.5z"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  user: '<circle cx="12" cy="8.5" r="4"/><path d="M4.5 20.5c.9-4 3.8-6 7.5-6s6.6 2 7.5 6"/>',
  undo: '<path d="M9 7.5 4.5 12 9 16.5"/><path d="M4.5 12H15a4.5 4.5 0 0 1 0 9h-2"/>',
  qr: '<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z"/><path d="M14 14h2.5v2.5H14zM17.5 17.5H20V20h-2.5zM14 18.5h1.5M18.5 14H20"/>',
  print: '<path d="M7 9V4h10v5"/><path d="M7 17H5a1.5 1.5 0 0 1-1.5-1.5v-5A1.5 1.5 0 0 1 5 9h14a1.5 1.5 0 0 1 1.5 1.5v5A1.5 1.5 0 0 1 19 17h-2"/><path d="M7 14h10v6H7z"/>',
  copy: '<path d="M9 9h10.5v11.5H9z"/><path d="M5.5 15V5.5A1.5 1.5 0 0 1 7 4h8.5"/>',
  alert: '<path d="M12 4 21 19.5H3z"/><path d="M12 10v4.5M12 17.2v.3"/>',
  phone: '<path d="M8 3.5h8A1.5 1.5 0 0 1 17.5 5v14a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 19V5A1.5 1.5 0 0 1 8 3.5z"/><path d="M11 17.5h2"/>',
  plussq: '<path d="M5.5 4h13A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-13A1.5 1.5 0 0 1 5.5 4z"/><path d="M12 8.5v7M8.5 12h7"/>',
  heart: '<path d="M12 19.5s-7.5-4.6-7.5-9.6A4.2 4.2 0 0 1 12 7.6a4.2 4.2 0 0 1 7.5 2.3c0 5-7.5 9.6-7.5 9.6z"/>',
  shirt: '<path d="M8.5 4 4 6.5 5.8 10.5 7.5 9.7V20h9V9.7l1.7.8L20 6.5 15.5 4c-.4 1.6-1.8 2.6-3.5 2.6S8.9 5.6 8.5 4z"/>',
  dots: '<path d="M6 12h.01M12 12h.01M18 12h.01" stroke-width="3.4"/>',
} as const;

export type IconName = keyof typeof ICONS;
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

/** A line icon. It always sits next to a word, except the 48px back, close and heart discs, which carry a label. */
export function Icon({name, size = 24, strokeWidth = 2.2, className, style}: {
  name: IconName; size?: number; strokeWidth?: number; className?: string; style?: CSSProperties;
}) {
  return (
    <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={cn("block shrink-0", className)} style={style}
      data-icon={name} dangerouslySetInnerHTML={{__html: ICONS[name]}} />
  );
}

/** The heart: filled red when you really want something. */
export function Heart({on, size = 22, className}: {on: boolean; size?: number; className?: string}) {
  return (
    <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24" className={cn("block shrink-0", className)}>
      <path d="M12 20s-7.6-4.7-7.6-10A4.3 4.3 0 0 1 12 7.5a4.3 4.3 0 0 1 7.6 2.5c0 5.3-7.6 10-7.6 10z"
        style={{fill: on ? "var(--color-sweater-red)" : "none", stroke: on ? "var(--color-sweater-red)" : "currentColor"}}
        strokeWidth={2.2} strokeLinejoin="round" />
    </svg>
  );
}

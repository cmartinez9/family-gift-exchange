import Image from "next/image";

const storeGlyphs: Record<string, string> = {
  amazon: "a", etsy: "E", walmart: "✱", target: "◎", costco: "C", "best-buy": "BB", lego: "L",
};

export function StoreIcon({icon, src}: {icon?: string; src?: string}) {
  if (src) return <Image src={src} alt="" width={32} height={32} unoptimized className="rounded" />;
  return (
    <span aria-hidden="true" className="inline-flex size-8 items-center justify-center rounded border border-current/50 text-sm">
      {icon && Object.hasOwn(storeGlyphs, icon) ? storeGlyphs[icon] : "▤"}
    </span>
  );
}

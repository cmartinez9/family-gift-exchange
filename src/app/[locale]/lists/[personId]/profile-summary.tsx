import {getFormatter, getTranslations} from "next-intl/server";
import type {getWishlist} from "@/server/lists";
import {aboutFields, sizeKinds, sizePresets} from "@/server/lists/validation";
import {panelClass} from "../styles";

export async function ProfileSummary({list}: {list: Awaited<ReturnType<typeof getWishlist>>}) {
  const [t, format] = await Promise.all([getTranslations("lists"), getFormatter()]);
  const sizes = new Map(list.sizes.map((size) => [size.kind, size]));
  const about = aboutFields.filter((field) => list.about[field]);
  return (
    <>
      <section className={panelClass} aria-labelledby="list-sizes">
        <h2 id="list-sizes" className="text-xl font-semibold">{t("sizes")}</h2>
        {list.owner.noClothes ? <p>{t("noClothes")}</p> : !sizes.size ? <p>{t("noSizes")}</p> : (
          <dl className="space-y-2">
            {sizeKinds.map((kind) => {
              const size = sizes.get(kind);
              if (!size) return null;
              const shoeSystem = kind === "shoeSystem" ? sizePresets.shoeSystem.find((system) => system === size.value) : undefined;
              const value = shoeSystem ? t(`shoe.${shoeSystem}`) : size.value;
              return (
                <div key={kind} className="break-words">
                  <dt className="font-medium">{t(`size.${kind}`)}</dt>
                  <dd>{value}</dd>
                  <dd className="text-base"><time dateTime={size.updatedAt.toISOString()}>{t("updated", {
                    day: format.dateTime(size.updatedAt, {dateStyle: "medium", timeZone: "UTC"}),
                  })}</time></dd>
                </div>
              );
            })}
          </dl>
        )}
      </section>
      <section className={panelClass} aria-labelledby="list-about">
        <h2 id="list-about" className="text-xl font-semibold">{t("about")}</h2>
        {about.length ? (
          <dl className="space-y-2">
            {about.map((field) => <div key={field}>
              <dt className="font-medium">{t(`aboutField.${field}`)}</dt>
              <dd className="whitespace-pre-wrap break-words">{list.about[field]}</dd>
            </div>)}
          </dl>
        ) : <p>{t("noAbout")}</p>}
      </section>
    </>
  );
}

import {getFormatter, getTranslations} from "next-intl/server";
import {Card, Fact} from "@/components/ui/card";
import type {getWishlist} from "@/server/lists";
import {aboutFields, sizeKinds, sizePresets} from "@/server/lists/validation";
import {sizeLabel} from "../tabs";

/** Someone's sizes and About me, under their list: plain facts on a yarn-white card. */
export async function ProfileSummary({list}: {list: Awaited<ReturnType<typeof getWishlist>>}) {
  const [t, format] = await Promise.all([getTranslations("lists"), getFormatter()]);
  const sizes = new Map(list.sizes.map((size) => [size.kind, size]));
  const about = aboutFields.filter((field) => list.about[field]);
  return (
    <>
      <section aria-labelledby="list-sizes" className="flex flex-col gap-3 pt-3">
        <h2 id="list-sizes" className="text-section text-snow-white">{t("sizes")}</h2>
        <Card>
          {list.owner.noClothes ? <Fact icon="shirt">{t("noClothes")}</Fact> : !sizes.size ? <p className="text-body text-muted-ink">{t("noSizes")}</p> : (
            <dl className="fge-rows flex flex-col">
              {sizeKinds.map((kind) => {
                const size = sizes.get(kind);
                if (!size) return null;
                const shoeSystem = kind === "shoeSystem" ? sizePresets.shoeSystem.find((system) => system === size.value) : undefined;
                const value = shoeSystem ? t(`shoe.${shoeSystem}`) : sizeLabel(size.value);
                return (
                  <div key={kind} className="flex flex-wrap items-baseline justify-between gap-x-3 py-2.5 first:pt-0 last:pb-0">
                    <dt className="text-body text-muted-ink">{t(`size.${kind}`)}</dt>
                    <dd className="break-words text-body-strong">{value}</dd>
                    <dd className="w-full text-body text-muted-ink">
                      <time dateTime={size.updatedAt.toISOString()}>{t("updated", {
                        day: format.dateTime(size.updatedAt, {dateStyle: "medium", timeZone: "UTC"}),
                      })}</time>
                    </dd>
                  </div>
                );
              })}
            </dl>
          )}
        </Card>
      </section>
      <section aria-labelledby="list-about" className="flex flex-col gap-3 pt-3">
        <h2 id="list-about" className="text-section text-snow-white">{t("about")}</h2>
        <Card>
          {about.length ? (
            <dl className="fge-rows flex flex-col">
              {about.map((field) => (
                <div key={field} className="flex flex-col py-2.5 first:pt-0 last:pb-0">
                  <dt className="text-body text-muted-ink">{t(`aboutField.${field}`)}</dt>
                  <dd className="whitespace-pre-wrap break-words text-body-strong">{list.about[field]}</dd>
                </div>
              ))}
            </dl>
          ) : <p className="text-body text-muted-ink">{t("noAbout")}</p>}
        </Card>
      </section>
    </>
  );
}

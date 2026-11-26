import Image from "next/image";
import {getFormatter, getLocale, getTranslations} from "next-intl/server";
import {Link} from "@/i18n/navigation";
import type {getWishlist} from "@/server/lists";
import {isOverBudget} from "@/server/lists/validation";
import {claimCommand, itemCommand} from "../actions";
import {ListForm} from "../controls";
import {StoreIcon} from "../store-icon";
import {linkClass, panelClass} from "../styles";

type Item = Awaited<ReturnType<typeof getWishlist>>["items"][number];

export async function ItemCard({
  item, ownerId, canEdit, canClaim, first, last, budget,
}: {
  item: Item;
  ownerId: string;
  canEdit: boolean;
  canClaim: boolean;
  first: boolean;
  last: boolean;
  budget: string | null;
}) {
  const [t, format, locale] = await Promise.all([getTranslations("lists"), getFormatter(), getLocale()]);
  const photoPath = `/${locale}/lists/photo/${item.id}`;
  const edit = `/lists/${ownerId}/items/${item.id}/edit`;
  return (
    <article className={panelClass} aria-labelledby={`item-${item.id}`}>
      {item.hasPhoto && (
        <Image src={`${photoPath}/photo`} alt="" width={400} height={300} unoptimized
          className="h-auto max-h-64 w-auto max-w-full rounded object-contain" />
      )}
      <h2 id={`item-${item.id}`} className="break-words text-xl font-semibold">{item.title}</h2>
      {item.kind === "link" && item.store && (
        <p className="flex items-center gap-2 break-all">
          {!item.hasPhoto && <StoreIcon icon={item.icon} src={item.hasIcon ? `${photoPath}/icon` : undefined} />}
          {item.store}
        </p>
      )}
      {item.note && <p className="whitespace-pre-wrap break-words">{item.note}</p>}
      {item.price !== null && <p>{format.number(Number(item.price), {style: "currency", currency: "USD"})}</p>}
      {isOverBudget(item.price, budget) && <p className="text-base">{t("overBudget")}</p>}
      {item.starred && <p><span aria-hidden="true">★ </span>{t("starred")}</p>}
      {item.url && <a href={item.url} target="_blank" rel="noreferrer" className={linkClass}>{t("openProduct")}</a>}
      {canClaim && (item.claim === "someone" ? <p>{t("someone")}</p> : item.claim === "mine" ? (
        <div>
          <p>{t("mine")}</p>
          <ListForm action={claimCommand.bind(null, item.id, "undo", false)} label={t("undoClaim")} secondary />
        </div>
      ) : <ListForm action={claimCommand.bind(null, item.id, "claim", true)} label={t("claim")} />)}
      {canEdit && (
        <>
          {item.kind === "link" && !item.hasPhoto && <Link className={linkClass} href={edit}>{t("photoFallback")}</Link>}
          <div className="flex flex-wrap gap-x-4">
            <Link className={linkClass} href={edit} aria-label={t("editNamedItem", {title: item.title})}>{t("editItem")}</Link>
            {!first && <ListForm action={itemCommand.bind(null, ownerId, item.id, "up")} label={t("up")} secondary />}
            {!last && <ListForm action={itemCommand.bind(null, ownerId, item.id, "down")} label={t("down")} secondary />}
            {item.url && <ListForm action={itemCommand.bind(null, ownerId, item.id, "refresh")} label={t("refresh")} secondary />}
          </div>
          <details className="space-y-2">
            <summary className={linkClass}>{t("deleteItem")}</summary>
            <p>{t("confirmDelete", {title: item.title})}</p>
            <ListForm action={itemCommand.bind(null, ownerId, item.id, "delete")} label={t("confirmDeleteButton")} />
          </details>
        </>
      )}
    </article>
  );
}

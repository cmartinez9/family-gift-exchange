import {getTranslations} from "next-intl/server";
import {Link} from "@/i18n/navigation";
import {requireViewer} from "@/server/auth";
import {getGettingList} from "@/server/lists/claims";
import {claimCommand} from "../actions";
import {ChecklistTick} from "../controls";
import {linkClass, panelClass} from "../styles";

export default async function GettingPage() {
  const viewer = await requireViewer();
  const [items, t] = await Promise.all([getGettingList(viewer), getTranslations("lists")]);
  return (
    <>
      <h1 className="text-2xl font-semibold">{t("getting")}</h1>
      {!items.length && <p>{t("emptyGetting")}</p>}
      <ul className="space-y-3">
        {items.map(({itemId, title, ownerName, ownerId, bought, wrapped}) => (
          <li key={itemId} className={panelClass}>
            <h2 className="break-words text-xl font-semibold">{title}</h2>
            <Link className={linkClass} href={`/lists/${ownerId}`}>{t("gettingFor", {name: ownerName})}</Link>
            <ChecklistTick key={`bought-${bought}`} label={t("bought")} checked={bought}
              action={claimCommand.bind(null, itemId, "bought")} />
            <ChecklistTick key={`wrapped-${wrapped}`} label={t("wrapped")} checked={wrapped}
              action={claimCommand.bind(null, itemId, "wrapped")} />
          </li>
        ))}
      </ul>
    </>
  );
}

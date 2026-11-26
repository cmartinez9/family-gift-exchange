import {getFormatter, getLocale, getTranslations} from "next-intl/server";
import {notFound} from "next/navigation";
import {Link} from "@/i18n/navigation";
import {requireViewer} from "@/server/auth";
import {readiness} from "@/server/auth/families";
import {withFamily} from "@/server/db/client";
import {AuthForm} from "../sign-in/controls";
import {activityDateFormat, inputClass, linkClass, sectionClass} from "../sign-in/styles";
import {deleteMember, updateCoOrganizer, updateHousehold, updateMember, updatePair} from "./actions";

type Board = NonNullable<Awaited<ReturnType<typeof readiness>>>;
type Member = Board["members"][number];

async function MemberFields({member, board, constraints}: {member?: Member; board: Board; constraints: boolean}) {
  const t = await getTranslations("auth");
  const defaultLanguage = member?.language ?? await getLocale();
  const eligible = board.members.filter(({id, helperId}) => id !== member?.id && !helperId);
  return (
    <>
      <label className="block">
        {t("name")}<input className={inputClass} name="name" defaultValue={member?.name ?? ""} required maxLength={60} />
      </label>
      <label className="block">
        {t("language")}
        <select className={inputClass} name="language" defaultValue={defaultLanguage}>
          <option value="en">English</option><option value="es">Español</option>
        </select>
      </label>
      {constraints ? (
        <>
          <label className="block">
            {t("household")}
            <select className={inputClass} name="household" defaultValue={member?.householdId ?? ""}>
              <option value="">{t("none")}</option>
              {board.groups.map(({id, name}) => <option key={id} value={id}>{name}</option>)}
            </select>
          </label>
          <label className="block">
            {t("helper")}
            <select className={inputClass} name="helper" defaultValue={member?.helperId ?? ""}>
              <option value="">{t("hasOwnDevice")}</option>
              {eligible.map(({id, name}) => <option key={id} value={id}>{name}</option>)}
            </select>
          </label>
        </>
      ) : (
        <><input type="hidden" name="household" value={member?.householdId ?? ""} />
          <input type="hidden" name="helper" value={member?.helperId ?? ""} /></>
      )}
    </>
  );
}

export default async function FamilyPage() {
  const viewer = await requireViewer();
  const board = await withFamily(viewer.familyId, (tx) => readiness(tx, viewer, new Date()));
  if (!board) notFound();
  const t = await getTranslations("auth");
  const format = await getFormatter();
  const visibleMembers = new Map(board.members.map(({id, name}) => [id, name]));
  const coOrganizer = board.members.find(({role}) => role === "co_organizer");
  return (
    <main className={sectionClass}>
      <h1 className="text-2xl font-semibold">{board.familyName}</h1>
      <nav className="flex flex-wrap gap-4" aria-label={t("manageFamily")}>
        <Link href="/account" className={linkClass}>{t("openAccount")}</Link>
        {board.canSendKeys && <Link href="/family/keys" className={linkClass}>{t("sendKeys")}</Link>}
      </nav>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">{t("readiness")}</h2>
        <ul className="space-y-4">
          {board.members.map((member) => {
            const {id, name, helperId, joinedAt, role} = member;
            const status = joinedAt ? "joined" : board.sent.some((key) => key.personId === id) ? "sent" : "invited";
            const device = board.devices.find(({personId}) => personId === id);
            const request = board.requests.find(({personId}) => personId === id);
            return (
              <li key={id} className="space-y-1 border-b border-current/25 pb-4">
                <h3 className="font-semibold">{name}</h3>
                <p>{helperId ? t("lookedAfter", {name: visibleMembers.get(helperId) ?? ""}) : t(`status.${status}`)}</p>
                {device && <p>{t(`device.${device.kind}` as Parameters<typeof t>[0])}</p>}
                {request && (
                  <p>{t("requestAt", {at: format.dateTime(request.at, activityDateFormat)})} {t(`device.${request.deviceKind}` as Parameters<typeof t>[0])}
                    {board.canSendKeys && <Link className={linkClass} href={`/family/keys#member-${id}`}>{t("resetPin")}</Link>}
                  </p>
                )}
                <details className="space-y-3">
                  <summary className={linkClass}>{t("editMember", {name})}</summary>
                  <AuthForm action={updateMember.bind(null, id)} label={t("save")}>
                    <MemberFields member={member} board={board} constraints={board.constraintsOpen} />
                  </AuthForm>
                  {role === "member" && (
                    <details className="space-y-2">
                      <summary className={linkClass}>{t("remove", {name})}</summary>
                      <AuthForm action={deleteMember.bind(null, id)} label={t("confirmRemove", {name})} />
                    </details>
                  )}
                </details>
              </li>
            );
          })}
        </ul>
        <details className="space-y-3">
          <summary className={linkClass}>{t("addMember")}</summary>
          <AuthForm action={updateMember.bind(null, null)} label={t("addMember")}>
            <MemberFields board={board} constraints />
          </AuthForm>
        </details>
      </section>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">{t("households")}</h2>
        {board.groups.map(({id, name}) => (
          <details key={id} className="space-y-3">
            <summary className={linkClass}>{name}</summary>
            <AuthForm action={updateHousehold.bind(null, id, false)} label={t("save")}>
              <label className="block">{t("householdName")}<input className={inputClass} name="name" defaultValue={name} required maxLength={60} /></label>
            </AuthForm>
            <AuthForm action={updateHousehold.bind(null, id, true)} label={t("remove", {name})} />
          </details>
        ))}
        <AuthForm action={updateHousehold.bind(null, null, false)} label={t("addHousehold")}>
          <label className="block">{t("householdName")}<input className={inputClass} name="name" required maxLength={60} /></label>
        </AuthForm>
      </section>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">{t("keepApart")}</h2>
        {board.pairs.filter(({personA, personB}) => visibleMembers.has(personA) && visibleMembers.has(personB))
          .map(({personA, personB}) => (
            <div key={`${personA}.${personB}`}>
              <p>{t("pairNames", {first: visibleMembers.get(personA)!, second: visibleMembers.get(personB)!})}</p>
              {board.constraintsOpen && <AuthForm action={updatePair.bind(null, [personA, personB])} label={t("removePair")} />}
            </div>
          ))}
        {board.constraintsOpen && board.members.length >= 2 && (
          <AuthForm action={updatePair.bind(null, null)} label={t("addPair")}>
            {(["first", "second"] as const).map((key) => (
              <label key={key} className="block">{t(key)}
                <select name={key} className={inputClass} defaultValue="" required>
                  <option value="" disabled>{t("choose")}</option>
                  {board.members.map(({id, name}) => <option key={id} value={id}>{name}</option>)}
                </select>
              </label>
            ))}
          </AuthForm>
        )}
      </section>
      {board.canSendKeys && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">{t("coOrganizer")}</h2>
          <AuthForm action={updateCoOrganizer} label={t("save")}>
            <label className="block">{t("coOrganizer")}
              <select className={inputClass} name="coOrganizer" defaultValue={coOrganizer?.id ?? ""}>
                <option value="">{t("none")}</option>
                {board.members.filter(({role, helperId}) => role !== "organizer" && !helperId)
                  .map(({id, name}) => <option key={id} value={id}>{name}</option>)}
              </select>
            </label>
          </AuthForm>
        </section>
      )}
      {board.activity.length > 0 && (
        <section>
          <h2 className="text-xl font-semibold">{t("familyActivity")}</h2>
          <ul className="space-y-2">
            {board.activity.map(({personId, kind, at, deviceKind}, index) => (
              <li key={`${at.toISOString()}.${index}`}>
                <strong>{visibleMembers.get(personId)}</strong> {t(`event.${kind}`)} {deviceKind && t(`device.${deviceKind}` as Parameters<typeof t>[0])} <time dateTime={at.toISOString()}>{format.dateTime(at, activityDateFormat)}</time>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

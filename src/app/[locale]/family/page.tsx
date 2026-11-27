import {getFormatter, getLocale, getTranslations} from "next-intl/server";
import {notFound, redirect} from "next/navigation";
import type {ReactNode} from "react";
import {Avatar} from "@/components/ui/avatar";
import {ButtonLink} from "@/components/ui/button";
import {Card, Chevron, IconDisc, ListRow, Rows} from "@/components/ui/card";
import {Icon} from "@/components/ui/icon";
import {TextField} from "@/components/ui/inputs";
import {KnitIn} from "@/components/ui/motion/knit-in";
import {AppLink} from "@/components/ui/navigation";
import {BackRow, PageTitle, SectionHeading} from "@/components/ui/page-header";
import {Screen} from "@/components/ui/screen";
import {requireViewer} from "@/server/auth";
import {readiness} from "@/server/auth/families";
import {withFamily} from "@/server/db/client";
import {listExchanges} from "@/server/draw";
import {getUnreadCount} from "@/server/messages/inbox";
import {SetupSteps} from "../exchanges/setup";
import {activityDateFormat} from "../sign-in/styles";
import {deleteMember, updateCoOrganizer, updateHousehold, updateMember, updatePair} from "./actions";
import {FamilyForm, SelectField} from "./forms";

type Board = NonNullable<Awaited<ReturnType<typeof readiness>>>;
type Member = Board["members"][number];

async function MemberFields({member, board, constraints}: {member?: Member; board: Board; constraints: boolean}) {
  const t = await getTranslations("auth");
  const defaultLanguage = member?.language ?? await getLocale();
  const eligible = board.members.filter(({id, helperId}) => id !== member?.id && !helperId);
  return (
    <>
      <TextField label={t("name")} name="name" defaultValue={member?.name ?? ""} required maxLength={60} />
      <SelectField label={t("language")} name="language" defaultValue={defaultLanguage}>
        <option value="en">English</option><option value="es">Español</option>
      </SelectField>
      {constraints ? (
        <>
          <SelectField label={t("household")} name="household" defaultValue={member?.householdId ?? ""}>
            <option value="">{t("none")}</option>
            {board.groups.map(({id, name}) => <option key={id} value={id}>{name}</option>)}
          </SelectField>
          <SelectField label={t("helper")} name="helper" defaultValue={member?.helperId ?? ""}>
            <option value="">{t("hasOwnDevice")}</option>
            {eligible.map(({id, name}) => <option key={id} value={id}>{name}</option>)}
          </SelectField>
        </>
      ) : (
        <><input type="hidden" name="household" value={member?.householdId ?? ""} />
          <input type="hidden" name="helper" value={member?.helperId ?? ""} /></>
      )}
    </>
  );
}

/** A row that opens in place: the summary is a 48px chevron disc whose only text is its name for screen readers. */
function RowEditor({label, children}: {label: string; children: ReactNode}) {
  return (
    <details className="group">
      <summary className="fge-press absolute top-2 right-0 flex size-12 cursor-pointer list-none items-center justify-center rounded-full bg-card-track text-ink [&::-webkit-details-marker]:hidden">
        <Icon name="chevron" size={22} className="transition-transform duration-200 group-open:rotate-90" />
        <span className="sr-only">{label}</span>
      </summary>
      <div className="flex flex-col gap-3 pt-2 pb-4">{children}</div>
    </details>
  );
}

/** A grouped-card row that opens in place, with its words as the summary. */
function OpenRow({summary, icon, children}: {summary: string; icon: Parameters<typeof IconDisc>[0]["icon"]; children: ReactNode}) {
  return (
    <details className="group">
      <summary className="fge-press flex min-h-16 cursor-pointer list-none items-center gap-3.5 py-2 [&::-webkit-details-marker]:hidden">
        <IconDisc icon={icon} />
        <span className="min-w-0 flex-1 text-row-title">{summary}</span>
        <Icon name="chevron" size={22} className="text-muted-ink transition-transform duration-200 group-open:rotate-90" />
      </summary>
      <div className="flex flex-col gap-3 pt-1 pb-4">{children}</div>
    </details>
  );
}

export default async function FamilyPage() {
  const viewer = await requireViewer();
  const board = await withFamily(viewer.familyId, (tx) => readiness(tx, viewer, new Date()));
  if (!board) notFound();
  // details never saved: the exchange (step 1) comes first. A brand-new family starts there; once
  // anyone else is in the family, it stays manageable here with the way back to step 1.
  const unnamed = board.exchangeId
    ? (await listExchanges(viewer)).find(({id}) => id === board.exchangeId)?.status === "setup"
    : false;
  if (unnamed && board.members.length <= 1) redirect(`/${await getLocale()}/exchanges/${board.exchangeId}/manage`);
  const [t, draw, ui, format, chat, inbox, lists, unread] = await Promise.all([
    getTranslations("auth"), getTranslations("draw"), getTranslations("ui"), getFormatter(),
    getTranslations("notify.groupChat"), getTranslations("notify.inbox"), getTranslations("lists"), getUnreadCount(viewer),
  ]);
  const visibleMembers = new Map(board.members.map(({id, name}) => [id, name]));
  const coOrganizer = board.members.find(({role}) => role === "co_organizer");
  const setup = board.constraintsOpen;
  const hub = board.exchangeId ? `/exchanges/${board.exchangeId}/manage` : "/exchanges";
  const groups = [
    ...board.groups.map(({id, name}) => ({id, name, members: board.members.filter(({householdId}) => householdId === id)})),
    {id: null, name: draw("setup.noHouse"), members: board.members.filter(({householdId}) => !householdId)},
  ].filter(({id, members}) => id !== null || members.length > 0);

  const memberRow = (member: Member) => {
    const {id, name, helperId, joinedAt, role} = member;
    const status = joinedAt ? "joined" : board.sent.some((key) => key.personId === id) ? "sent" : "invited";
    const device = board.devices.find(({personId}) => personId === id);
    const request = board.requests.find(({personId}) => personId === id);
    return (
      <li key={id} className="relative">
        <div className="flex min-h-16 items-center gap-3.5 py-2 pr-14">
          <Avatar name={name} size={44} />
          <div className="flex min-w-0 flex-1 flex-col">
            <h2 className="text-row-title break-words">{name}</h2>
            {helperId ? (
              <p className="text-body font-semibold text-gold-ink">
                <Icon name="phone" size={18} className="mr-1 inline-block align-[-3px]" />{t("lookedAfter", {name: visibleMembers.get(helperId) ?? ""})}
              </p>
            ) : (
              <p className="text-body text-muted-ink">{t(`status.${status}`)}{device && ` · ${t(`device.${device.kind}` as Parameters<typeof t>[0])}`}</p>
            )}
            {member.needsNewKey && <p className="text-body font-semibold">{t("feedback.needsNewKey")}</p>}
            {request && (
              <p className="text-body font-semibold">{t("requestAt", {at: format.dateTime(request.at, activityDateFormat)})}{" "}
                <AppLink className="underline underline-offset-4" href={`/family/keys#member-${id}`}>{t("resetPin")}</AppLink>
              </p>
            )}
          </div>
        </div>
        <RowEditor label={t("editMember", {name})}>
          <FamilyForm action={updateMember.bind(null, id)} label={t("save")}>
            <MemberFields member={member} board={board} constraints={board.constraintsOpen} />
          </FamilyForm>
          {role === "member" && (
            <details className="flex flex-col gap-2">
              <summary className="fge-press inline-flex min-h-12 cursor-pointer list-none items-center px-1 text-body font-semibold text-danger underline underline-offset-4 [&::-webkit-details-marker]:hidden">
                {t("remove", {name})}
              </summary>
              <FamilyForm action={deleteMember.bind(null, id)} label={t("confirmRemove", {name})} variant="danger" />
            </details>
          )}
        </RowEditor>
      </li>
    );
  };

  return (
    <Screen back={setup ? (board.exchangeId ? `${hub}/people` : "/exchanges") : hub}
      actions={setup && board.exchangeId ? (unnamed
        ? <ButtonLink href={hub} transition="push" icon="arrow">{draw("setup.startExchange")}</ButtonLink>
        : <ButtonLink href={`${hub}/draw`} transition="push" icon="arrow">{draw("setup.nextDraw")}</ButtonLink>) : undefined}>
      {setup ? (
        <>
          <SetupSteps step={3} />
          <PageTitle title={draw("setup.housesTitle")} lead={unnamed ? draw("setup.startExchangeLead") : draw("setup.housesLead")} />
        </>
      ) : (
        <>
          <BackRow href={hub} parent={draw("season.running")} backLabel={ui("back")} />
          <PageTitle title={draw("season.peopleAndHouses")} lead={draw("season.peopleAndHousesLead")} />
        </>
      )}

      <KnitIn className="flex flex-col gap-3 px-edge pt-6">
        <Card flush className="px-5 pt-3 pb-1">
          {groups.map((group, index) => (
            <section key={group.id ?? "none"} aria-label={group.name} className={index ? "border-t-[1.5px] border-line pt-3" : undefined}>
              {group.id ? (
                <details className="group/house">
                  <summary className="fge-press flex min-h-12 cursor-pointer list-none items-center gap-2 text-body font-extrabold text-muted-ink [&::-webkit-details-marker]:hidden">
                    <span className="flex-1">{group.name}</span>
                    <Icon name="pencil" size={18} />
                  </summary>
                  <div className="flex flex-col gap-3 pb-3">
                    <FamilyForm action={updateHousehold.bind(null, group.id, false)} label={t("save")}>
                      <TextField label={t("householdName")} name="name" defaultValue={group.name} required maxLength={60} />
                    </FamilyForm>
                    <FamilyForm action={updateHousehold.bind(null, group.id, true)} label={t("remove", {name: group.name})} variant="soft" />
                  </div>
                </details>
              ) : <p className="flex min-h-12 items-center text-body font-extrabold text-muted-ink">{group.name}</p>}
              <ul className="fge-rows flex flex-col">{group.members.map(memberRow)}</ul>
            </section>
          ))}
          <div className="fge-rows flex flex-col border-t-[1.5px] border-line">
            <OpenRow summary={t("addMember")} icon="plus">
              <FamilyForm action={updateMember.bind(null, null)} label={t("addMember")} icon="plus">
                <MemberFields board={board} constraints />
              </FamilyForm>
            </OpenRow>
            <OpenRow summary={t("addHousehold")} icon="home">
              <FamilyForm action={updateHousehold.bind(null, null, false)} label={t("addHousehold")} icon="plus">
                <TextField label={t("householdName")} name="name" required maxLength={60} />
              </FamilyForm>
            </OpenRow>
          </div>
        </Card>

        <Card flush className="px-5 py-1">
          <h2 className="sr-only">{t("keepApart")}</h2>
          {board.pairs.filter(({personA, personB}) => visibleMembers.has(personA) && visibleMembers.has(personB)).length > 0 && (
            <ul className="fge-rows flex flex-col">
              {board.pairs.filter(({personA, personB}) => visibleMembers.has(personA) && visibleMembers.has(personB))
                .map(({personA, personB}) => (
                  <li key={`${personA}.${personB}`} className="flex flex-col gap-2 py-3">
                    <p className="flex items-center gap-2.5 text-row-title"><Icon name="shuffle" size={22} className="text-pine" />
                      {t("pairNames", {first: visibleMembers.get(personA)!, second: visibleMembers.get(personB)!})}</p>
                    {board.constraintsOpen && board.exchangeId &&
                      <FamilyForm action={updatePair.bind(null, board.exchangeId, [personA, personB])} label={t("removePair")} variant="soft" />}
                  </li>
                ))}
            </ul>
          )}
          {board.constraintsOpen && board.exchangeId && board.members.length >= 2 ? (
            <OpenRow summary={t("keepApart")} icon="plus">
              <FamilyForm action={updatePair.bind(null, board.exchangeId, null)} label={t("addPair")}>
                {(["first", "second"] as const).map((key) => (
                  <SelectField key={key} label={t(key)} name={key} defaultValue="" required>
                    <option value="" disabled>{t("choose")}</option>
                    {board.members.map(({id, name}) => <option key={id} value={id}>{name}</option>)}
                  </SelectField>
                ))}
              </FamilyForm>
            </OpenRow>
          ) : <p className="flex min-h-16 items-center text-body text-muted-ink">{t("keepApart")}</p>}
        </Card>
      </KnitIn>

      <section aria-labelledby="family-name" className="pb-8">
        <SectionHeading title={<span id="family-name">{board.familyName}</span>} />
        <div className="flex flex-col gap-3 px-edge">
          <Card flush className="px-5 py-1">
            <Rows as="ul">
              {[
                ...(board.canSendKeys ? [{href: "/family/keys", icon: "share" as const, title: t("sendKeys"), ours: true}] : []),
                {href: "/family/group-chat", icon: "message" as const, title: chat("title"), ours: true},
                {href: "/exchanges", icon: "gift" as const, title: draw("title"), ours: true},
                {href: "/lists", icon: "list" as const, title: lists("familyLists")},
                {href: "/notifications", icon: "bell" as const, title: unread ? inbox("bellUnread", {count: unread}) : inbox("title")},
                {href: "/account", icon: "user" as const, title: t("openAccount")},
              ].map(({href, icon, title, ours}) => (
                <li key={href}>
                  {/* pages built on Screen slide in; the others load as they always have */}
                  <AppLink href={href} transition={ours ? "push" : undefined} prefetch={false} className="fge-press block">
                    <ListRow as="span" lead={<IconDisc icon={icon} />} title={title} trail={<Chevron />} />
                  </AppLink>
                </li>
              ))}
            </Rows>
          </Card>
          {board.canSendKeys && (
            <Card className="flex flex-col gap-2">
              <h3 className="text-card-title">{t("coOrganizer")}</h3>
              <FamilyForm action={updateCoOrganizer} label={t("save")}>
                <SelectField label={t("coOrganizer")} name="coOrganizer" defaultValue={coOrganizer?.id ?? ""}>
                  <option value="">{t("none")}</option>
                  {board.members.filter(({role, helperId}) => role !== "organizer" && !helperId)
                    .map(({id, name}) => <option key={id} value={id}>{name}</option>)}
                </SelectField>
              </FamilyForm>
            </Card>
          )}
          {board.activity.length > 0 && (
            <Card className="flex flex-col gap-1">
              <h3 className="text-card-title">{t("familyActivity")}</h3>
              <ul className="fge-rows flex flex-col">
                {board.activity.map(({personId, kind, at, deviceKind}, index) => (
                  <li key={`${at.toISOString()}.${index}`} className="py-2.5 text-body">
                    <strong>{visibleMembers.get(personId)}</strong> {t(`event.${kind}`)} {deviceKind && t(`device.${deviceKind}` as Parameters<typeof t>[0])}{" "}
                    <time dateTime={at.toISOString()} className="text-muted-ink">{format.dateTime(at, activityDateFormat)}</time>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </section>
    </Screen>
  );
}

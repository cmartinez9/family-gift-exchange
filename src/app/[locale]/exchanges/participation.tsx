"use client";

import {useTranslations} from "next-intl";
import {useState} from "react";
import {Avatar} from "@/components/ui/avatar";
import {Button, TextButton} from "@/components/ui/button";
import {Icon, type IconName} from "@/components/ui/icon";
import {Sheet} from "@/components/ui/sheet";
import {manage} from "./actions";
import {DrawForm} from "./form";

type Person = {id: string; displayName: string; participating: boolean};

function Bullet({icon, children}: {icon: IconName; children: string}) {
  return (
    <p className="flex items-start gap-3 text-body font-semibold">
      <Icon name={icon} size={22} strokeWidth={2.3} className="mt-0.5 text-pine" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/**
 * Dropouts and late joiners after the draw. Each change re-knits only the loops it touches, so it asks
 * first, in a sheet that says who is affected and that nobody learns who.
 */
export function ParticipationRows({exchangeId, version, people}: {exchangeId: string; version: number; people: Person[]}) {
  const t = useTranslations("draw");
  const ui = useTranslations("ui");
  const [open, setOpen] = useState<Person | null>(null);
  const [shown, setShown] = useState<Person | null>(null);
  const person = open ?? shown;
  return (
    <>
      <ul className="fge-rows flex flex-col">
        {people.map((row) => (
          <li key={row.id} className="flex min-h-16 items-start gap-3 py-3">
            <Avatar name={row.displayName} size={44} />
            <div className="flex min-w-0 flex-1 flex-col items-start gap-1.5">
              <span className="text-row-title">{row.displayName}</span>
              <Button variant="small" icon={row.participating ? "minus" : "plus"}
                className={row.participating ? "bg-card-track! text-ink!" : undefined}
                onClick={() => {
                  setShown(row);
                  setOpen(row);
                }}>
                {t(row.participating ? "dropout" : "join", {name: row.displayName})}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {person && (
        <Sheet open={open !== null} onClose={() => setOpen(null)} closeLabel={ui("close")}
          title={person.participating ? t("season.dropoutTitle", {name: person.displayName}) : t("season.joinTitle", {name: person.displayName})}>
          {person.participating ? (
            <p className="text-body">{t("season.dropoutBody")}</p>
          ) : (
            <div className="flex flex-col gap-3">
              <Bullet icon="shuffle">{t("season.joinGets", {name: person.displayName})}</Bullet>
              <Bullet icon="eye">{t("season.joinOthers")}</Bullet>
              <Bullet icon="home">{t("season.joinHouse", {name: person.displayName})}</Bullet>
            </div>
          )}
          <DrawForm key={person.id} variant={person.participating ? "danger" : "card"} icon={person.participating ? undefined : "plus"}
            action={manage.bind(null, exchangeId, {
              kind: "participation", personId: person.id, status: person.participating ? "out" : "in", expectedVersion: version,
            })}
            label={person.participating ? t("season.dropoutConfirm", {name: person.displayName}) : t("season.joinConfirm", {name: person.displayName})}
            onDone={() => setOpen(null)} />
          <TextButton className="self-center" onClick={() => setOpen(null)}>
            {person.participating ? t("season.keepIn", {name: person.displayName}) : t("season.notYet")}
          </TextButton>
        </Sheet>
      )}
    </>
  );
}

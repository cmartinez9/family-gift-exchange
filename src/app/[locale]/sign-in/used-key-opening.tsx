"use client";

import {useEffect, useState} from "react";
import {useTranslations} from "next-intl";
import {noticeUsedKeyLink} from "./actions";
import {GroundNote} from "./pin-screens";

export function UsedKeyOpening({link, name, queued}: {link?: string; name?: string; queued?: boolean}) {
  const t = useTranslations("getIn.used");
  const [confirmedLink, setConfirmedLink] = useState<string>();
  const [openingId] = useState(() => crypto.randomUUID());
  useEffect(() => {
    if (!link || queued !== undefined) return;
    let active = true;
    void noticeUsedKeyLink(link, openingId).then((confirmed) => {
      if (active && confirmed) setConfirmedLink(link);
    }).catch(() => {});
    return () => { active = false; };
  }, [link, openingId, queued]);

  return name && (queued ?? (link && confirmedLink === link)) ? <GroundNote icon="bell">{t("told", {name})}</GroundNote> : null;
}

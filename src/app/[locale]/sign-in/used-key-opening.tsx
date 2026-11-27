"use client";

import {useEffect, useState} from "react";
import {useTranslations} from "next-intl";
import {noticeUsedKeyLink} from "./actions";
import {GroundNote} from "./pin-screens";

export function UsedKeyOpening({link, name, queued = false}: {link?: string; name?: string; queued?: boolean}) {
  const t = useTranslations("getIn.used");
  const [confirmedLink, setConfirmedLink] = useState<string>();
  useEffect(() => {
    if (!link) return;
    let active = true;
    void noticeUsedKeyLink(link).then((confirmed) => {
      if (active && confirmed) setConfirmedLink(link);
    }).catch(() => {});
    return () => { active = false; };
  }, [link]);

  return name && (link ? confirmedLink === link : queued) ? <GroundNote icon="bell">{t("told", {name})}</GroundNote> : null;
}

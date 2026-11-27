"use client";

import {useEffect, useState} from "react";
import {noticeUsedKeyLink} from "./actions";

export function useUsedKeyOpening({link, openingId, queued}: {link?: string; openingId: string; queued?: boolean}) {
  const [confirmedLink, setConfirmedLink] = useState<string>();
  useEffect(() => {
    if (!link || queued !== undefined) return;
    let active = true;
    void noticeUsedKeyLink(link, openingId).then((confirmed) => {
      if (active && confirmed) setConfirmedLink(link);
    }).catch(() => {});
    return () => { active = false; };
  }, [link, openingId, queued]);

  return queued ?? Boolean(link && confirmedLink === link);
}

export function UsedKeyOpening({link}: {link: string}) {
  const [openingId] = useState(() => crypto.randomUUID());
  useUsedKeyOpening({link, openingId});
  return null;
}

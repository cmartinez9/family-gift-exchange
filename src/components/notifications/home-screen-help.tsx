import {useTranslations} from "next-intl";

export function HomeScreenHelp() {
  const t = useTranslations("notify.install");

  return (
    <details className="mt-6 text-lg">
      <summary className="min-h-12 cursor-pointer py-3 underline">{t("prompt")}</summary>
      <h2 className="mt-3 font-semibold">{t("iphone")}</h2>
      <ol className="mt-2 list-decimal space-y-2 pl-6">
        <li>{t("iphoneOpen")}</li>
        <li>{t("iphoneShare")}</li>
        <li>{t("iphoneAdd")}</li>
        <li>{t("iphoneLaunch")}</li>
      </ol>
      <h2 className="mt-4 font-semibold">{t("android")}</h2>
      <ol className="mt-2 list-decimal space-y-2 pl-6">
        <li>{t("androidOpen")}</li>
        <li>{t("androidMenu")}</li>
        <li>{t("androidAdd")}</li>
        <li>{t("androidLaunch")}</li>
      </ol>
    </details>
  );
}

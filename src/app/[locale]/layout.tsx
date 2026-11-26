import "@/styles/tokens.css";
import type {Viewport} from "next";
import {AppChrome} from "@/components/ui/app-chrome";
import {rubik} from "@/styles/fonts";
import {hasLocale, NextIntlClientProvider} from "next-intl";
import {getTranslations, setRequestLocale} from "next-intl/server";
import {notFound} from "next/navigation";
import type {ReactNode} from "react";
import {RegisterNotificationWorker} from "@/components/notifications/register-worker";
import {routing} from "@/i18n/routing";
import {HelpingBanner} from "./helping/banner";

export async function generateMetadata({params}: {params: Promise<{locale: string}>}) {
  const {locale} = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const t = await getTranslations({locale, namespace: "home"});
  return {title: t("title"), icons: {apple: "/gift-192.png"}, manifest: `/${locale}/install.webmanifest`};
}

export function generateStaticParams() {
  return routing.locales.map((locale) => ({locale}));
}

export const viewport: Viewport = {viewportFit: "cover", themeColor: "#C8202F"};

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{locale: string}>;
}) {
  const {locale} = await params;

  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  setRequestLocale(locale);
  const ui = await getTranslations({locale, namespace: "ui"});

  return (
    <html lang={locale} className={rubik.variable}>
      <body>
        <NextIntlClientProvider messages={null}>
          <AppChrome tabsLabel={ui("tabs.label")} undoLabel={ui("undo")} tabs={{
            home: {label: ui("tabs.home"), href: "/"},
            list: {label: ui("tabs.list"), href: "/lists"},
            family: {label: ui("tabs.family"), href: "/family"},
          }} />
        </NextIntlClientProvider>
        <HelpingBanner />
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
        <RegisterNotificationWorker />
      </body>
    </html>
  );
}

import {hasLocale} from "next-intl";
import {notFound} from "next/navigation";
import {getTranslations} from "next-intl/server";
import {HomeScreenHelp} from "@/components/notifications/home-screen-help";
import {Link} from "@/i18n/navigation";
import {routing, type Locale} from "@/i18n/routing";
import {getViewer} from "@/server/auth";

import {HomeScreen} from "./_home/home-screen";
import {SignInScreen} from "./sign-in/screen";

const languageNames: Record<Locale, string> = {en: "English", es: "Español"};

type HomeProps = {params: Promise<{locale: string}>};

async function getPageLocale(params: HomeProps["params"]): Promise<Locale> {
  const {locale} = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  return locale;
}

export default async function HomePage({params}: HomeProps) {
  const locale = await getPageLocale(params);
  const viewer = await getViewer();
  if (viewer) return <HomeScreen viewer={viewer} />;
  const t = await getTranslations({locale, namespace: "home"});

  return (
    <main className="mx-auto max-w-xl space-y-5 p-6 text-lg">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <nav aria-label={t("language")} className="mt-4 flex gap-4">
        {routing.locales.map((language) => (
          <Link
            key={language}
            href="/"
            locale={language}
            lang={language}
            hrefLang={language}
            aria-current={locale === language ? "page" : undefined}
            className="inline-flex min-h-12 items-center underline"
          >
            {languageNames[language]}
          </Link>
        ))}
      </nav>
      <SignInScreen />
      <HomeScreenHelp />
    </main>
  );
}

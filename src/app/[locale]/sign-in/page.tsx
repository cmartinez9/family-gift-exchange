import {getTranslations} from "next-intl/server";
import {sectionClass} from "./styles";
import {SignInScreen} from "./screen";

export default async function SignInPage({searchParams}: {searchParams: Promise<{family?: string; person?: string; join?: string}>}) {
  const t = await getTranslations("auth");
  return (
    <main className={sectionClass}>
      <h1 className="text-2xl font-semibold">{t("signIn")}</h1>
      <SignInScreen search={await searchParams} />
    </main>
  );
}

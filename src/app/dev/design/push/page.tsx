import {notFound} from "next/navigation";
import {NextIntlClientProvider} from "next-intl";
import {Card, Fact, OnlyYou} from "@/components/ui/card";
import {BackRow, PageTitle, SectionHeading} from "@/components/ui/page-header";
import {Screen} from "@/components/ui/screen";
import {StitchedText} from "@/components/ui/knit/stitched-text";
import {ButtonLink} from "@/components/ui/button";

export const dynamic = "force-dynamic";
export const metadata = {title: "A pushed page · Design system"};

/** A pushed page, to see push, back and the edge swipe. Development only. */
export default function PushedPage() {
  if (process.env.NODE_ENV !== "development") {
    notFound();
  }
  return (
    <NextIntlClientProvider locale="en" messages={null}>
      <Screen ground="pine" back="../design" actions={<ButtonLink href="../design" transition="back" icon="back">Back to the gallery</ButtonLink>}>
        <BackRow href="../design" parent="Design system" backLabel="Back to" />
        <div className="flex flex-col gap-2 px-edge pt-2.5">
          <p className="text-card-title font-semibold">You&apos;re giving to</p>
          <StitchedText text="BETO" cell={7.5} />
          <OnlyYou>Only you can see this</OnlyYou>
        </div>
        <PageTitle title="A pushed page" lead="It came in from the right while the gallery slid 30% left and dimmed. Swipe from the left edge, or use the back row, to go back." />
        <SectionHeading title="About Beto" />
        <div className="px-edge pb-6">
          <Card>
            <div className="flex flex-col gap-2.5">
              <Fact icon="shirt">Tops L · Pants 32x32 · Shoes 10</Fact>
              <Fact icon="heart">Likes grilling and hiking</Fact>
            </div>
          </Card>
        </div>
      </Screen>
    </NextIntlClientProvider>
  );
}

"use client";

import {useState, useSyncExternalStore, type ReactNode} from "react";
import {NextIntlClientProvider} from "next-intl";
import {Avatar, YouButton} from "@/components/ui/avatar";
import {EmptyBlock, ErrorBlock, LoadingBlock} from "@/components/ui/blocks";
import {Button, ButtonLink, IconButton, TextButton, TextLink} from "@/components/ui/button";
import {Card, Chevron, Fact, IconDisc, ListRow, NoteTrack, OnlyYou, Rows, Track} from "@/components/ui/card";
import {Chip, ChoiceChips} from "@/components/ui/chip";
import {Countdown} from "@/components/ui/countdown";
import {ICON_NAMES, Icon} from "@/components/ui/icon";
import {Switch, TextArea, TextField, Tick} from "@/components/ui/inputs";
import {
  BudgetMeasure, HangingTag, HeartToggle, ItemCard, LoadingPicture, MineLine, NoPicture, StatusLine, WantsLine, YarnTag,
} from "@/components/ui/item-card";
import {KnitField, FairIsleBand} from "@/components/ui/knit/knit-svg";
import {KnitMotif} from "@/components/ui/knit/knit-motif";
import {MOTIFS, type MotifName} from "@/components/ui/knit/knit";
import {STITCH_CELL, StitchedText} from "@/components/ui/knit/stitched-text";
import {ModeBanner, modeActionClass} from "@/components/ui/mode-banner";
import {ClaimCard} from "@/components/ui/motion/claim";
import {HAPTIC_PATTERNS, haptic, type HapticKind} from "@/components/ui/motion/haptic";
import {KnitIn} from "@/components/ui/motion/knit-in";
import {useReducedMotion} from "@/components/ui/motion/reduced-motion";
import {UnravelReveal, type RevealLabels} from "@/components/ui/motion/unravel-reveal";
import {BackRow, CornerLabel, HomeTop, PageTitle, SectionHeading} from "@/components/ui/page-header";
import {Pass} from "@/components/ui/pass";
import {PinPad} from "@/components/ui/pin";
import {Screen} from "@/components/ui/screen";
import {Sheet} from "@/components/ui/sheet";
import {StepBar} from "@/components/ui/step-bar";
import {TabBar, TabBarHost, type TabKey} from "@/components/ui/tab-bar";
import {ToastHost, toast} from "@/components/ui/toast";
import {pinProblem} from "@/lib/pin-policy";
import {ProductStandIn} from "./stand-ins";

const COLORS: ReadonlyArray<[string, string, string]> = [
  ["Sweater red", "--color-sweater-red", "#C8202F"], ["Pin slot red", "--color-pin-slot-red", "#9C1525"],
  ["Pine", "--color-pine", "#12573A"], ["Gold", "--color-gold", "#EDB43E"], ["Yarn white", "--color-yarn-white", "#FFF8EF"],
  ["Oat rose", "--color-oat-rose", "#EADBD7"], ["Ink", "--color-ink", "#1B1416"], ["Muted ink", "--color-muted-ink", "#5F5456"],
  ["Gold ink", "--color-gold-ink", "#4A3512"], ["Pale pine", "--color-pale-pine", "#D3E6DC"], ["Danger", "--color-danger", "#A61B29"],
  ["Track", "--card-track", "#F2E7D5"], ["Track on gold", "--card-track-next", "#DBA533"], ["Track on pine", "--card-track-mine", "#2A6A4E"],
  ["Track on rose", "--card-track-taken", "#E0CFCA"],
];

const TYPE: ReadonlyArray<[string, string, string]> = [
  ["Title 36/800", "text-title", "My list"], ["Sheet title 28/800", "text-sheet-title", "Add something"],
  ["Section 22/800", "text-section", "The rest of the family"], ["Card title 20/800", "text-card-title", "Add a few things to your list"],
  ["Item title 20/700", "text-item-title", "Cozy slipper socks"], ["Button 20/700", "text-button", "Yes, it's my phone"],
  ["Lead 19/400", "text-lead", "Marco sent you this key. It's just for you."], ["Row title 19/700", "text-row-title", "My sizes"],
  ["Body 18/500", "text-body", "Everyone can see it. You never see who is getting what."], ["Body strong 18/700", "text-body-strong", "I'm getting this"],
  ["Tab 17/500", "text-tab", "Family"], ["Label 13/800 caps", "text-label uppercase", "Christmas 2026"], ["Keypad 30/500", "text-keypad", "1 2 3"],
];

const REVEAL_LABELS: RevealLabels = {
  ready: "Your person is ready", readyHint: "Press and hold the gift to pull the yarn.", holding: "Keep holding",
  holdingHint: "The gift is coming undone, row by row.", holdLonger: "Hold a little longer.", letGo: "Let go any time. Hold to keep pulling.",
  watching: "Keep watching", watchingHint: "The yarn is knitting a name.", tapToOpen: "Or tap here to open it",
  gift: "The knitted gift. Press and hold to pull the yarn, or use the link below.", progress: "Unravelling",
  lead: "You're giving to", onlyYou: "Only you can see this",
};

const TABS: Readonly<Record<TabKey, {label: string; href: string}>> = {
  home: {label: "Home", href: "?tab=home"}, list: {label: "My list", href: "?tab=list"}, family: {label: "Family", href: "?tab=family"},
};

const SIZES = ["XS", "S", "M", "L", "XL", "2XL"].map((size) => ({value: size, label: size}));

const noSubscribe = () => () => {};

function Section({id, title, lead, children}: {id: string; title: string; lead?: string; children: ReactNode}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="flex flex-col gap-3 pt-10">
      <div className="flex flex-col gap-1 px-edge">
        <h2 id={`${id}-title`} className="text-section">{title}</h2>
        {lead && <p className="text-body">{lead}</p>}
      </div>
      {children}
    </section>
  );
}

function Pad({children, className = ""}: {children: ReactNode; className?: string}) {
  return <div className={`flex flex-col gap-3 px-edge ${className}`}>{children}</div>;
}

function Demo({title, children}: {title: string; children: ReactNode}) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="px-edge text-card-title">{title}</h3>
      {children}
    </div>
  );
}

function PinDemo() {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<[string, string] | null>(null);
  const [shake, setShake] = useState(0);
  const [bad, setBad] = useState(false);
  const [made, setMade] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-4 px-edge">
      <div className="flex flex-col gap-2">
        <p className="text-title">{made ? "PIN made" : "Make a 4-digit PIN"}</p>
        <p className="text-lead">{made ? "You'll use it to get back in." : "Try 1958, 1225 or 1234 to see a refusal."}</p>
      </div>
      <PinPad value={pin} slotsLabel={`${pin.length} of 4 digits`} deleteLabel="Delete" bad={bad} shakeKey={shake}
        onChange={(next) => {
          if (next.length && bad) setBad(false);
          if (next.length === 1) setError(null);
          setPin(next);
        }}
        onComplete={(next) => {
          window.setTimeout(() => {
            const why = pinProblem(next, next);
            if (why) {
              haptic("error");
              setError(why === "pinDate"
                ? [`${next} looks like a date or year`, "Family can guess those. Try 4 other numbers."]
                : ["That one is easy to guess", "Try 4 numbers that don't repeat or run in order."]);
              setBad(true);
              setShake((count) => count + 1);
              setPin("");
              return;
            }
            haptic("success");
            setMade(next);
            setPin("");
          }, 260);
        }} />
      {error
        ? <div className="fge-drop"><ErrorBlock title={error[0]}>{error[1]}</ErrorBlock></div>
        : <p className="flex items-center justify-center gap-2.5 text-body"><Icon name="lock" size={20} />Not a birthday or a year.</p>}
    </div>
  );
}

function ClaimDemo() {
  const [claimed, setClaimed] = useState(false);
  const claim = () => {
    setClaimed(true);
    window.setTimeout(() => toast({message: "Marked. Only you know it was you.", undo: () => setClaimed(false)}), 420);
  };
  return (
    <Pad>
      <ClaimCard claimed={claimed}
        base={<ItemCard titleAs="h4" tag="space" picture={<ProductStandIn kind="socks" />} title="Cozy slipper socks" store="Walmart" price="$12.97"
          details={<>
            <WantsLine>Ana really wants this</WantsLine>
            <Button variant="small" icon="gift" className="mt-2.5" data-claim-origin="" onClick={claim}>I&apos;m getting this</Button>
          </>} />}
        mine={<ItemCard titleAs="h4" tag="space" tone="mine" picture={<ProductStandIn kind="socks" />} title="Cozy slipper socks" store="Walmart" price="$12.97"
          details={<p className="flex items-center gap-1.5 pt-0.5 text-body font-semibold">Ana really wants this</p>}
          after={<MineLine action={<TextButton onClick={() => setClaimed(false)}>Undo</TextButton>}>You&apos;re getting this</MineLine>} />} />
    </Pad>
  );
}

function RevealDemo() {
  const [round, setRound] = useState(0);
  const [revealed, setRevealed] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <div className="mx-auto w-full max-w-[390px] overflow-hidden rounded-[28px] bg-sweater-red outline-2 outline-white/30" data-demo="reveal">
        <UnravelReveal key={round} name="BETO" titleAs="h4" labels={REVEAL_LABELS} onRevealed={() => setRevealed(true)}
          next={<>
            <Button icon="arrow" onClick={() => toast("In the app this opens Beto's list.")}>See Beto&apos;s list</Button>
            <p className="pt-1 text-center text-body">Then your sizes and your list.</p>
          </>} />
      </div>
      <Pad>
        <Button variant="outline" icon="undo" onClick={() => {
          setRevealed(false);
          setRound((count) => count + 1);
        }}>{revealed ? "Wrap the gift again" : "Start over"}</Button>
      </Pad>
    </div>
  );
}

function SheetDemo() {
  const [add, setAdd] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [ask, setAsk] = useState(false);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  return (
    <Pad>
      <Button icon="plus" onClick={() => setAdd(true)}>Add something</Button>
      <Button variant="outline" onClick={() => setAsk(true)}>Ask Beto a question</Button>
      <Button variant="outline" onClick={() => setConfirm(true)}>Sign out everywhere</Button>
      <Sheet open={add} onClose={() => setAdd(false)} title="Add something" closeLabel="Close">
        <Rows>
          {([["pencil", "Write it down", "Like \"gift card for coffee\""], ["link", "Paste a link", "From a store app or website"],
            ["camera", "Take a photo", "Of the thing, or a screenshot"]] as const).map(([icon, title, sub]) => (
            <button key={title} type="button" className="fge-press w-full cursor-pointer text-left" onClick={() => setAdd(false)}>
              <ListRow as="span" lead={<IconDisc icon={icon} size={52} iconSize={24} />} title={title} sub={sub} trail={<Chevron />} className="min-h-[76px]" />
            </button>
          ))}
        </Rows>
      </Sheet>
      <Sheet open={ask} onClose={() => setAsk(false)} title="Ask Beto" closeLabel="Close">
        <p className="text-body text-muted-ink">He won&apos;t know it&apos;s you. Only you see his answer.</p>
        <div className="flex flex-wrap gap-2">
          {["What size?", "Which color?", "Do you have this?"].map((text) => (
            <Chip key={text} pressed={suggestion === text} onPressedChange={(on) => setSuggestion(on ? text : null)}>{text}</Chip>
          ))}
        </div>
        <TextArea label="Your question" placeholder="Type a question" defaultValue="" />
        <Button variant="card" icon="message" onClick={() => {
          setAsk(false);
          haptic("success");
          window.setTimeout(() => toast("Question sent"), 300);
        }}>Send my question</Button>
      </Sheet>
      <Sheet open={confirm} onClose={() => setConfirm(false)} title="Sign out everywhere?" closeLabel="Close">
        <p className="text-body">Every phone signed in as Rosa will need Face ID or the PIN again. This cannot be undone.</p>
        <Button variant="danger" onClick={() => setConfirm(false)}>Yes, sign out everywhere</Button>
        <TextButton className="self-center" onClick={() => setConfirm(false)}>Cancel</TextButton>
      </Sheet>
    </Pad>
  );
}

function MotionSwitch() {
  const reduced = useReducedMotion();
  return (
    <Card className="mx-edge">
      <div className="flex items-center gap-3">
        <div className="flex flex-1 flex-col">
          <p className="text-card-title">Reduce motion</p>
          <p className="text-body text-muted-ink">Follows the phone&apos;s setting; this switch previews it.</p>
        </div>
        <Switch label="Reduce motion" checked={reduced} onCheckedChange={(on) => {
          if (on) document.documentElement.dataset.motion = "reduce";
          else delete document.documentElement.dataset.motion;
        }} />
      </div>
    </Card>
  );
}

export function Gallery({tab}: {tab: TabKey}) {
  const [replay, setReplay] = useState(0);
  const [sizes, setSizes] = useState<string | null>("M");
  const [noClothes, setNoClothes] = useState(false);
  const [want, setWant] = useState(true);
  const [newItems, setNewItems] = useState<string[]>([]);
  const [step, setStep] = useState(2);
  const vibrate = useSyncExternalStore(noSubscribe, () => typeof navigator.vibrate === "function", () => false);

  return (
    <NextIntlClientProvider locale="en" messages={null}>
      <Screen tab={tab} tabHrefs={{home: TABS.home.href, list: TABS.list.href, family: TABS.family.href}}>
        <HomeTop season={["Design system", "Sweater Weather"]} you={<YouButton href="design/push" name="Rosa" label="You" newLabel="something is new" hasNew />} />
        <Countdown days={24} unit="days to gift day" line="Thursday, Dec 24 · 7 pm · Ana's house" knit key={`count-${replay}`} />
        <div className="pt-3"><FairIsleBand kind="zig" cell={4.6} /></div>
        <PageTitle title="The design system" lead="Every component, state and motion of Sweater Weather. Development only." />
        <div className="pt-4"><MotionSwitch /></div>

        <Section id="colors" title="Colour" lead="Red ground, three yarns, ink. The colour says what a card is; words say it too.">
          <ul className="grid grid-cols-3 gap-3 px-edge">
            {COLORS.map(([name, token, hex]) => (
              <li key={token} className="flex flex-col gap-1.5">
                <span className="h-14 rounded-[18px] outline-2 -outline-offset-2 outline-white/40" style={{background: `var(${token})`}} />
                <span className="text-body leading-tight font-bold">{name}</span>
                <code className="text-body leading-tight">{hex}</code>
              </li>
            ))}
          </ul>
        </Section>

        <Section id="type" title="Type" lead="Rubik, one scale. Every sentence is 18px or more.">
          <Pad>
            {TYPE.map(([name, className, sample]) => (
              <div key={name} className="flex flex-col">
                <p className="text-label uppercase">{name}</p>
                <p className={className}>{sample}</p>
              </div>
            ))}
          </Pad>
        </Section>

        <Section id="stitched" title="Stitched lettering" lead="Names, numbers and moments only. Yarn white on red or pine.">
          <Pad>
            <Button variant="outline" icon="undo" onClick={() => setReplay((count) => count + 1)}>Knit them again</Button>
          </Pad>
          <div className="flex flex-col items-center gap-4 py-2" key={`stitch-${replay}`}>
            <StitchedText as="p" text="HI" cell={STITCH_CELL.greeting} knit stepMs={7} />
            <StitchedText as="p" text="ROSA!" cell={STITCH_CELL.greeting} knit stepMs={5} delayMs={180} />
            <StitchedText as="p" text="ALL" cell={STITCH_CELL.greeting} knit />
            <StitchedText as="p" text="SET!" cell={STITCH_CELL.greeting} knit delayMs={150} />
            <StitchedText as="p" text="BETO" cell={STITCH_CELL.revealedName} />
            <StitchedText as="p" text="BETO" cell={STITCH_CELL.personPage} />
            <StitchedText as="p" text="BETO" cell={STITCH_CELL.pass} />
            <StitchedText as="p" text="TODAY" cell={STITCH_CELL.today} />
            <StitchedText as="p" text="0123456789" cell={4.5} />
          </div>
          <Pad>
            <p className="text-body">A name with a letter the alphabet has not drawn yet (J, É) falls back to heavy Rubik:</p>
            <StitchedText as="p" text="José" cell={STITCH_CELL.personPage} />
          </Pad>
        </Section>

        <Section id="knit" title="Knit" lead="V stitches, two leaves each. Bands run full bleed and never carry text.">
          <div className="flex flex-wrap items-end justify-center gap-6 px-edge">
            {(Object.keys(MOTIFS) as MotifName[]).map((name) => (
              <div key={name} className="flex flex-col items-center gap-2">
                <KnitMotif name={name} cell={name === "gift" || name === "lock" ? 6 : 6.5} label={`Knitted ${name}`} />
                <span className="text-body">{name}</span>
              </div>
            ))}
          </div>
          <Demo title="Fair Isle bands">
            <div className="flex flex-col gap-4">
              <FairIsleBand kind="zig" cell={4.6} />
              <FairIsleBand kind="trees" cell={8.5} />
              <FairIsleBand kind="flake" cell={7} />
            </div>
          </Demo>
          <Demo title="Tone-on-tone knit">
            <div className="flex items-center gap-4 px-edge">
              <NoPicture />
              <NoPicture on="next" camera={false} />
              <LoadingPicture size={72} />
              <span className="relative block h-[72px] w-24 overflow-hidden rounded-[24px] bg-[#B51B2A]">
                <KnitField stitch="var(--color-sweater-red)" cell={15} className="absolute inset-0" />
              </span>
              <YarnTag />
            </div>
          </Demo>
        </Section>

        <Section id="cards" title="Yarn blocks" lead="Flat and borderless. Cream for information, gold for needs you, pine for yours, rose for taken.">
          <Pad>
            <Card>
              <p className="text-card-title">Thursday, Dec 24 · 7 pm</p>
              <p className="pt-2 text-body text-muted-ink">Ana&apos;s house · $50 each</p>
            </Card>
            <Card tone="next">
              <p className="text-card-title">Add a few things to your list</p>
              <p className="pt-0.5 text-body text-gold-ink">Lists are due Saturday, Dec 5.</p>
              <Button variant="card" icon="plus" className="mt-3.5">Add to my list</Button>
            </Card>
            <Pass name="BETO" lead="You're giving to" onlyYou="Only you can see this" budget="$50" href="design/push" openLabel="Open Beto's page" />
            <Card tone="taken">
              <p className="text-card-title">Someone is getting this</p>
              <p className="pt-0.5 text-body text-muted-ink">Rose means someone else has it.</p>
            </Card>
            <Card flush className="px-[18px] py-1">
              <Rows as="ul">
                <ListRow as="li" lead={<Avatar name="Marco" />} title="Marco" sub="5 things" trail={<Chevron />} />
                <ListRow as="li" lead={<Avatar name="Tito" />} title="Tito" sub="You help him · 3 things" trail={<Chevron />} />
                <ListRow as="li" lead={<Avatar name="Ana" />} title="Ana" sub="6 things" trail={<Chevron />} />
                <ListRow as="li" lead={<IconDisc icon="shirt" />} title="My sizes" sub="Tops M · Shoes 7½" trail={<Chevron />} />
              </Rows>
            </Card>
            <Card>
              <Track><p className="text-body">A track holds notes, fields and chips.</p></Track>
              <div className="flex flex-col gap-2.5 pt-3">
                <Fact icon="shirt">Tops L · Pants 32x32 · Shoes 10</Fact>
                <Fact icon="heart">Likes grilling and hiking</Fact>
              </div>
            </Card>
            <Card tone="mine">
              <p className="text-card-title">Your wrapped gift</p>
              <Track className="mt-3"><p className="text-body">Tracks take their card&apos;s tone.</p></Track>
              <OnlyYou className="pt-3">Only you can see this</OnlyYou>
            </Card>
          </Pad>
        </Section>

        <Section id="items" title="Gift items" lead="A 72px picture, the title, store and price, then a note, status, action or budget.">
          <Pad>
            <ItemCard picture={<ProductStandIn kind="robe" />} title="Fleece robe" store="Target" price="$39.99" note="Size M, any dark color"
              heart={<HeartToggle on={want} label="Really want this" onToggle={() => {
                haptic("tick");
                setWant(!want);
              }} />} />
            <ItemCard tone="taken" picture={<ProductStandIn kind="coffee" />} title="Pour-over coffee set" store="Target" price="$32.00"
              details={<StatusLine>Someone is getting this</StatusLine>} />
            <ItemCard tone="mine" tag picture={<ProductStandIn kind="baking" />} title="Sourdough baking book" store="Amazon" price="$24.50"
              note="The one with the blue cover" after={<MineLine action={<TextButton>Undo</TextButton>}>You&apos;re getting this</MineLine>} />
            <ItemCard picture={<ProductStandIn kind="hikesocks" size={64} />} title="Wool hiking socks, 3 pack" store="REI" price="$27.00"
              details={<BudgetMeasure price={27} budget={50} underLabel="of $50" overLabel="Over $50" />} />
            <ItemCard picture={<ProductStandIn kind="earbuds" size={64} />} title="Wireless earbuds" store="Best Buy" price="$79.99"
              details={<BudgetMeasure price={79.99} budget={50} underLabel="of $50" overLabel="Over $50" />} />
            <ItemCard tone="next" picture={<NoPicture on="next" />} title="Large Print Crosswords, Vol. 2" store="amazon.com"
              after={<><p className="pt-3 text-body">Couldn&apos;t get a picture from Amazon.</p><Button variant="small" icon="camera" className="mt-2.5">Add a photo</Button></>} />
            <ItemCard picture={<ProductStandIn kind="pruners" />} title="Garden pruners" store="Walmart" price="$24.97" tag
              details={<StatusLine icon="check">You marked this</StatusLine>} />
            <NoteTrack>A note can also stand alone on a card.</NoteTrack>
          </Pad>
          <Demo title="Hanging tag">
            <Pad><div className="relative h-16"><HangingTag className="right-1/2" /></div></Pad>
          </Demo>
        </Section>

        <Section id="buttons" title="Buttons" lead="One white pill per screen. Pressed: scale 0.97 and 6% darker, 120ms.">
          <Pad>
            <Button icon="arrow">Yes, it&apos;s my phone</Button>
            <Button variant="outline">No, I&apos;m helping Rosa</Button>
            <Button disabled>Waiting for Target…</Button>
            <div className="flex justify-center"><TextButton>En español</TextButton></div>
            <Card>
              <div className="flex flex-col gap-2">
                <Button variant="card" icon="message">Send my question</Button>
                <Button variant="small" icon="share">Send</Button>
                <Button variant="soft" icon="link">Paste a link</Button>
                <Button variant="danger">Yes, take Beto out</Button>
                <TextLink href="design/push" transition="push" className="self-center">Something wrong?</TextLink>
              </div>
            </Card>
            <div className="flex items-center gap-3">
              <IconButton icon="back" label="Back" tone="ground" />
              <IconButton icon="close" label="Close" tone="track" />
              <IconButton icon="chevron" label="Open" tone="white" />
              <IconButton icon="plus" label="Add" tone="ink" />
            </div>
          </Pad>
        </Section>

        <Section id="navigation" title="Navigation" lead="Three tabs; pushed pages have a back row; modes have one ink banner.">
          <Demo title="The tab bar">
            <Pad>
              <p className="text-body">The real bar floats at the bottom. This one switches here:</p>
              <div className="relative h-[72px]">
                <div className="absolute inset-0 [&_nav]:absolute [&_nav]:inset-x-0 [&_nav]:bottom-0 [&_nav]:[view-transition-name:none]">
                  <TabBar label="Tabs, demo" active={tab} items={(Object.keys(TABS) as TabKey[]).map((key) => ({
                    key, href: TABS[key].href, label: TABS[key].label, icon: key === "list" ? "list" : key,
                  }))} />
                </div>
              </div>
            </Pad>
          </Demo>
          <Demo title="Back row and page title">
            <BackRow href="design/push" parent="Family" backLabel="Back to" right={<TextLink href="design/push" transition="push">Something wrong?</TextLink>} />
            <div className="flex items-center gap-3.5 px-edge pt-3">
              <Avatar name="Ana" size={56} on="ground" />
              <p className="text-title">Ana&apos;s list</p>
            </div>
            <PageTitle as="h2" title="My list" count="4 things" lead="Everyone can see it. You never see who is getting what." />
            <SectionHeading as="h3" title="The rest of the family" count="5 people" />
            <div className="px-edge"><CornerLabel lines={["Christmas", "2026"]} /></div>
          </Demo>
          <Demo title="Mode banner">
            <ModeBanner icon="user" label="Mode" action={<button type="button" className={modeActionClass}>Done</button>}>You&apos;re helping Tito</ModeBanner>
          </Demo>
          <Demo title="Push and back">
            <Pad>
              <ButtonLink href="design/push" transition="push" icon="arrow">Open a pushed page</ButtonLink>
            </Pad>
          </Demo>
        </Section>

        <Section id="inputs" title="Inputs" lead="Fields are 56px track pills; chips are 48px and picked is ink.">
          <Pad>
            <Card>
              <div className="flex flex-col gap-4">
                <TextField label="What would you like?" placeholder="A few words is fine" autoComplete="off" />
                <TextField label="On a white field" surface="white" placeholder="Like gift card for coffee" autoComplete="off" />
                <ChoiceChips legend="Tops" name="tops" options={SIZES} value={sizes} onChange={setSizes} />
                <div className="flex flex-wrap gap-2">
                  <Chip pressed>Picked</Chip>
                  <Chip>Not picked</Chip>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex flex-1 flex-col">
                    <p className="text-card-title">No clothes, please</p>
                    <p className="text-body text-muted-ink">Skip sizes altogether</p>
                  </div>
                  <Switch label="No clothes, please" checked={noClothes} onCheckedChange={(on) => {
                    haptic("light");
                    setNoClothes(on);
                  }} />
                </div>
                <div className="flex items-center gap-3"><Tick done /><span className="text-body">Done</span><Tick done={false} /><span className="text-body">Not yet</span></div>
                <div className="flex items-center gap-2">
                  <Avatar name="Rosa" size={44} /><Avatar name="Beto" /><Avatar name="Leo" size={56} /><Avatar name="Ana" size={64} />
                </div>
              </div>
            </Card>
          </Pad>
        </Section>

        <Section id="pin" title="PIN" lead="Four slots and a digits-only keypad. A refused PIN rings the slots gold and says why.">
          <PinDemo />
        </Section>

        <Section id="steps" title="Step bar" lead="A finished strip knits up, 14ms a stitch; the next one lights gold.">
          <div key={`steps-${step}`}>
            <StepBar id="gallery" step={step} total={4} progress={step > 4 ? "All 4 steps done" : `Step ${step} of 4`}
              name={["Sign in", "Your person", "Your sizes", "Your list"][step - 1]} done={step > 4} />
          </div>
          <StepBar id="gallery-setup" step={4} total={5} progress="Step 4 of 5" name="Draw names" />
          <StepBar id="gallery-wait" step={3} total={4} progress="Step 3 of 4" name="Your sizes" waitingStep={2} />
          <Pad>
            <div className="flex gap-2">
              <div className="flex-1"><Button variant="outline" onClick={() => setStep((value) => Math.max(1, value - 1))}>Back a step</Button></div>
              <div className="flex-1"><Button variant="outline" onClick={() => setStep((value) => Math.min(5, value + 1))}>Next step</Button></div>
            </div>
          </Pad>
        </Section>

        <Section id="countdown" title="Countdown">
          <Countdown days={13} unit="days to gift day" line="Thursday, Dec 24 · 7 pm · Ana's house" />
          <Countdown days={0} unit="days to gift day" line="Today, 7 pm · Ana's house" />
        </Section>

        <Section id="blocks" title="Empty, loading and error">
          <Pad>
            <EmptyBlock title="Add your first thing" titleAs="h3" actions={<>
              <Button variant="card" icon="pencil">Write it down</Button>
              <div className="flex gap-2"><div className="flex-1"><Button variant="soft" icon="link">Paste a link</Button></div><div className="flex-1"><Button variant="soft" icon="camera">Photo</Button></div></div>
            </>}>A few words is enough. Like &quot;gift card for coffee&quot;.</EmptyBlock>
            <LoadingBlock title="Getting the picture from Target">Saved. The picture is on its way.</LoadingBlock>
            <ErrorBlock title="Couldn't save that" live={false} action={<Button variant="card" icon="undo">Try again</Button>}>Check your connection. Nothing was lost.</ErrorBlock>
          </Pad>
        </Section>

        <Section id="sheets" title="Sheets" lead="Rise 420ms; drag down, tap the scrim, the close disc or Escape to close.">
          <SheetDemo />
        </Section>

        <Section id="toasts" title="Toasts" lead="One ink toast. Undo instead of a confirm for anything reversible.">
          <Pad>
            <Button variant="outline" onClick={() => toast("Added to your list")}>Show a toast</Button>
            <Button variant="outline" onClick={() => toast({message: "Took off the crosswords", undo: () => toast("Back on your list")})}>Toast with Undo</Button>
            <Button variant="outline" onClick={() => toast({message: "No connection. You can still look around.", icon: "alert", placement: "top"})}>No connection</Button>
          </Pad>
        </Section>

        <Section id="motion" title="Motion" lead="Quick interface motion; slow, physical moments.">
          <Demo title="Knit-in: new items arrive">
            <Pad>
              <Button variant="outline" icon="plus" onClick={() => setNewItems((items) => [...items, `Thing ${items.length + 1}`])}>Add an item</Button>
              <KnitIn as="ul" className="flex flex-col gap-3" key={newItems.length}>
                {newItems.slice(-6).map((name) => (
                  <li key={name}><Card size="item"><p className="text-item-title">{name}</p></Card></li>
                ))}
              </KnitIn>
            </Pad>
          </Demo>
          <Demo title="The claim: the dye and the yarn tag">
            <ClaimDemo />
          </Demo>
          <Demo title="The reveal: hold to unravel">
            <RevealDemo />
          </Demo>
        </Section>

        <Section id="haptics" title="Haptics" lead={vibrate ? "This phone can vibrate." : "No web vibration here (iPhone Safari has none); haptics are never the only signal."}>
          <Pad>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(HAPTIC_PATTERNS) as HapticKind[]).map((kind) => (
                <Chip key={kind} onPressedChange={() => haptic(kind)}>{kind}</Chip>
              ))}
            </div>
          </Pad>
        </Section>

        <Section id="icons" title="Icons" lead="One set: 24px grid, round caps, always next to a word.">
          <ul className="grid grid-cols-6 gap-3 px-edge pb-10">
            {ICON_NAMES.map((name) => (
              <li key={name} className="flex flex-col items-center gap-1" title={name}>
                <Icon name={name} />
                <span className="sr-only">{name}</span>
              </li>
            ))}
          </ul>
        </Section>
      </Screen>
      <TabBarHost label="Tabs" tabs={TABS} />
      <ToastHost undoLabel="Undo" />
    </NextIntlClientProvider>
  );
}


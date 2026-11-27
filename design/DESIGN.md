---
name: Family Gift Exchange v2, Sweater Weather (final)
description: A sweater-red phone app. Flat yarn-block cards whose colour says what they are, stitched lettering only for names, numbers and moments, and one reveal where your person unravels out of a knitted gift.
colors:
  sweater-red: "#C8202F"
  pin-slot-red: "#9C1525"
  yarn-white: "#FFF8EF"
  snow-white: "#FFFFFF"
  pine: "#12573A"
  pine-tone: "#1A6646"
  gold: "#EDB43E"
  ink: "#1B1416"
  muted-ink: "#5F5456"
  gold-ink: "#4A3512"
  pale-pine: "#D3E6DC"
  oat-rose: "#EADBD7"
  danger: "#A61B29"
  line: "#EADFCD"
  card-info: "#FFF8EF"
  card-next: "#EDB43E"
  card-mine: "#12573A"
  card-taken: "#EADBD7"
  card-track: "#F2E7D5"
  card-track-next: "#DBA533"
  card-track-mine: "#2A6A4E"
  card-track-taken: "#E0CFCA"
  on-ground: "rgba(255, 255, 255, 0.16)"
  sheet-scrim: "rgba(40, 6, 10, 0.55)"
typography:
  title:
    fontFamily: "Rubik, system-ui, sans-serif"
    fontSize: "36px"
    fontWeight: 800
    lineHeight: "38px"
    letterSpacing: "-0.02em"
  sheet-title:
    fontFamily: "Rubik, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 800
    lineHeight: "32px"
    letterSpacing: "-0.01em"
  section:
    fontFamily: "Rubik, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 800
    lineHeight: "27px"
    letterSpacing: "0"
  card-title:
    fontFamily: "Rubik, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 800
    lineHeight: "26px"
    letterSpacing: "0"
  item-title:
    fontFamily: "Rubik, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 700
    lineHeight: "26px"
    letterSpacing: "0"
  button:
    fontFamily: "Rubik, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 700
    lineHeight: "26px"
    letterSpacing: "0"
  lead:
    fontFamily: "Rubik, system-ui, sans-serif"
    fontSize: "19px"
    fontWeight: 400
    lineHeight: "27px"
    letterSpacing: "0"
  row-title:
    fontFamily: "Rubik, system-ui, sans-serif"
    fontSize: "19px"
    fontWeight: 700
    lineHeight: "27px"
    letterSpacing: "0"
  body:
    fontFamily: "Rubik, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 500
    lineHeight: "25px"
    letterSpacing: "0"
  body-strong:
    fontFamily: "Rubik, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 700
    lineHeight: "25px"
    letterSpacing: "0"
  tab:
    fontFamily: "Rubik, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 500
    lineHeight: "22px"
    letterSpacing: "0"
  label:
    fontFamily: "Rubik, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 800
    lineHeight: "16px"
    letterSpacing: "0.06em"
  keypad:
    fontFamily: "Rubik, system-ui, sans-serif"
    fontSize: "30px"
    fontWeight: 500
    lineHeight: "32px"
    letterSpacing: "0"
rounded:
  pill: "999px"
  sheet: "34px"
  card: "32px"
  item: "28px"
  key: "24px"
  track: "22px"
  pin-slot: "22px"
  picture: "18px"
  app-icon: "13px"
spacing:
  xs: "4px"
  sm: "8px"
  card-gap: "12px"
  card-pad-item: "16px"
  edge: "20px"
  card-pad: "20px"
  group: "24px"
  bottom: "34px"
components:
  card:
    backgroundColor: "{colors.card-info}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "20px"
    width: "350px"
  card-next:
    backgroundColor: "{colors.card-next}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "18px 20px 20px"
  card-mine:
    backgroundColor: "{colors.card-mine}"
    textColor: "{colors.snow-white}"
    rounded: "{rounded.card}"
    padding: "18px 18px 18px 20px"
  item:
    backgroundColor: "{colors.card-info}"
    textColor: "{colors.ink}"
    typography: "{typography.item-title}"
    rounded: "{rounded.item}"
    padding: "16px"
    width: "350px"
  item-taken:
    backgroundColor: "{colors.card-taken}"
    textColor: "{colors.ink}"
    rounded: "{rounded.item}"
    padding: "16px"
  track:
    backgroundColor: "{colors.card-track}"
    rounded: "{rounded.track}"
    padding: "12px 16px"
  button-ground:
    backgroundColor: "{colors.snow-white}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    height: "64px"
    padding: "0 24px"
  button-outline:
    textColor: "{colors.snow-white}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    height: "60px"
    padding: "0 24px"
  button-card:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.snow-white}"
    typography: "{typography.body-strong}"
    rounded: "{rounded.pill}"
    height: "52px"
    padding: "0 24px"
  button-small:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.snow-white}"
    typography: "{typography.body-strong}"
    rounded: "{rounded.pill}"
    height: "48px"
    padding: "0 18px"
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.snow-white}"
    typography: "{typography.body-strong}"
    rounded: "{rounded.pill}"
    height: "56px"
  text-link:
    typography: "{typography.body}"
    height: "48px"
  tab-bar:
    backgroundColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    height: "72px"
    padding: "8px"
  tab-active:
    backgroundColor: "{colors.snow-white}"
    textColor: "{colors.ink}"
    typography: "{typography.tab}"
    rounded: "{rounded.pill}"
    height: "56px"
  back-button:
    backgroundColor: "{colors.on-ground}"
    textColor: "{colors.snow-white}"
    rounded: "{rounded.pill}"
    size: "48px"
  sheet:
    backgroundColor: "{colors.yarn-white}"
    textColor: "{colors.ink}"
    typography: "{typography.sheet-title}"
    rounded: "{rounded.sheet}"
    padding: "12px 20px 34px"
  toast:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.snow-white}"
    typography: "{typography.body}"
    rounded: "{rounded.pill}"
    height: "60px"
  mode-banner:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.snow-white}"
    typography: "{typography.body-strong}"
    height: "56px"
  avatar:
    backgroundColor: "{colors.card-track}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    size: "48px"
  chip:
    backgroundColor: "{colors.card-track}"
    textColor: "{colors.ink}"
    typography: "{typography.body-strong}"
    rounded: "{rounded.pill}"
    height: "48px"
  chip-picked:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.snow-white}"
    rounded: "{rounded.pill}"
    height: "48px"
  pin-slot:
    backgroundColor: "{colors.pin-slot-red}"
    rounded: "{rounded.pin-slot}"
    width: "64px"
    height: "76px"
  keypad-key:
    backgroundColor: "rgba(255, 255, 255, 0.14)"
    textColor: "{colors.snow-white}"
    typography: "{typography.keypad}"
    rounded: "{rounded.key}"
    height: "64px"
---

# Design System: Family Gift Exchange v2, Sweater Weather (final)

## Overview

This rulebook describes the target product experience. See [implementation coverage](../docs/architecture.md#design-system) for current screen and component coverage.

**Creative North Star: "The Family Sweater"**

The app is one Christmas sweater the family knits together. The ground is a flat, drenched sweater red. Everything you read and press sits on flat yarn blocks: borderless cards with 32px corners, each in one of the sweater's yarns, and the yarn says what the card is. Only a few things are stitched, drawn as real V-shaped knit stitches: the countdown, a greeting, your person's name, and the pictures of the season (snowflake, gift, lock, tree). Everything else is plain, readable Rubik.

This replaces the round-3 system's ribbed cuff. The captain called the cuffed card "ai slop because of the border" and picked "the yarn blocks". Cards have no edge band, border, or shadow.

The density is low and calm, built for Rosa, 64, on her iPhone. Each screen has one clear next step. The one authored moment is the reveal: you hold the knitted gift, it unravels row by row, the yarn knits your person's name stitch by stitch, and the ground turns pine. After that, the name stays knitted on a pine "pass" at the top of Home and Family, the way a boarding pass stays on top in Apple Wallet.

**Key characteristics:**
- Flat sweater-red ground. Pine ground only for what only you may see.
- Yarn-block cards; colour carries meaning, and words always say it too.
- One type scale, one 20px edge, one icon set, one sheet, one toast, one mode banner.
- Stitched lettering only for names, numbers and moments.
- No card shadows, borders or edge bands. Depth comes from colour, a scrim, and things hanging on yarn.
- Motion behaves like yarn: rows unravel, stitches knit, tags swing on a strand.

## Colors

A three-yarn Christmas sweater (red, pine, gold), yarn white, and near-black ink. Every other value serves one job.

### The ground
- **Sweater Red** (#C8202F): the ground on almost every screen. White on it measures 5.67:1.
- **Pine** (#12573A): the ground only when the screen shows something only you may see (the revealed name, your person's page, asking your person). White on pine measures 8.57:1.
- **Pin Slot Red** (#9C1525): empty PIN slots, a darker well in the red.

### The yarn blocks (bound to Paper tokens `--card-*`)
| Card | Token | Hex | Means | Text |
|---|---|---|---|---|
| Information | `--card-info` | #FFF8EF | Everything that is not one of the others | Ink, muted #5F5456 |
| Needs you | `--card-next` | #EDB43E | The one thing to do now. At most one per screen. | Ink, gold ink #4A3512 |
| Yours | `--card-mine` | #12573A | Yours, or only you can see it: your person's pass, a gift you are getting, your wrapped gift | White, pale pine #D3E6DC |
| Taken | `--card-taken` | #EADBD7 | Someone else is getting it | Ink, muted |

Each card has a track one step darker (`--card-track`, `--card-track-next`, `--card-track-mine`, `--card-track-taken`) for notes, fields, chips and inner rows. Radius tokens: `--card-radius` 32px, `--card-radius-item` 28px.

### Ink and the rest
- **Ink** (#1B1416): all text on yarn white and gold; primary in-card buttons; the tab bar; selected chips and switches; ticks; toasts; the mode banner. 18.1:1 on white.
- **Snow White** (#FFFFFF): the big button on the ground, the active tab, filled PIN slots, text on red and pine.
- **Gold Ink** (#4A3512) and **Pale Pine** (#D3E6DC): secondary text on gold and on pine, tinted from their card's own hue.
- **Danger** (#A61B29): only for "Sign out everywhere" and "Yes, take Beto out".
- **The budget measure**: a 100 by 10px track with a red mark at $50. Under budget it fills ink and says "of $50"; over budget it fills gold and says "Over $50" in gold ink. It is a heads-up for the giver, never a red alarm.
- **Sheet Scrim** (rgba(40, 6, 10, 0.55)): the red-tinted veil behind sheets.

### Named rules
**The Colour Means Something Rule.** Gold is the one thing to do now, and there is at most one gold surface per screen. Pine is yours or only-you. Rose is taken by someone else. Everything else is yarn white. Words always say it too ("Someone is getting this", "Only you can see this").

**The Neutral Means Neutral Rule.** Selection, ticks, switches and avatars are ink or track tone, never pine or gold. A picked size chip is ink. An avatar is an ink initial on a soft disc. This keeps pine and gold meaning only what the rule above says.

**The Pine Means Private Rule.** The ground turns pine only for what only you may see.

## Typography

**Face:** Rubik (with system-ui, sans-serif), weights 400 to 800. **Display:** the stitched alphabet, drawn by the knit renderer, not a font.

### The one scale
| Role | Size / weight / line | Use |
|---|---|---|
| Title | 36 / 800 / 38, -0.02em | One per screen ("My list", "Is this your phone?") |
| Sheet title | 28 / 800 / 32 | The title of a sheet |
| Section | 22 / 800 / 27 | A heading on the ground ("The rest of the family") and inside big cards |
| Card title | 20 / 800 / 26 | The main line of a card |
| Item title | 20 / 700 / 26 | The name of a gift |
| Button | 20 / 700 | Big pills on the ground |
| Lead | 19 / 400 / 27 | The sentence under a title |
| Row title | 19 / 700 / 27 | A row in a grouped card |
| Body | 18 / 500 / 25 | Every other sentence; 600 to 700 for status lines and small buttons |
| Tab | 17 / 500, 700 active | Tab labels; also the system-styled Face ID label |
| Label | 13 / 800 caps / +0.06em | Only Home's season label and list counts ("4 THINGS") |
| Keypad | 30 / 500 | PIN digits |

Use the named typography utilities in [`src/styles/tokens.css`](../src/styles/tokens.css). Text must remain readable when enlarged; allow wrapping and growth rather than shrinking it to fit.

### The stitched alphabet

The supported glyphs and their grid live in [`STITCHED_ALPHABET`](../src/components/ui/knit/knit.ts). `StitchedText` and `UnravelReveal` display names with unsupported characters in heavy Rubik instead. Extend that alphabet on the same grid when adding more stitched letters.

- **Cells in use:** 10.5px for the Home countdown, 10px for greetings ("HI ROSA!", "ALL SET!"), 11.5px for the revealed name, 7.5px for the name on your person's page, 6.4px on the pass, 8.5px for "TODAY".
- **Colour:** yarn white on red or pine. Never ink, never on a yarn-white or gold card.

### Named rules
**The 18px Floor Rule.** Every sentence is 18px or more. Only labels (13), tabs (17) and nothing else go smaller.

**The Stitched Moments Rule.** Stitches are for names, numbers and moments. Never for instructions, buttons, labels or avatars.

**The No Eyebrows Rule.** No small caps line sits above a heading. The round-3 poster corners ("NO PEEKING", "KEEP IT SECRET") are gone from every screen; the only label is Home's season, beside your avatar.

## Layout

The reference frame is 390 by 844. The measurements below describe that regular phone layout; see [Accessibility](#accessibility) for enlarged-text reflow. The web shell is a fluid phone column; its width limit and safe-area insets are defined in [`src/styles/tokens.css`](../src/styles/tokens.css).

- **One edge:** everything sits 20px from the screen edge: titles, cards, buttons, sheets' content. Cards are 350px wide at the reference width and adapt with the viewport.
- **Rhythm:** a 4px base. 8px inside a group, 12px between cards, 24px between groups and before a section heading, 16px under a heading.
- **Top:** the phone owns the status bar; the shell respects its safe area. The screen's top row is Home's season label and avatar, a step bar in onboarding and setup, or a back row on pushed pages.
- **Bottom:** the main action sits 34px above the bottom, over the home indicator. Tab screens keep content clear of the floating tab bar (72px, 26px from the bottom).
- **Spanish:** let it wrap onto more lines; never shrink it to fit.

## Navigation

- **Three tabs:** Home, My list, Family. The tab bar is an ink pill, 72px, 16px from each side; the active tab is a white pill that springs across (340ms). Tabs crossfade (220ms); they never slide.
- **Pushed pages** (someone's list, your person, things I'm getting, settings) drop the tab bar and show a back row: a 48px disc and the parent's name. An optional text link sits on the right, like an iOS navigation bar item ("Something wrong?"). Swiping from the left edge goes back.
- **You** (settings): your avatar at Home's top right. It holds things I'm getting, notices, sizes, language, Face ID, your phones, family activity, help and sign out. A gold dot on the avatar means something is new.
- **The organizer** gets one extra card on his Home ("You're the organizer"), which opens his hub. Anything that needs him becomes his gold next step.
- **Modes** (helping someone, practice family, preview as) show one ink banner under the status bar: icon, words, and a 48px button to leave.

## Components

### The yarn block (card)
32px corners (28px for gift items), 20px padding (16px for items), no border, no shadow, no edge band. Colour from the table above. Inner content uses the card's track tone for notes, fields, chips and grouped rows; grouped rows are separated by a 1.5px line (#EADFCD on yarn white).

### The pass (your person)
A pine card at the top of Home and Family: "You're giving to", the name stitched at 6.4px cells, a 48px white disc with a chevron, then "Only you can see this" with a lock and the budget with a tag icon. Tapping it opens your person's page.

### Gift item
A 72px picture (18px corners), the item title, the store and price, then one of: a note on a track, a "really wants this" line, a status line ("Someone is getting this"), an action ("I'm getting this", 48px ink pill), or a budget measure. Your own items show a 48px heart disc for "Really want this". On a claim, a knitted tag hangs from the card's top right on a yarn strand. When the title shares the picture's row, it reserves room for the tag; see [Accessibility](#accessibility) for stacked item cards.

### Buttons

Heights below are minimums. Labels wrap and pills grow on narrow cards.

- **On the ground:** white pill, 64px, ink 20px label, optional 22px icon. One per screen.
- **Alternative on the ground:** transparent pill with a 2px border at 60% white, 60px.
- **In a card:** ink pill, 52px, 18px label.
- **Small:** ink pill, 48px (row actions: Send, Nudge, I'm getting this).
- **Text link:** underlined, 18px 600, 48px tall.
- **Disabled:** 16% white fill, 75% white label ("Waiting for Target…").
- **Danger:** #A61B29 pill, 56px, only inside a confirm sheet.
- **Pressed:** scale 0.97 and 6% darker, 120ms.

### Sheets
Yarn white, 34px top corners, a 40 by 5px grabber, a 28px title and a 48px close disc, content 20px in, 34px bottom padding, over the red-tinted scrim. They rise in 420ms, follow your finger when dragged, and close past 30% of their height or on a flick; tapping the scrim, the close disc or Escape also closes. Sheets are for a short choice or a short form that keeps its context (add something, edit, ask, confirm). A full task gets a page.

### Toasts
An ink pill, at least 60px high, with a gold icon, an 18px message and an optional gold "Undo" (48px target). It floats above the tab bar, or above the screen's own buttons, never over them. See [Accessibility](#accessibility) for long-message scrolling at enlarged text sizes. Undo replaces confirm dialogs for anything reversible: taking something off your list, "I'm getting this", dismissing the home-screen card.

### Inputs
- **PIN:** four 64 by 76px slots; a filled slot is white with a stitched red dot. A refused PIN rings the slots gold and shows a gold card that names the problem ("1958 looks like a year").
- **Keypad:** 3 by 4 keys, 64px, 24px corners, 14% white, digits only (no letters).
- **Fields:** 56px track-tone pills, 19px text.
- **Chips:** 48px; picked is ink. **Switch:** 56 by 34, ink when on.

### Avatars
A soft disc with the person's initial in ink (Rubik 800 at 44% of the size): track tone on a card, yarn white on the ground. 44 to 64px. Neutral on purpose, so colour keeps its meaning.

### Knit renderer
The round-3 renderer, unchanged: each chart cell is a V of two lens-shaped leaves. Motifs: snowflake, gift (with a gold ribbon), lock (gold body), tree, check, dot. Fair Isle bands (zigzag on Home at 4.6px cells, trees on the greeting, snowflake under the revealed name) run full bleed and never carry text. Tone-on-tone knit appears only on the missing-picture tile, the loading tile, the claim tag and the draw's knitted panel.

### Iconography
One set: line icons on a 24px grid, round caps and joins, 2.2 to 2.4 stroke, 20 to 24px. White on the ground, ink or pine on cards. Pair icons with words, except the back, close and heart discs, which are 48px targets; placement follows the [enlarged-text reflow rules](#accessibility). Seasonal pictures are knit motifs, never line icons.

## Motion

Interface motion is quick and explains where you went; the moments are slow and physical.

| Motion | Timing | Easing |
|---|---|---|
| Push a page | 380ms in from the right; the parent slides 30% left and dims | cubic-bezier(0.2, 0.8, 0.2, 1) |
| Back | 300ms; or follow the finger from the left edge, finishing past 120px or on a flick | cubic-bezier(0.4, 0, 0.6, 1) |
| Tab switch | 220ms crossfade; the white pill springs across in 340ms | cubic-bezier(0.3, 1.25, 0.5, 1) for the pill |
| Sheet | rises 420ms, scrim fades in 300ms; closes 260ms | rise: cubic-bezier(0.2, 0.8, 0.2, 1); close: cubic-bezier(0.4, 0, 1, 1) |
| Press | scale 0.97, 120ms | cubic-bezier(0.2, 0.8, 0.2, 1) |
| Cards arriving | rise 14 to 16px and fade, 340 to 380ms, 60 to 80ms apart, capped at 5 | cubic-bezier(0.2, 0.8, 0.2, 1) |
| Toast | rises 16px in 280ms; stays 2.6s, or 5s with Undo | cubic-bezier(0.2, 0.8, 0.2, 1) |
| Stitched words | knit in one stitch every 5 to 7ms, bottom row first, alternating direction; each stitch pops from 20% in 220ms | cubic-bezier(0.3, 1.6, 0.5, 1) |
| Step bar | a finished strip knits up, 14ms a stitch; the next strip lights gold | linear |

**The reveal** (press and hold the gift; it owns the screen, so the step bar fades away):
1. Holding pulls the yarn: 16 rows, one full gift per 1.7s of holding. Each row zips into the yarn in 300ms on cubic-bezier(0.55, 0, 0.8, 0.35). Letting go keeps pulled rows pulled. The heading says "Keep holding", then "Keep watching".
2. The loose yarn runs off the right edge and sways 12px on a 170ms sine, following the row.
3. The name knits in, one stitch every 7.5ms, and the yarn end follows the needle.
4. The ground turns pine in 700ms on cubic-bezier(0.4, 0, 0.2, 1); "You're giving to", two snowflakes, "Only you can see this" and the snowflake band arrive between 350 and 780ms; the button rises at 950ms.
- **Tap fallback:** "Or tap here to open it" runs the same unravel on its own in 1100ms. Space or Enter held down works as a hold.

**The claim:** the card dyes pine from the button outward (clip-path circle, 440ms), and a knitted tag drops 70px on its strand and swings 20, -11, 7, -3, 5 degrees over 1000ms on cubic-bezier(0.25, 0.8, 0.3, 1). Undo lifts the tag 40px in 320ms and the dye recedes.

**The draw:** one yarn loop draws itself through the six snowflakes in 2.4s, touching each person in turn (a tick each); a knitted panel covers it row by row in 1.3s (28 steps); the loop and panel fade and the lock knits itself in; then the seal. "Skip the animation" is always there.

**Opening a key:** the link preview grows into the app in 460ms, then "HI ROSA!" knits in.

**Reduced motion** (follows the phone's setting; preview it in the [design gallery](../README.md#run-locally)): every page change is a 160ms crossfade; the gift opens at once on press or tap; stitched words appear without knitting; the claim tag fades in; toasts and sheets fade. Feedback that confirms an action stays.

### Haptics (where the phone allows)
| Moment | Haptic |
|---|---|
| A PIN digit, a size chip, a suggestion | tick |
| A refused or mismatched PIN | error |
| PIN made, Face ID on, all set, question sent, key sent | success |
| Each row of yarn pulled | tick |
| Your person revealed; names drawn and sealed | success |
| "I'm getting this" | firm tap |
| Sheet put away, back swipe finished, tab change | soft tap |

On the web this is `navigator.vibrate` where it exists; iPhone Safari has no web vibration, so the build should treat haptics as an enhancement and never as the only signal.

## Accessibility
- Every sentence 18px or more; every target 48px or more.
- Text only on flat colour: the red or pine ground, yarn blocks, tracks. Never on knit.
- Every hold has a visible tap path, and the hold works from the keyboard.
- Every ceremony has "Skip the animation" and a reduced-motion version.
- State is always in words as well as colour.
- At the largest text size, use the narrow layout (`max-[299px]` in components; global overrides in [`tokens.css`](../src/styles/tokens.css)). Stack tab icons over labels and keep cards' colour meaning. Give words room to wrap between words and keep content within the screen:
  - The edge and card sides tighten, and headings use the compact sizes defined by the global overrides; every sentence keeps its typography role size.
  - A row's words take the row's whole width under its leading picture and trailing control ([`stackRow` and `stackWords`](../src/components/ui/card.tsx)). Heading counts move below their titles. Decorative icons can step aside in fact and field rows.
  - Item-card words always take a full-width row below the picture, leaving the claim tag above them without reserved title padding. Loading rows and photo actions also give their words a full-width row.
  - A button's icon stacks over its label, and its corners soften so two or three lines stay inside the shape. Ticks sit over their word. A field's action (Add) moves under the field, and its label stays visible above the input.
  - Paired fields stack; size grids use fewer columns; shoe sizes get a full-width row above their stepper controls. QR images and loading placeholders stay square within the available width.
  - A sheet's title drops under the close disc. Stitched greetings and pass names scale down with the column; the pass's chevron moves below its name and its privacy caption can wrap.
  - A toast stays within the visible viewport, with its icon and Undo above a scrollable message, so a long item name cannot push Undo off screen.
  - Only a word longer than the available full-width line, or an address or code, may break inside itself. [`tests/e2e/largest-text.spec.ts`](../tests/e2e/largest-text.spec.ts) covers screens and conditional states in both languages using the simulated enlarged-text viewport in [`tests/helpers/largest-text.ts`](../tests/helpers/largest-text.ts), with additional width checks for the organizer input and claimed items.
- Focus: a 3px yarn-white ring, 3px offset (ink on light cards and inside sheets).

## Do's and Don'ts

### Do
- **Do** use one gold card per screen, for the one thing to do now.
- **Do** keep pine for yours and only-you, and say it in words.
- **Do** put your person first: the pass on Home and at the top of Family.
- **Do** use Undo instead of a confirm whenever the action can be reversed.
- **Do** keep every sentence at 18px or more and every target at 48px or more.
- **Do** let Spanish wrap.

### Don't
- **Don't** put a border, cuff, edge band or shadow on a card.
- **Don't** use pine or gold for selection, ticks, switches or avatars.
- **Don't** put a small caps label above a heading.
- **Don't** stitch instructions, buttons, labels or avatars.
- **Don't** set text on knit.
- **Don't** add a hold without a tap path and a reduced-motion path.
- **Don't** expose pairings or clues to them in notices, the activity list, animations, or the organizer's screens. See the [disputed-reveal recovery policy](../docs/architecture.md#disputed-reveal-recovery) for inference limits during recovery.

## Open decisions
- **Product pictures.** The gallery uses drawn stand-ins. Use fetched store photos in the app's item cards; whether to frame them differently is still open.
- **More stitched glyphs.** Choose which additional letters to draw for the family's names; see [The stitched alphabet](#the-stitched-alphabet) for the fallback.

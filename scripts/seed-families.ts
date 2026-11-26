import type {Locale} from "../src/i18n/routing";

type FamilySeed = {
  name: string;
  language: Locale;
  households: string[][];
  helpers?: {person: string; helper: string}[];
};

export const familySeeds: FamilySeed[] = [
  {
    name: "The Frost family",
    language: "en",
    households: [
      ["Fable", "Bramble", "Junebug", "Sprig"],
      ["Glint", "Pebble", "Flurry"],
      ["Cricket", "Kestrel", "Puffin"],
      ["Tinsel", "Thistle"],
      ["Biscuit", "Wrenlet"],
      ["Mirth", "Whim"],
    ],
    helpers: [
      {person: "Bramble", helper: "Fable"},
      {person: "Junebug", helper: "Fable"},
      {person: "Sprig", helper: "Glint"},
      {person: "Whim", helper: "Mirth"},
    ],
  },
  {
    name: "Familia Nochebuena",
    language: "es",
    households: [
      ["Lunita", "Pinitín", "Nublina"],
      ["Solín", "Mielina"],
      ["Nevito", "Chispín"],
      ["Copito", "Mirtina"],
    ],
  },
  {
    name: "The Smalls",
    language: "en",
    households: [["Plink"], ["Piplet"], ["Mote"], ["Twiggle"]],
  },
  {
    name: "The Bigfoots",
    language: "en",
    households: [
      ["Stomper", "Sasq", "Yodel", "Mossbit", "Scuff", "Burl", "Loam"],
      ["Skiff"], ["Scree"], ["Pondle"], ["Clomp"], ["Fuzzcap"],
    ],
  },
  {
    name: "The Strangers",
    language: "en",
    households: [["Glint"], ["Sprig"], ["Tinsel"], ["Junebug"]],
  },
];

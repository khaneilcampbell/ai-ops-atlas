/**
 * How each named agent looks as a figure in the 3D city, translated from its illustrated avatar
 * (illustrations removed 2026-11-19; their descriptions live in `registry.identity.appearance`). Keyed by the same stable agent id as `registry.identity`, so the city
 * character, the agent card, the task picker, Activity and results all show one identity.
 *
 * Only what the avatar shows is copied: skin, hair, facial hair, glasses, earrings and the visible
 * clothes. The avatar's coloured circle is the identity accent (badge ring), never a clothing or skin
 * colour. Trousers and shoes are not in the avatars, so each figure gets a quiet, role-appropriate
 * default. Changing a figure is a design change: keep it matching the avatar (cityFigures.test.ts).
 */
export type HairStyle =
  | "bald"
  | "short" // short and neat, side part
  | "fade" // close crop with a fade
  | "undercut" // short sides, longer swept top
  | "curly" // short loose curls
  | "messy" // tousled short top
  | "locs" // short twisted locs on top
  | "pixie" // short cropped
  | "bob" // chin-length bob
  | "long" // straight past the shoulders
  | "bangs" // straight past the shoulders with a fringe
  | "wavy" // long waves past the shoulders
  | "shoulder" // waves to the shoulders
  | "ponytail" // pulled back to a low ponytail
  | "updo"; // loose bun at the back

export type FacialHair = "stubble" | "short" | "full" | "goatee";

export interface CityFigure {
  skin: string;
  hair: { style: HairStyle; color: string; /** A visible streak or grey temples. */ streak?: string };
  facialHair?: { style: FacialHair; color: string; /** Moustache colour when it differs (Andre Thompson). */ moustache?: string };
  glasses?: string;
  earrings?: string;
  necklace?: string;
  /** The top layer the avatar shows: sweater, shirt or the jacket's undershirt. */
  top: string;
  /** Collar or neckline detail of the top. */
  neck?: { kind: "collar" | "turtleneck" | "tee" | "zip"; color: string };
  /** Thin horizontal stripes over the top (Nina Petrova's striped tee). */
  stripes?: string;
  /** An open jacket, blazer or cardigan over the top. */
  jacket?: string;
  /** Not in the avatar: role-appropriate defaults. */
  trousers: string;
  shoes: string;
  /** Silhouette: overall height and shoulder width, about 1. */
  build: { height: number; shoulders: number };
}

const DARK_SHOES = "#2a2522";

export const CITY_FIGURES: Record<string, CityFigure> = {
  // Samuel Asante: short locs, round gold glasses, short beard, burgundy quarter-zip over a white tee.
  "repo-intelligence": {
    skin: "#8a5a3c",
    hair: { style: "locs", color: "#1e1712" },
    facialHair: { style: "short", color: "#1e1712" },
    glasses: "#c9a35a",
    top: "#7a1f2e",
    neck: { kind: "zip", color: "#f2efe9" },
    trousers: "#33363b",
    shoes: DARK_SHOES,
    build: { height: 1.02, shoulders: 1.02 },
  },
  // Margaret Lindqvist: short white hair, dark glasses, grey blazer, black turtleneck, pearl earrings.
  "atlas-engineering-review": {
    skin: "#ebc7ac",
    hair: { style: "pixie", color: "#e9e7e3" },
    glasses: "#3a2a22",
    earrings: "#f2eee6",
    top: "#1c1c1e",
    neck: { kind: "turtleneck", color: "#1c1c1e" },
    jacket: "#7c7f82",
    trousers: "#2e3034",
    shoes: "#1f1f21",
    build: { height: 0.96, shoulders: 0.92 },
  },
  // Tomás Herrera: brown curls, light glasses, stubble, olive overshirt over a grey tee.
  "atlas-production-coordinator": {
    skin: "#d9a27a",
    hair: { style: "curly", color: "#4a2e1e" },
    facialHair: { style: "stubble", color: "#6b4a35" },
    glasses: "#b7a58a",
    top: "#6e6f70",
    neck: { kind: "tee", color: "#6e6f70" },
    jacket: "#5e6b3a",
    trousers: "#2f3a4a",
    shoes: "#4a3a2c",
    build: { height: 1, shoulders: 1 },
  },
  // Hana Kobayashi: black chin-length bob, light blue denim shirt.
  "atlas-release-coordinator": {
    skin: "#f1d3bc",
    hair: { style: "bob", color: "#17161a" },
    top: "#8fb3d6",
    neck: { kind: "collar", color: "#8fb3d6" },
    trousers: "#3a3f4a",
    shoes: "#e8e4dc",
    build: { height: 0.94, shoulders: 0.9 },
  },
  // Daniel Okafor: short dark hair greying at the temples, grey beard, navy sweater over a white collar.
  "atlas-release-manager": {
    skin: "#5b3a28",
    hair: { style: "short", color: "#2a2522", streak: "#8a8682" },
    facialHair: { style: "full", color: "#6e6a66" },
    top: "#1f2d5a",
    neck: { kind: "collar", color: "#f2f2f2" },
    trousers: "#4a4d52",
    shoes: DARK_SHOES,
    build: { height: 1.03, shoulders: 1.06 },
  },
  // Priya Raman: black hair in a low ponytail, gold studs, sage cardigan over a charcoal top.
  "atlas-health-monitor": {
    skin: "#b07a55",
    hair: { style: "ponytail", color: "#1a1617" },
    earrings: "#d4a94a",
    top: "#45474a",
    neck: { kind: "tee", color: "#45474a" },
    jacket: "#8ba77e",
    trousers: "#2e3138",
    shoes: "#1f1f21",
    build: { height: 0.96, shoulders: 0.9 },
  },
  // Leila Haddad: long dark-brown waves, gold hoops, cream blazer over a rust blouse.
  "benjaire-product-lab": {
    skin: "#d6a07c",
    hair: { style: "wavy", color: "#3a2318" },
    earrings: "#d4a94a",
    top: "#b5532a",
    neck: { kind: "collar", color: "#b5532a" },
    jacket: "#efe3cc",
    trousers: "#d9ccb2",
    shoes: "#6b4a3a",
    build: { height: 0.97, shoulders: 0.9 },
  },
  // Claire Dubois: auburn hair in a loose bun, pearl earrings, cream cable-knit sweater.
  "benjaire-inquiry-manager": {
    skin: "#f2cdb4",
    hair: { style: "updo", color: "#a0482a" },
    earrings: "#f2eee6",
    top: "#efe6d6",
    neck: { kind: "tee", color: "#efe6d6" },
    trousers: "#3b4250",
    shoes: "#5a4436",
    build: { height: 0.96, shoulders: 0.9 },
  },
  // Mateo Rossi: brown curls, stubble, light blue oxford shirt.
  "benjaire-shop-manager": {
    skin: "#e7be9a",
    hair: { style: "curly", color: "#4a2c1c" },
    facialHair: { style: "stubble", color: "#7a5a44" },
    top: "#7fa3cf",
    neck: { kind: "collar", color: "#7fa3cf" },
    trousers: "#3d4a5c",
    shoes: "#5a4436",
    build: { height: 1.01, shoulders: 1 },
  },
  // Andre Thompson: bald, grey goatee with a dark moustache, charcoal henley.
  "benjaire-ops-monitor": {
    skin: "#5a3726",
    hair: { style: "bald", color: "#5a3726" },
    facialHair: { style: "goatee", color: "#6a6866", moustache: "#2a2421" },
    top: "#3c3d40",
    neck: { kind: "tee", color: "#3c3d40" },
    trousers: "#2b2d31",
    shoes: DARK_SHOES,
    build: { height: 1.04, shoulders: 1.08 },
  },
  // Nina Petrova: long straight blonde hair with a fringe, black glasses, navy and white striped tee.
  "site-builder": {
    skin: "#f3d2be",
    hair: { style: "bangs", color: "#e8cd8e" },
    glasses: "#1c1c1e",
    top: "#f4f1ea",
    stripes: "#1e2a4a",
    neck: { kind: "tee", color: "#f4f1ea" },
    trousers: "#222326",
    shoes: "#e8e4dc",
    build: { height: 0.95, shoulders: 0.9 },
  },
  // Jordan Reyes: black undercut, grey blazer over a black tee.
  "github-profile-manager": {
    skin: "#d4a27f",
    hair: { style: "undercut", color: "#141416" },
    top: "#1d1d1f",
    neck: { kind: "tee", color: "#1d1d1f" },
    jacket: "#6f7175",
    trousers: "#2b2d30",
    shoes: "#1f1f21",
    build: { height: 0.99, shoulders: 0.98 },
  },
  // Elijah Brooks: short fade, short beard, navy knit polo.
  "development-hub-lead": {
    skin: "#6b432d",
    hair: { style: "fade", color: "#1c1714" },
    facialHair: { style: "short", color: "#1c1714" },
    top: "#1e2a4e",
    neck: { kind: "collar", color: "#1e2a4e" },
    trousers: "#4a4e55",
    shoes: DARK_SHOES,
    build: { height: 1.04, shoulders: 1.06 },
  },
  // Sofia Mendes: shoulder-length brown waves, gold earrings and necklace, camel blazer over a white top.
  "commerce-operations-manager": {
    skin: "#b98260",
    hair: { style: "shoulder", color: "#6a4128" },
    earrings: "#d4a94a",
    necklace: "#d4a94a",
    top: "#f4efe6",
    neck: { kind: "tee", color: "#f4efe6" },
    jacket: "#c08a4e",
    trousers: "#3a3530",
    shoes: "#5a4436",
    build: { height: 0.96, shoulders: 0.9 },
  },
  // Yusuf Demir: dark hair, salt-and-pepper beard, navy overshirt over a grey tee.
  "agent-operations-lead": {
    skin: "#d3a27d",
    hair: { style: "short", color: "#241d1a" },
    facialHair: { style: "full", color: "#8c8782" },
    top: "#9a9a98",
    neck: { kind: "tee", color: "#9a9a98" },
    jacket: "#22314f",
    trousers: "#2f3a4a",
    shoes: DARK_SHOES,
    build: { height: 1.01, shoulders: 1.02 },
  },
  // Eleanor Park: shoulder-length black hair with a grey streak, gold necklace, cream silk blouse.
  "documentation-lead": {
    skin: "#ebc6a8",
    hair: { style: "long", color: "#2a2628", streak: "#b9b6b2" },
    necklace: "#d4a94a",
    top: "#f1e6cf",
    neck: { kind: "collar", color: "#f1e6cf" },
    trousers: "#4a4540",
    shoes: "#3a2e26",
    build: { height: 0.95, shoulders: 0.9 },
  },
  // Connor Walsh: tousled ginger hair, ginger stubble beard, charcoal zip jacket over a white tee.
  "soc-detection-lead": {
    skin: "#f0c4a6",
    hair: { style: "messy", color: "#c9622e" },
    facialHair: { style: "short", color: "#c06a3a" },
    top: "#f2efe9",
    neck: { kind: "zip", color: "#3a3c40" },
    jacket: "#3a3c40",
    trousers: "#2c2f35",
    shoes: DARK_SHOES,
    build: { height: 1.02, shoulders: 1.02 },
  },
};

/** The figure for an identity's persona id, or null when it has none (initials only). */
export function cityFigureFor(personaId: string): CityFigure | null {
  return CITY_FIGURES[personaId] ?? null;
}

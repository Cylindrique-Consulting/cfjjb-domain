import type { BeltDb } from "./enums";

export const ADULT_BELTS: ReadonlyArray<BeltDb> = [
  "white",
  "blue",
  "purple",
  "brown",
  "black",
  "coral",
  "red",
];

// TODO: confirm exact kids belts list against Jour J once tokens repo is available.
export const KIDS_BELTS: ReadonlyArray<BeltDb> = ["white", "grey", "yellow", "orange", "green"];

export const ALL_BELTS: ReadonlyArray<BeltDb> = [
  "white",
  "grey",
  "yellow",
  "orange",
  "green",
  "blue",
  "purple",
  "brown",
  "black",
  "coral",
  "red",
];

export const BELT_LABELS: Record<BeltDb, string> = {
  white: "Blanche",
  grey: "Grise",
  yellow: "Jaune",
  orange: "Orange",
  green: "Verte",
  blue: "Bleue",
  purple: "Violette",
  brown: "Marron",
  black: "Noire",
  coral: "Corail",
  red: "Rouge",
};

/** Couleur de repli si la ceinture est inconnue (même valeur que la ceinture blanche). */
const BELT_FALLBACK_COLOR = "#f5f1e8";

/** Couleur (hex) de chaque ceinture, pour les pastilles d'affichage. */
export const BELT_COLORS: Record<BeltDb, string> = {
  white: BELT_FALLBACK_COLOR,
  grey: "#9aa0aa",
  yellow: "#eed35c",
  orange: "#e6912e",
  green: "#3f9d4f",
  blue: "#2451a8",
  purple: "#6a3aa8",
  brown: "#7a4a25",
  black: "#0a1438",
  coral: "#dc7e6a",
  red: "#cc2d19",
};

/** Texte foncé / clair utilisés sur un fond de ceinture (tokens navy-800 / cream-50). */
const BELT_ON_DARK = "#fbfaf5";
const BELT_ON_LIGHT = "#0a1438";

/** Luminance relative (WCAG 2.x) d'une couleur hex `#rrggbb`. */
export function relativeLuminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const channels = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

/**
 * Palette du bandeau « fiche licencié » dérivée de la couleur réelle de la ceinture.
 * Le texte bascule en foncé sur les ceintures claires (blanche, jaune, orange…)
 * pour garder un contraste lisible.
 */
export function beltBannerTheme(belt: BeltDb): {
  background: string;
  foreground: string;
  /** Texte secondaire : même teinte que `foreground`, atténuée. */
  mutedForeground: string;
  /** Fond des surfaces posées sur le bandeau (boutons, avatar). */
  surface: string;
  border: string;
  isLight: boolean;
} {
  const background: string = BELT_COLORS[belt] ?? BELT_FALLBACK_COLOR;
  // Seuil WCAG : au-dessus, le texte foncé contraste mieux que le texte clair.
  const isLight = relativeLuminance(background) > 0.179;
  const foreground = isLight ? BELT_ON_LIGHT : BELT_ON_DARK;
  return {
    background,
    foreground,
    mutedForeground: isLight ? "rgba(10, 20, 56, 0.72)" : "rgba(251, 250, 245, 0.78)",
    surface: isLight ? "rgba(10, 20, 56, 0.08)" : "rgba(251, 250, 245, 0.14)",
    border: isLight ? "rgba(10, 20, 56, 0.22)" : "rgba(251, 250, 245, 0.3)",
    isLight,
  };
}

/**
 * Grille IBJJF ceinture / âge (DEV-060 + DEV-086). Bornes en années RÉVOLUES
 * (cf. `ageInYears`) :
 *   - ceintures enfants : grise 4-15, jaune 7-15, orange 10-15, verte 13-15 ;
 *   - blanche : tout âge ;
 *   - adultes : bleue et violette ≥ 16, marron ≥ 18, noire ≥ 19,
 *     corail et rouge ≥ 50.
 * La grille s'applique à la CRÉATION d'une fiche ; l'ÉDITION reste libre
 * (autorité de correction du club / de la fédération).
 */
export type BeltAgeBounds = { minAge?: number; maxAge?: number };

export const BELT_AGE_BOUNDS: Record<BeltDb, BeltAgeBounds> = {
  white: {},
  grey: { minAge: 4, maxAge: 15 },
  yellow: { minAge: 7, maxAge: 15 },
  orange: { minAge: 10, maxAge: 15 },
  green: { minAge: 13, maxAge: 15 },
  blue: { minAge: 16 },
  purple: { minAge: 16 },
  brown: { minAge: 18 },
  black: { minAge: 19 },
  coral: { minAge: 50 },
  red: { minAge: 50 },
};

/** La ceinture est-elle autorisée pour cet âge (années révolues) ? */
export function beltAllowedForAge(belt: BeltDb, ageYears: number): boolean {
  const bounds = BELT_AGE_BOUNDS[belt];
  if (!bounds) return true;
  if (bounds.minAge !== undefined && ageYears < bounds.minAge) return false;
  if (bounds.maxAge !== undefined && ageYears > bounds.maxAge) return false;
  return true;
}

/**
 * Message d'erreur FR explicite si la ceinture n'est pas autorisée pour cet
 * âge ; `null` si elle l'est.
 */
export function beltAgeErrorFr(belt: BeltDb, ageYears: number): string | null {
  if (beltAllowedForAge(belt, ageYears)) return null;
  const bounds = BELT_AGE_BOUNDS[belt] ?? {};
  const label = (BELT_LABELS[belt] ?? belt).toLowerCase();
  const age = `âge du licencié : ${ageYears} an${ageYears > 1 ? "s" : ""}`;
  if (bounds.minAge !== undefined && bounds.maxAge !== undefined) {
    return `La ceinture ${label} est réservée aux ${bounds.minAge}-${bounds.maxAge} ans (${age}).`;
  }
  if (bounds.minAge !== undefined) {
    return `La ceinture ${label} nécessite d'avoir au moins ${bounds.minAge} ans (${age}).`;
  }
  return `La ceinture ${label} n'est pas autorisée pour cet âge (${age}).`;
}

export function isMinor(birthDateIso: string, on: Date = new Date()): boolean {
  const dob = new Date(birthDateIso);
  const eighteen = new Date(dob);
  eighteen.setFullYear(eighteen.getFullYear() + 18);
  return on < eighteen;
}

/**
 * Âge civil révolu (en années) à la date `on` : nombre d'anniversaires atteints.
 * À ne pas confondre avec la catégorie IBJJF (année civile, cf. computeAgeGroup).
 */
export function ageInYears(birthDateIso: string, on: Date = new Date()): number {
  const dob = new Date(birthDateIso);
  let age = on.getFullYear() - dob.getFullYear();
  const anniversaryReached =
    on.getMonth() > dob.getMonth() ||
    (on.getMonth() === dob.getMonth() && on.getDate() >= dob.getDate());
  if (!anniversaryReached) age -= 1;
  return age;
}

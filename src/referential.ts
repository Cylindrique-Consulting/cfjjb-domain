import type { BeltDb, GenderDb } from "./enums";
import { BELT_LABELS, KIDS_BELTS } from "./belts";

/**
 * Competition referential: age groups, weight classes, fight durations and
 * the Jour J category fullname format.
 *
 * The weight and duration tables are ported VERBATIM from the Jour J app
 * ("CFJJB - Jour J" repo, src/lib/weight-limits.ts and
 * src/lib/fight-durations.ts - same source spreadsheets). Keep both sides in
 * sync; do not "fix" irregular values, they match the official documents.
 *
 * Jour J category fullname format (parsed by Jour J with split(" - ")):
 *   "Ceinture - AgeGroup - Genre - WeightClass"
 *   e.g. "Bleue - Adulte - Homme - Pena", "Grise - U11 - Garçon - Pena"
 */

export type Discipline = "gi" | "nogi";

export const AGE_GROUPS = [
  "U7",
  "U9",
  "U11",
  "U13",
  "U15",
  "Juvénile",
  "Adulte",
  "Master 1",
  "Master 2",
  "Master 3",
  "Master 4",
  "Master 5+",
] as const;
export type AgeGroup = (typeof AGE_GROUPS)[number];

/**
 * Tailles de T-shirt proposées (F11), enum figé. Source unique importée par
 * les schémas Zod, les formulaires d'inscription et l'écran de distribution
 * (F11b). L'ordre est l'ordre canonique d'affichage (XS → XXL).
 */
export const TSHIRT_SIZES = ["XS", "S", "M", "L", "XL", "XXL"] as const;
export type TshirtSize = (typeof TSHIRT_SIZES)[number];

export const WEIGHT_CLASSES = [
  "Galo",
  "Pluma",
  "Pena",
  "Leve",
  "Medio",
  "Meio Pesado",
  "Pesado",
  "Super Pesado",
  "Pesadissimo",
] as const;
export type WeightClassName = (typeof WEIGHT_CLASSES)[number];

/**
 * CYL-435 — libellé d'affichage d'un `competition_registrations.age_group`.
 *
 * La colonne stocke des CODES, hérités de l'ancien site : `adult`,
 * `master_1_2`, `juvenil`, `premirim`… Recopiés tels quels, ils produisaient
 * « Ceinture bleue - adult - 3 » sur l'attestation officielle de résultats.
 *
 * Les 18 codes ci-dessous sont ceux RÉELLEMENT présents en production, relevés
 * le 2026-08-10 sur 131 215 inscriptions — pas ceux que le référentiel déclare.
 * Un code absent de cette table retombe sur le libellé de l'organisateur : on
 * n'imprime jamais un code brut sur un document officiel.
 *
 * Les catégories brésiliennes (mirim, infantil, juvenil…) sont des NOMS DE
 * CATÉGORIE, pas des mots à traduire : on les accentue et on les capitalise,
 * on ne les remplace pas. L'attestation doit nommer la catégorie effectivement
 * disputée.
 */
export const AGE_GROUP_LABELS: Record<string, string> = {
  adult: "Adulte",
  child: "Enfant",
  juvenil: "Juvénile",
  infantiljuvenil: "Infanto-Juvénile",
  infantil: "Infantil",
  mirim: "Mirim",
  premirim: "Pré-Mirim",
  master: "Master",
  master1: "Master 1",
  master2: "Master 2",
  master_1_2: "Master 1-2",
  master_3_4: "Master 3-4",
  master_5_plus: "Master 5+",
  u7: "U7",
  u9: "U9",
  u11: "U11",
  u13: "U13",
  u15: "U15",
};

/** Libellé d'une catégorie d'âge stockée, ou `null` si le code est inconnu. */
export function ageGroupLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  return AGE_GROUP_LABELS[code.trim().toLowerCase()] ?? null;
}

/**
 * CYL-435 — libellé d'un `competition_registrations.weight_class`.
 *
 * LA COLONNE PORTE DEUX VOCABULAIRES, mesuré le 2026-08-10 :
 *   - 130 462 lignes = un INDICE 0–8 dans `WEIGHT_CLASSES` (99,4 %) ;
 *   -     701 lignes = 10 à 500, toutes en `age_group = "child"` : des kilos,
 *         mais « 500 » y figure aussi — la colonne n'y est pas fiable ;
 *   -      47 lignes = 9, hors bornes du référentiel (9 entrées, 0 à 8) ;
 *   -       5 lignes = « -30 », « -40 », « -62 ».
 *
 * Seul l'indice est traduit. Tout le reste rend `null` et laisse l'appelant
 * retomber sur le libellé de l'organisateur — imprimer « 500 » ou inventer une
 * unité sur une attestation officielle serait pire que de ne rien dire.
 */
export function weightClassLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  const brut = value.trim();
  if (!/^\d+$/.test(brut)) return null;
  const index = Number(brut);
  return WEIGHT_CLASSES[index] ?? null;
}

/** Belts that can enter adult/master/juvenile competition categories. */
export const ADULT_COMPETITION_BELTS: ReadonlyArray<BeltDb> = [
  "white",
  "blue",
  "purple",
  "brown",
  "black",
];

/** Belts that can enter children categories (U7..U15). */
export const KIDS_COMPETITION_BELTS: ReadonlyArray<BeltDb> = [
  "white",
  "grey",
  "yellow",
  "orange",
  "green",
];

// ------------------------------------------------------------------
// Weight limits (kg). null = class does not exist for that group.
// Adults/masters/juveniles share the adult limits (masters = adulte_*).
// ------------------------------------------------------------------
type AdultWeightRow = {
  juvenile_homme: number | null;
  adulte_homme: number | null;
  juvenile_femme: number | null;
  adulte_femme: number | null;
};
type ChildWeightRow = Record<"U7" | "U9" | "U11" | "U13" | "U15", number | null>;

const GI_ADULT: Record<WeightClassName, AdultWeightRow> = {
  Galo: { juvenile_homme: 53.5, adulte_homme: 57.5, juvenile_femme: 44.3, adulte_femme: 48.5 },
  Pluma: { juvenile_homme: 58.5, adulte_homme: 64.0, juvenile_femme: 48.3, adulte_femme: 53.5 },
  Pena: { juvenile_homme: 64.0, adulte_homme: 70.0, juvenile_femme: 52.5, adulte_femme: 58.5 },
  Leve: { juvenile_homme: 69.0, adulte_homme: 76.0, juvenile_femme: 56.5, adulte_femme: 64.0 },
  Medio: { juvenile_homme: 74.0, adulte_homme: 82.3, juvenile_femme: 60.5, adulte_femme: 69.0 },
  "Meio Pesado": {
    juvenile_homme: 79.3,
    adulte_homme: 88.3,
    juvenile_femme: 65.0,
    adulte_femme: 74.0,
  },
  Pesado: { juvenile_homme: 84.3, adulte_homme: 94.3, juvenile_femme: 69.0, adulte_femme: 79.3 },
  "Super Pesado": {
    juvenile_homme: 89.3,
    adulte_homme: 100.5,
    juvenile_femme: null,
    adulte_femme: null,
  },
  Pesadissimo: {
    juvenile_homme: null,
    adulte_homme: null,
    juvenile_femme: null,
    adulte_femme: null,
  },
};

const NOGI_ADULT: Record<WeightClassName, AdultWeightRow> = {
  Galo: { juvenile_homme: 51.5, adulte_homme: 55.5, juvenile_femme: 42.5, adulte_femme: 46.5 },
  Pluma: { juvenile_homme: 56.5, adulte_homme: 61.5, juvenile_femme: 46.5, adulte_femme: 51.5 },
  Pena: { juvenile_homme: 61.5, adulte_homme: 67.5, juvenile_femme: 50.5, adulte_femme: 56.5 },
  Leve: { juvenile_homme: 66.5, adulte_homme: 73.5, juvenile_femme: 54.5, adulte_femme: 61.5 },
  Medio: { juvenile_homme: 71.5, adulte_homme: 79.5, juvenile_femme: 58.5, adulte_femme: 66.5 },
  "Meio Pesado": {
    juvenile_homme: 76.5,
    adulte_homme: 85.5,
    juvenile_femme: 62.5,
    adulte_femme: 71.5,
  },
  Pesado: { juvenile_homme: 81.5, adulte_homme: 91.5, juvenile_femme: 66.5, adulte_femme: 76.5 },
  "Super Pesado": {
    juvenile_homme: 86.5,
    adulte_homme: 97.5,
    juvenile_femme: null,
    adulte_femme: null,
  },
  Pesadissimo: {
    juvenile_homme: null,
    adulte_homme: null,
    juvenile_femme: null,
    adulte_femme: null,
  },
};

const GI_CHILDREN: Record<WeightClassName, ChildWeightRow> = {
  Galo: { U7: 18.2, U9: 24.0, U11: 30.2, U13: 36.2, U15: 44.3 },
  Pluma: { U7: 21.0, U9: 27.0, U11: 33.2, U13: 40.3, U15: 48.3 },
  Pena: { U7: 24.0, U9: 30.2, U11: 36.2, U13: 44.3, U15: 52.5 },
  Leve: { U7: 27.0, U9: 33.2, U11: 39.3, U13: 48.3, U15: 56.5 },
  Medio: { U7: 30.2, U9: 36.2, U11: 42.3, U13: 52.5, U15: 60.5 },
  "Meio Pesado": { U7: 33.2, U9: 39.3, U11: 45.3, U13: 56.5, U15: 65.0 },
  Pesado: { U7: 36.2, U9: 42.3, U11: 48.3, U13: 60.5, U15: 69.0 },
  "Super Pesado": { U7: 39.3, U9: 45.3, U11: 51.5, U13: 65.0, U15: 73.0 },
  Pesadissimo: { U7: null, U9: null, U11: null, U13: null, U15: null },
};

const NOGI_CHILDREN: Record<WeightClassName, ChildWeightRow> = {
  Galo: { U7: 17.7, U9: 22.7, U11: 28.8, U13: 34.8, U15: 42.9 },
  Pluma: { U7: 19.7, U9: 25.7, U11: 31.8, U13: 38.9, U15: 46.9 },
  Pena: { U7: 22.7, U9: 28.8, U11: 34.8, U13: 42.9, U15: 51.0 },
  Leve: { U7: 25.7, U9: 31.2, U11: 37.9, U13: 46.9, U15: 55.0 },
  Medio: { U7: 28.8, U9: 34.8, U11: 40.9, U13: 51.0, U15: 59.0 },
  "Meio Pesado": { U7: 31.8, U9: 37.9, U11: 43.9, U13: 55.0, U15: 63.0 },
  Pesado: { U7: 34.8, U9: 40.9, U11: 46.9, U13: 59.0, U15: 67.0 },
  "Super Pesado": { U7: 37.9, U9: 43.9, U11: 50.0, U13: 63.0, U15: 71.0 },
  Pesadissimo: { U7: null, U9: null, U11: null, U13: null, U15: null },
};

// ------------------------------------------------------------------
// Fight durations (minutes). null = belt × age combination does not exist.
// ------------------------------------------------------------------
type AdultDurationRow = {
  Juvénile: number | null;
  Adulte: number | null;
  "Master 1": number | null;
  "Master 2": number | null;
  "Master 3": number | null;
  "Master 4": number | null;
  "Master 5+": number | null;
};
type ChildDurationRow = Record<"U7" | "U9" | "U11" | "U13" | "U15", number | null>;

// Master 1 and Master 2 inherit the old "Master 1/2" duration; Master 3 and
// Master 4 inherit the old "Master 3/4" duration (dissociation is age-band
// only, the fight times are unchanged).
const DURATIONS_ADULT: Partial<Record<BeltDb, AdultDurationRow>> = {
  white: {
    Juvénile: 5,
    Adulte: 5,
    "Master 1": 5,
    "Master 2": 5,
    "Master 3": 5,
    "Master 4": 5,
    "Master 5+": 5,
  },
  blue: {
    Juvénile: 5,
    Adulte: 6,
    "Master 1": 5,
    "Master 2": 5,
    "Master 3": 5,
    "Master 4": 5,
    "Master 5+": 5,
  },
  purple: {
    Juvénile: 5,
    Adulte: 7,
    "Master 1": 6,
    "Master 2": 6,
    "Master 3": 5,
    "Master 4": 5,
    "Master 5+": 5,
  },
  brown: {
    Juvénile: null,
    Adulte: 8,
    "Master 1": 6,
    "Master 2": 6,
    "Master 3": 5,
    "Master 4": 5,
    "Master 5+": 5,
  },
  black: {
    Juvénile: null,
    Adulte: 10,
    "Master 1": 6,
    "Master 2": 6,
    "Master 3": 5,
    "Master 4": 5,
    "Master 5+": 5,
  },
};

const DURATIONS_CHILDREN: Partial<Record<BeltDb, ChildDurationRow>> = {
  white: { U7: null, U9: null, U11: null, U13: null, U15: 4 },
  grey: { U7: 3, U9: 3, U11: 4, U13: 4, U15: 4 },
  yellow: { U7: 3, U9: 3, U11: 4, U13: 4, U15: 4 },
  orange: { U7: null, U9: null, U11: 4, U13: 4, U15: 4 },
  green: { U7: null, U9: null, U11: null, U13: 4, U15: 4 },
};

// Gi and No-Gi share the same duration tables in the source document.
// Kept as a parameter so a future divergence is a data change only.

// ------------------------------------------------------------------
// Public API
// ------------------------------------------------------------------

export function isChildAgeGroup(ageGroup: AgeGroup): boolean {
  return ageGroup.startsWith("U");
}

/**
 * Classement « enfant / adulte » unique pour toute la plateforme.
 * « Enfants » = U7…U15 + Juvénile ; « Adultes » = Adulte + Master 1…5+.
 * Source de vérité partagée entre `bucketAgeSplit` (analytics) et
 * `buildAffiliationHistory` (historique club) - ne pas dupliquer la règle.
 */
export function isChildAgeCategory(ageGroup: AgeGroup): boolean {
  return isChildAgeGroup(ageGroup) || ageGroup === "Juvénile";
}

/** Chaîne des catégories adultes, de la plus basse à la plus haute. */
const ADULT_AGE_CHAIN: ReadonlyArray<AgeGroup> = [
  "Adulte",
  "Master 1",
  "Master 2",
  "Master 3",
  "Master 4",
  "Master 5+",
];

/**
 * Catégories d'âge qu'un licencié peut viser à l'inscription, règle
 * « qui peut le plus peut le moins » (CYL-110) :
 * - mineurs (U7…U15 et Juvénile) : aucune descente possible, la catégorie
 *   réelle s'impose ;
 * - adultes/masters : la catégorie réelle plus toute catégorie ADULTE
 *   inférieure (Master 2 -> M2 / M1 / Adulte), jamais une catégorie jeune.
 * Résultat ordonné de la catégorie réelle vers la plus basse.
 */
export function listEligibleAgeGroups(actual: AgeGroup): AgeGroup[] {
  const idx = ADULT_AGE_CHAIN.indexOf(actual);
  if (idx < 0) return [actual]; // U7…U15 et Juvénile : pas de choix.
  return ADULT_AGE_CHAIN.slice(0, idx + 1).reverse();
}

/**
 * Age group from the age reached during the calendar year of the competition
 * (IBJJF rule for the reference date). Bornes CFJJB :
 * U7 <=7, U9 8-9, U11 10-11, U13 12-13, U15 14-15, Juvénile 16-17,
 * Adulte 18-29, Master 1 = 30-35, Master 2 = 36-40, Master 3 = 41-45,
 * Master 4 = 46-50, Master 5+ = 51+.
 */
export function computeAgeGroup(birthDateIso: string, competitionDateIso: string): AgeGroup {
  const birthYear = new Date(birthDateIso).getFullYear();
  const competitionYear = new Date(competitionDateIso).getFullYear();
  const age = competitionYear - birthYear;

  // Bornes CFJJB (DEV-086 étendu). U15 absorbe l'âge civil 15 ; Juvénile ne
  // commence qu'à 16 ans, en phase avec la bascule ceinture bleue automatique
  // (BELT_AGE_BOUNDS blue minAge 16). Auparavant un athlète de 15 ans était
  // « Juvénile » un an avant que sa ceinture ne passe bleue.
  if (age <= 7) return "U7";
  if (age <= 9) return "U9";
  if (age <= 11) return "U11";
  if (age <= 13) return "U13";
  if (age <= 15) return "U15";
  if (age <= 17) return "Juvénile";
  if (age <= 29) return "Adulte";
  if (age <= 35) return "Master 1";
  if (age <= 40) return "Master 2";
  if (age <= 45) return "Master 3";
  if (age <= 50) return "Master 4";
  return "Master 5+";
}

/**
 * Prochaine bascule de catégorie d'âge (CYL-126, pur, testable) :
 * à partir de la date `on` (défaut « maintenant »), on cherche le prochain
 * 1er janvier où `computeAgeGroup` change de valeur, et on renvoie ce groupe
 * + la date ISO (`YYYY-01-01`). Réutilise `computeAgeGroup`/`AGE_GROUPS`
 * comme unique source de vérité pour les seuils (aucun âge dupliqué).
 *
 * Renvoie `null` quand il n'y a plus de bascule (dernière catégorie
 * `Master 5+`, qui est ouverte). Un licencié né un 1er janvier voit sa
 * bascule le jour même de son entrée dans la nouvelle catégorie (la règle
 * IBJJF « âge atteint dans l'année » place la bascule au 1er janvier).
 */
export function nextAgeCategoryChange(
  birthDateIso: string,
  on: Date = new Date(),
): { nextGroup: AgeGroup; changeDate: string } | null {
  const currentGroup = computeAgeGroup(birthDateIso, on.toISOString());
  // La dernière catégorie est ouverte : plus aucune bascule à venir.
  if (currentGroup === AGE_GROUPS[AGE_GROUPS.length - 1]) return null;

  // Le prochain 1er janvier après `on` (borne minimale de recherche).
  const startYear = on.getUTCFullYear() + 1;
  // Borne haute : le 1er janvier de l'année des 51 ans suffit à atteindre la
  // dernière tranche (Master 5+ = 51+). +1 par sécurité d'arrondi.
  const birthYear = new Date(birthDateIso).getUTCFullYear();
  const maxYear = birthYear + 52;

  for (let year = startYear; year <= maxYear; year += 1) {
    const changeDate = `${year}-01-01`;
    const group = computeAgeGroup(birthDateIso, `${changeDate}T00:00:00Z`);
    if (group !== currentGroup) {
      return { nextGroup: group, changeDate };
    }
  }
  return null;
}

/**
 * Notice « ceinture bleue automatique » (CYL-126, pur) : vrai uniquement si
 * la prochaine bascule est vers `Juvénile` ET que la ceinture courante est
 * une couleur Kids (grise/jaune/orange/verte, jamais blanche). Réutilise
 * `KIDS_BELTS` de `lib/licensees/belts` (source unique). La règle métier
 * d'auto-attribution + la notification club sont possédées par R19 ; ce
 * prédicat ne sert qu'à l'affichage prévisionnel côté licencié.
 */
export function willGetBlueBeltAtJuvenile(
  currentBelt: BeltDb,
  birthDateIso: string,
  on: Date = new Date(),
): boolean {
  // Couleurs Kids = KIDS_BELTS sans la blanche (le blanc obtient le bleu par
  // la progression normale, pas par la règle « couleur → bleue »).
  if (currentBelt === "white" || !KIDS_BELTS.includes(currentBelt)) return false;
  const next = nextAgeCategoryChange(birthDateIso, on);
  return next?.nextGroup === "Juvénile";
}

/**
 * Majorité « CFJJB » : un licencié est majeur dès le 1er janvier de l'année
 * civile de ses 18 ans (referenceYear - année de naissance >= 18).
 * Cohérent avec computeAgeGroup : Adulte/Master => majeur, U7-U15/Juvénile => mineur.
 */
export function isAdultForYear(birthDateIso: string, referenceYear: number): boolean {
  const birthYear = new Date(birthDateIso).getFullYear();
  return referenceYear - birthYear >= 18;
}

/** Commodité : majorité appréciée sur l'année civile de la compétition. */
export function isAdultAtCompetition(birthDateIso: string, competitionDateIso: string): boolean {
  return isAdultForYear(birthDateIso, new Date(competitionDateIso).getFullYear());
}

export function genderLabel(gender: GenderDb, ageGroup: AgeGroup): string {
  if (isChildAgeGroup(ageGroup)) {
    return gender === "male" ? "Garçon" : "Fille";
  }
  return gender === "male" ? "Homme" : "Femme";
}

function adultWeightKey(ageGroup: AgeGroup, gender: GenderDb): keyof AdultWeightRow {
  const isJuvenile = ageGroup === "Juvénile";
  if (isJuvenile) return gender === "male" ? "juvenile_homme" : "juvenile_femme";
  // Adulte and all masters use the adult limits.
  return gender === "male" ? "adulte_homme" : "adulte_femme";
}

/** Max weight in kg for a class, null = no limit (Pesadissimo) or class absent. */
export function getMaxWeightKg(
  discipline: Discipline,
  ageGroup: AgeGroup,
  gender: GenderDb,
  weightClass: WeightClassName,
): number | null {
  if (isChildAgeGroup(ageGroup)) {
    const table = discipline === "gi" ? GI_CHILDREN : NOGI_CHILDREN;
    return table[weightClass][ageGroup as keyof ChildWeightRow] ?? null;
  }
  const table = discipline === "gi" ? GI_ADULT : NOGI_ADULT;
  return table[weightClass][adultWeightKey(ageGroup, gender)] ?? null;
}

/**
 * Weight classes offered for a (discipline, age group, gender):
 * classes with a defined limit, plus Pesadissimo (always open, no limit).
 */
export function listWeightClasses(
  discipline: Discipline,
  ageGroup: AgeGroup,
  gender: GenderDb,
): Array<{ name: WeightClassName; maxKg: number | null }> {
  const out: Array<{ name: WeightClassName; maxKg: number | null }> = [];
  for (const name of WEIGHT_CLASSES) {
    if (name === "Pesadissimo") {
      out.push({ name, maxKg: null });
      continue;
    }
    const maxKg = getMaxWeightKg(discipline, ageGroup, gender, name);
    if (maxKg !== null) out.push({ name, maxKg });
  }
  return out;
}

/** Fight duration in seconds; null = belt × age combination does not exist. */
export function getFightDurationSeconds(
  belt: BeltDb,
  ageGroup: AgeGroup,
  _discipline: Discipline,
): number | null {
  if (isChildAgeGroup(ageGroup)) {
    const minutes = DURATIONS_CHILDREN[belt]?.[ageGroup as keyof ChildDurationRow] ?? null;
    return minutes === null ? null : minutes * 60;
  }
  const minutes = DURATIONS_ADULT[belt]?.[ageGroup as keyof AdultDurationRow] ?? null;
  return minutes === null ? null : minutes * 60;
}

export function isBeltAllowedForAgeGroup(
  belt: BeltDb,
  ageGroup: AgeGroup,
  discipline: Discipline,
): boolean {
  return getFightDurationSeconds(belt, ageGroup, discipline) !== null;
}

export type CategoryTuple = {
  discipline: Discipline;
  belt: BeltDb;
  ageGroup: AgeGroup;
  gender: GenderDb;
  weightClass: WeightClassName;
};

/** Jour J category fullname: "Bleue - Adulte - Homme - Pena". */
export function buildCategoryFullname(tuple: Omit<CategoryTuple, "discipline">): string {
  const beltLabel = BELT_LABELS[tuple.belt];
  return `${beltLabel} - ${tuple.ageGroup} - ${genderLabel(tuple.gender, tuple.ageGroup)} - ${tuple.weightClass}`;
}

/** Short name shown in Jour J lists: "Adulte - Pena". */
export function buildCategoryShortname(
  tuple: Omit<CategoryTuple, "discipline" | "belt" | "gender">,
): string {
  return `${tuple.ageGroup} - ${tuple.weightClass}`;
}

import { BELT_RANK_ORDER } from "./belts";
import { resolveAgeGroup, resolveWeightClass } from "./db-vocabulary";
import type { BeltDb, GenderDb } from "./enums";
import { AGE_GROUPS, WEIGHT_CLASSES } from "./referential";

export const GENRES_DANS_L_ORDRE: readonly GenderDb[] = ["female", "male"];

export type GroupeDAbsolut = "Leve" | "Pesado";

const PREFIXE_ABSOLUT = "absolut";

const RANG_DU_GROUPE: Readonly<Record<GroupeDAbsolut, number>> = { Leve: 0, Pesado: 1 };

const RANG_GROUPE_INCONNU = 2;

function normaliser(valeur: string | null | undefined): string {
  return (valeur ?? "").trim().toLowerCase();
}

export function estCategorieAbsolut(weightClass: string | null | undefined): boolean {
  return normaliser(weightClass).startsWith(PREFIXE_ABSOLUT);
}

export function groupeDAbsolut(weightClass: string | null | undefined): GroupeDAbsolut | null {
  if (!estCategorieAbsolut(weightClass)) return null;
  const reste = normaliser(weightClass).slice(PREFIXE_ABSOLUT.length).trim();
  if (reste === "leve") return "Leve";
  if (reste === "pesado") return "Pesado";
  return null;
}

export type CategorieAOrdonner = {
  ageGroup?: string | null;
  gender?: GenderDb | null;
  belt?: BeltDb | string | null;
  weightClass?: string | null;
};

export function rangSportifDeCategorie(cat: CategorieAOrdonner): number[] {
  const tranche = resolveAgeGroup(cat.ageGroup);
  const rangTranche = tranche === null ? AGE_GROUPS.length : AGE_GROUPS.indexOf(tranche);

  const iGenre = GENRES_DANS_L_ORDRE.indexOf(cat.gender as GenderDb);
  const rangGenre = iGenre < 0 ? GENRES_DANS_L_ORDRE.length : iGenre;

  const iCeinture = BELT_RANK_ORDER.indexOf(cat.belt as BeltDb);
  const rangCeinture = iCeinture < 0 ? BELT_RANK_ORDER.length : iCeinture;

  const absolut = estCategorieAbsolut(cat.weightClass);
  if (absolut) {
    const groupe = groupeDAbsolut(cat.weightClass);
    const rangGroupe = groupe === null ? RANG_GROUPE_INCONNU : RANG_DU_GROUPE[groupe];
    return [rangTranche, rangGenre, rangCeinture, 1, rangGroupe];
  }

  const classe = resolveWeightClass(cat.weightClass);
  const rangPoids = classe === null ? WEIGHT_CLASSES.length : WEIGHT_CLASSES.indexOf(classe);
  return [rangTranche, rangGenre, rangCeinture, 0, rangPoids];
}

export function comparerRangs(a: readonly number[], b: readonly number[]): number {
  const taille = Math.max(a.length, b.length);
  for (let i = 0; i < taille; i += 1) {
    const ecart = (a[i] ?? 0) - (b[i] ?? 0);
    if (ecart !== 0) return ecart;
  }
  return 0;
}

export function comparerCategoriesSportives(a: CategorieAOrdonner, b: CategorieAOrdonner): number {
  return comparerRangs(rangSportifDeCategorie(a), rangSportifDeCategorie(b));
}

export function trierCategoriesSportives<T extends CategorieAOrdonner>(
  categories: readonly T[],
): T[] {
  return [...categories].sort(comparerCategoriesSportives);
}

export function rangsDePlanning<T extends CategorieAOrdonner & { id: string }>(
  categories: readonly T[],
): Map<string, number> {
  const rangs = new Map<string, number>();
  trierCategoriesSportives(categories).forEach((cat, index) => {
    if (!rangs.has(cat.id)) rangs.set(cat.id, index);
  });
  return rangs;
}

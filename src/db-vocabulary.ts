import {
  AGE_GROUPS,
  isChildAgeGroup,
  listWeightClasses,
  WEIGHT_CLASSES,
  weightClassLabel,
  type AgeGroup,
  type Discipline,
  type WeightClassName,
} from "./referential";
import type { GenderDb } from "./enums";

const CODE_VERS_AGE_GROUP: Readonly<Record<string, AgeGroup>> = {
  adult: "Adulte",
  juvenil: "Juvénile",
  u7: "U7",
  u9: "U9",
  u11: "U11",
  u13: "U13",
  u15: "U15",
  master_1_2: "Master 1",
  master_3_4: "Master 3",
  master_5_plus: "Master 5+",
};

export const CODES_AGE_NON_TRADUISIBLES = [
  "master",
  "master1",
  "master2",
  "child",
  "mirim",
  "premirim",
  "infantil",
  "infantiljuvenil",
] as const;

export function resolveAgeGroup(stored: string | null | undefined): AgeGroup | null {
  if (!stored) return null;
  const brut = stored.trim();
  const direct = (AGE_GROUPS as readonly string[]).find((g) => g === brut);
  if (direct) return direct as AgeGroup;
  return CODE_VERS_AGE_GROUP[brut.toLowerCase()] ?? null;
}

export function resolveWeightClass(stored: string | null | undefined): WeightClassName | null {
  if (!stored) return null;
  const brut = stored.trim();
  const direct = (WEIGHT_CLASSES as readonly string[]).find((w) => w === brut);
  if (direct) return direct as WeightClassName;
  return weightClassLabel(brut) as WeightClassName | null;
}

export type LimiteRefus =
  | "age_inconnu"
  | "classe_inconnue"
  | "genre_manquant"
  | "classe_absente_pour_ce_groupe"
  | "combinaison_absente";

export type LimiteResultat =
  | { ok: true; ageGroup: AgeGroup; weightClass: WeightClassName; maxKg: number | null }
  | { ok: false; raison: LimiteRefus };

export function resolveWeightLimit(input: {
  discipline: Discipline;
  storedAgeGroup: string | null | undefined;
  gender: GenderDb | null | undefined;
  storedWeightClass: string | null | undefined;
}): LimiteResultat {
  const ageGroup = resolveAgeGroup(input.storedAgeGroup);
  if (!ageGroup) return { ok: false, raison: "age_inconnu" };

  const weightClass = resolveWeightClass(input.storedWeightClass);
  if (!weightClass) return { ok: false, raison: "classe_inconnue" };

  const enfant = isChildAgeGroup(ageGroup);
  if (!enfant && !input.gender) return { ok: false, raison: "genre_manquant" };
  const genre: GenderDb = input.gender ?? "male";

  let offertes: ReturnType<typeof listWeightClasses>;
  try {
    offertes = listWeightClasses(input.discipline, ageGroup, genre);
  } catch {
    return { ok: false, raison: "combinaison_absente" };
  }
  const trouvee = offertes.find((o) => o.name === weightClass);
  if (!trouvee) return { ok: false, raison: "classe_absente_pour_ce_groupe" };
  return { ok: true, ageGroup, weightClass, maxKg: trouvee.maxKg };
}

export function limiteRefusMessage(raison: LimiteRefus): string {
  switch (raison) {
    case "age_inconnu":
      return "Catégorie d'âge non reconnue : pesez selon la feuille de l'organisateur.";
    case "classe_inconnue":
      return "Classe de poids non reconnue : pesez selon la feuille de l'organisateur.";
    case "genre_manquant":
      return "Genre du licencié inconnu : impossible d'établir la limite.";
    case "classe_absente_pour_ce_groupe":
      return "Cette classe de poids n'existe pas pour cette catégorie : voyez le commissaire.";
    case "combinaison_absente":
      return "Cette catégorie n'existe pas au référentiel : voyez le commissaire.";
  }
}

export function estCoherentEnfant(code: string, resolu: AgeGroup): boolean {
  const codeEnfant = /^u\d+$/i.test(code.trim());
  return codeEnfant === isChildAgeGroup(resolu);
}

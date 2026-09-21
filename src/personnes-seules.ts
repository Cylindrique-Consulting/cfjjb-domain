import { BELT_RANK_ORDER } from "./belts";
import { resolveAgeGroup, resolveWeightClass } from "./db-vocabulary";
import type { BeltDb } from "./enums";
import { comparerRangs, estCategorieAbsolut } from "./ordre-sportif";
import { AGE_GROUPS, WEIGHT_CLASSES } from "./referential";

/**
 * LES PERSONNES SEULES AU PLANNING : QUELLE CATÉGORIE LEUR DONNE LEUR HORAIRE.
 *
 * ┌─ LA DEMANDE (21/09/2026) ─────────────────────────────────────────────────┐
 * │ Une catégorie à un seul inscrit n'a aucun combat. Elle doit pourtant       │
 * │ figurer au planning, sans occuper de place sur un tatami ni décaler les    │
 * │ heures de fin, à un horaire proche des catégories de poids du même âge et  │
 * │ de la même ceinture : c'est ce qui permet de clore à temps les             │
 * │ inscriptions de l'absolut correspondant. Elle s'y signale par un « * »,    │
 * │ comme sur le planning de l'IBJJF.                                          │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * Le planning n'est donc pas recalculé : chaque personne seule reçoit une
 * catégorie de RÉFÉRENCE, et prend son heure de début (prévue, puis estimée).
 * Chaque écran lit l'heure de la référence dans ses propres données, et le
 * choix de la référence est le même partout.
 *
 * LA RÉFÉRENCE est, parmi les catégories de poids qui ont au moins un combat à
 * disputer, la plus proche selon l'écart, comparé dans cet ordre :
 *   1. même discipline (une compétition héritée mêle encore Gi et No-Gi) ;
 *   2. tranche d'âge la plus proche, la même d'abord ;
 *   3. ceinture la plus proche, la même d'abord ;
 *   4. même genre ;
 *   5. poids le plus proche ;
 *   6. à écart égal, la suivante dans l'ordre sportif (âge, ceinture, poids).
 * Une catégorie de même âge et de même ceinture l'emporte toujours, celle du
 * même genre d'abord : à défaut, la personne seule prend l'horaire de l'autre
 * genre, même âge et même ceinture. L'âge et la ceinture les plus proches ne
 * servent que s'il n'existe aucune catégorie de même âge et de même ceinture.
 *
 * Ni un absolut, ni une autre personne seule ne servent de référence, et un
 * absolut n'est jamais une personne seule : un absolut à un seul inscrit est
 * annulé, pas convoqué. Sans aucune catégorie de référence possible, la
 * personne seule n'a pas d'horaire.
 */

export const MARQUE_PERSONNE_SEULE = "*";

export type CategoriePourPersonneSeule = {
  id: string;
  discipline?: string | null;
  ageGroup?: string | null;
  gender?: string | null;
  belt?: BeltDb | string | null;
  weightClass?: string | null;
  seulInscrit: boolean;
  /** Au moins un combat à disputer (hors bye) : la catégorie a une heure au planning. */
  aDesCombats: boolean;
};

function normaliser(valeur: string | null | undefined): string {
  return (valeur ?? "").trim().toLowerCase();
}

function rangDeTranche(ageGroup: string | null | undefined): number {
  const tranche = resolveAgeGroup(ageGroup);
  return tranche === null ? AGE_GROUPS.length : AGE_GROUPS.indexOf(tranche);
}

function rangDeCeinture(belt: string | null | undefined): number {
  const i = BELT_RANK_ORDER.indexOf(belt as BeltDb);
  return i < 0 ? BELT_RANK_ORDER.length : i;
}

function rangDePoids(weightClass: string | null | undefined): number {
  const classe = resolveWeightClass(weightClass);
  return classe === null ? WEIGHT_CLASSES.length : WEIGHT_CLASSES.indexOf(classe);
}

function avantDansLOrdre(candidate: number, seule: number): number {
  return candidate < seule ? 1 : 0;
}

export function ecartAvecLaReference(
  seule: CategoriePourPersonneSeule,
  candidate: CategoriePourPersonneSeule,
): number[] {
  const tranche = [rangDeTranche(seule.ageGroup), rangDeTranche(candidate.ageGroup)] as const;
  const ceinture = [rangDeCeinture(seule.belt), rangDeCeinture(candidate.belt)] as const;
  const poids = [rangDePoids(seule.weightClass), rangDePoids(candidate.weightClass)] as const;
  return [
    normaliser(seule.discipline) === normaliser(candidate.discipline) ? 0 : 1,
    Math.abs(tranche[0] - tranche[1]),
    Math.abs(ceinture[0] - ceinture[1]),
    normaliser(seule.gender) === normaliser(candidate.gender) ? 0 : 1,
    Math.abs(poids[0] - poids[1]),
    avantDansLOrdre(tranche[1], tranche[0]),
    avantDansLOrdre(ceinture[1], ceinture[0]),
    avantDansLOrdre(poids[1], poids[0]),
  ];
}

export function estPersonneSeule(c: CategoriePourPersonneSeule): boolean {
  return c.seulInscrit && !estCategorieAbsolut(c.weightClass);
}

function peutServirDeReference(c: CategoriePourPersonneSeule): boolean {
  return c.aDesCombats && !c.seulInscrit && !estCategorieAbsolut(c.weightClass);
}

/**
 * La catégorie de référence de chaque personne seule : identifiant de la
 * personne seule vers identifiant de la référence. Une personne seule sans
 * référence possible est absente de la table.
 */
export function referencesDesPersonnesSeules(
  categories: readonly CategoriePourPersonneSeule[],
): Map<string, string> {
  const candidates = categories.filter(peutServirDeReference);
  const references = new Map<string, string>();
  for (const seule of categories) {
    if (!estPersonneSeule(seule)) continue;
    let meilleure: { id: string; ecart: number[] } | null = null;
    for (const candidate of candidates) {
      const ecart = ecartAvecLaReference(seule, candidate);
      const ordre = meilleure === null ? -1 : comparerRangs(ecart, meilleure.ecart);
      if (ordre < 0 || (ordre === 0 && meilleure !== null && candidate.id < meilleure.id)) {
        meilleure = { id: candidate.id, ecart };
      }
    }
    if (meilleure !== null) references.set(seule.id, meilleure.id);
  }
  return references;
}

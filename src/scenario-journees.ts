import { resolveAgeGroup } from "./db-vocabulary";
import { isChildAgeGroup } from "./referential";

/**
 * LA RÉPARTITION DES CATÉGORIES ENTRE LES JOURNÉES, PAR SCÉNARIO (réponses du
 * client du 25/09/2026).
 *
 * - « ibjjf », proposé par défaut (JRS.8 B) : ceintures de couleur Gi le
 *   samedi ; Kids, ceintures blanches Gi puis No-Gi le dimanche. La coupure
 *   vaut pour toutes les tranches d'âge, juvéniles et Masters compris (JRS.2 A).
 *   Une compétition sans Gi de couleur (No-Gi seule par exemple) garde la
 *   règle des ceintures : couleurs le samedi, blanches le dimanche. Une
 *   compétition sans aucune ceinture de couleur hors Kids (Kids seuls) reste
 *   entière le premier jour.
 * - « gi-samedi » : tout le Gi hors Kids, blanches comprises, le samedi ; Kids
 *   et No-Gi le dimanche.
 *
 * Aucune catégorie n'est reportée d'une journée pleine vers l'autre (JRS.7 A) :
 * le dépassement se signale, et la CFJJB déplace des catégories si elle le
 * souhaite. Les journées sont numérotées à partir de 0 ; au-delà de deux jours,
 * seules les journées 0 et 1 reçoivent des catégories.
 */

export type ScenarioDeJournees = "ibjjf" | "gi-samedi";

export type CategoriePourJournee = {
  id: string;
  discipline: "gi" | "nogi";
  ageGroup: string;
  belt: string;
};

const CEINTURES_DE_COULEUR: readonly string[] = [
  "blue",
  "purple",
  "brown",
  "black",
  "coral",
  "red",
];

function estKids(categorie: CategoriePourJournee): boolean {
  const tranche = resolveAgeGroup(categorie.ageGroup);
  return tranche !== null && isChildAgeGroup(tranche);
}

function estDeCouleur(categorie: CategoriePourJournee): boolean {
  return CEINTURES_DE_COULEUR.includes((categorie.belt ?? "").trim().toLowerCase());
}

function premiereJourneeIbjjf(
  categories: readonly CategoriePourJournee[],
): (categorie: CategoriePourJournee) => boolean {
  const giDeCouleur = (categorie: CategoriePourJournee) =>
    !estKids(categorie) && categorie.discipline === "gi" && estDeCouleur(categorie);
  if (categories.some(giDeCouleur)) return giDeCouleur;
  const deCouleur = (categorie: CategoriePourJournee) =>
    !estKids(categorie) && estDeCouleur(categorie);
  if (categories.some(deCouleur)) return deCouleur;
  return () => true;
}

export function repartirParScenario(
  categories: readonly CategoriePourJournee[],
  nbJours: number,
  scenario: ScenarioDeJournees = "ibjjf",
): Map<string, number> {
  const journees = new Map<string, number>();
  if (!(nbJours >= 2)) {
    for (const categorie of categories) journees.set(categorie.id, 0);
    return journees;
  }
  const premiereJournee =
    scenario === "gi-samedi"
      ? (categorie: CategoriePourJournee) => !estKids(categorie) && categorie.discipline === "gi"
      : premiereJourneeIbjjf(categories);
  for (const categorie of categories) {
    journees.set(categorie.id, premiereJournee(categorie) ? 0 : 1);
  }
  return journees;
}

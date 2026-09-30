import { resolveAgeGroup, resolveWeightClass } from "./db-vocabulary";
import { comparerRangs } from "./ordre-sportif";
import { AGE_GROUPS, WEIGHT_CLASSES, isChildAgeGroup, type AgeGroup } from "./referential";

/**
 * L'ORDRE DE DÉPART DES CATÉGORIES ET LEUR PRIORITÉ SUR LES MEILLEURS TATAMIS.
 *
 * Décision du client du 30/09/2026 : hors Kids, les catégories partent par
 * groupes, dans cet ordre (`groupeDeDepart`) :
 *
 *   1. les blanches adultes ;
 *   2. les bleues adultes ;
 *   3. les juvéniles de couleur (les bleues juvéniles) ;
 *   4. les violettes, marrons et noires adultes ;
 *   5. les violettes, marrons et noires Masters ;
 *   6. les bleues Masters ;
 *   7. les blanches juvéniles ;
 *   8. les blanches Masters.
 *
 * Elle remplace les vagues de ceinture d'ORD.1 A (bleues et noires, puis
 * violettes et marrons, puis blanches), les juvéniles en début de programme
 * (ORD.5 C) et les Masters au moment de leur ceinture (ORD.4 A). Le reste des
 * réponses du client du 25/09/2026 tient :
 *   - JRS.4 A et SEP.4 A : les Kids d'abord, Kids Gi puis Kids No-Gi, puis le
 *     Gi, puis le No-Gi. « Les Kids passent toujours en premier sur une
 *     compétition. » ;
 *   - ORD.6 B : chez les Kids, les plus jeunes d'abord (U7, puis U9… U15) ;
 *   - ORD.7 B : dans un groupe, la catégorie de plus longue durée prévue
 *     d'abord ; violettes, marrons et noires y restent mêlées ;
 *   - ORD.11 B : à durée égale, du poids le plus léger au plus lourd, sans
 *     distinction entre hommes et femmes (le sexe n'entre pas dans la clé).
 *
 * La liste du §8 (`rangTatamiPrioritaire`) ne change pas : elle ne sert qu'à
 * répartir les meilleurs tatamis entre des catégories qui partent au même
 * instant (ORD.1 A, ORD.2 A).
 *
 * `rangSportifDeCategorie` (ordre-sportif.ts) reste l'ordre d'AFFICHAGE ;
 * cette clé-ci est l'ordre de PLANNING.
 */

export type CategoriePourPriorite = {
  id: string;
  discipline: "gi" | "nogi";
  ageGroup: string;
  belt: string;
  weightClass: string;
  dureePrevueSecondes: number;
};

const CEINTURES_NOIRES: readonly string[] = ["black", "coral", "red"];

const VIOLETTES_ET_MARRONS: readonly string[] = ["purple", "brown"];

const CEINTURES_KIDS: readonly string[] = ["grey", "yellow", "orange", "green"];

/** Le groupe d'une tranche d'âge ou d'une ceinture inconnue : après les huit groupes. */
export const GROUPE_DE_DEPART_INCONNU = 8;

const RANG_ADULTE: Readonly<Record<string, number>> = {
  noire: 1,
  marron: 2,
  violette: 3,
  bleue: 4,
  blanche: 9,
};

const RANG_MASTER: Readonly<Record<string, number>> = {
  noire: 5,
  marron: 6,
  violette: 7,
  bleue: 8,
  blanche: 10,
};

const RANG_JUVENILE = 11;
const RANG_KIDS = 12;
const RANG_INCONNU = 13;

function codeDeCeinture(belt: string | null | undefined): string {
  return (belt ?? "").trim().toLowerCase();
}

function familleDeCeinture(code: string): string | null {
  if (CEINTURES_NOIRES.includes(code)) return "noire";
  if (code === "brown") return "marron";
  if (code === "purple") return "violette";
  if (code === "blue") return "bleue";
  if (code === "white") return "blanche";
  return null;
}

function estKids(tranche: AgeGroup | null): tranche is AgeGroup {
  return tranche !== null && isChildAgeGroup(tranche);
}

function comparerChaines(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Le groupe de départ d'une catégorie hors Kids, de 0 (blanches adultes) à 7
 * (blanches Masters) : voir l'en-tête. Une ceinture de couleur Kids (grise,
 * jaune, orange, verte) compte avec les bleues ; corail et rouge avec les
 * noires. Une tranche d'âge ou une ceinture inconnue, ou une tranche Kids,
 * rend `GROUPE_DE_DEPART_INCONNU` : les Kids partent avant tous les groupes
 * (`cleDeDepart`), une catégorie inconnue après.
 */
export function groupeDeDepart(cat: Pick<CategoriePourPriorite, "ageGroup" | "belt">): number {
  const tranche = resolveAgeGroup(cat.ageGroup);
  if (tranche === null || isChildAgeGroup(tranche)) return GROUPE_DE_DEPART_INCONNU;
  const code = codeDeCeinture(cat.belt);
  const adulte = tranche === "Adulte";
  const juvenile = tranche === "Juvénile";
  const bleue = code === "blue" || CEINTURES_KIDS.includes(code);
  const superieure = VIOLETTES_ET_MARRONS.includes(code) || CEINTURES_NOIRES.includes(code);
  if (code === "white") return adulte ? 0 : juvenile ? 6 : 7;
  if (juvenile) return bleue || superieure ? 2 : GROUPE_DE_DEPART_INCONNU;
  if (bleue) return adulte ? 1 : 5;
  if (superieure) return adulte ? 3 : 4;
  return GROUPE_DE_DEPART_INCONNU;
}

/**
 * Rang de la catégorie dans la liste du §8, 1 étant la catégorie qui prend le
 * meilleur tatami. Une tranche d'âge ou une ceinture inconnue passe après les
 * Kids.
 */
export function rangTatamiPrioritaire(
  cat: Pick<CategoriePourPriorite, "ageGroup" | "belt">,
): number {
  const tranche = resolveAgeGroup(cat.ageGroup);
  if (tranche === null) return RANG_INCONNU;
  if (isChildAgeGroup(tranche)) return RANG_KIDS;
  if (tranche === "Juvénile") return RANG_JUVENILE;
  const famille = familleDeCeinture(codeDeCeinture(cat.belt));
  if (famille === null) return RANG_INCONNU;
  const rangs = tranche === "Adulte" ? RANG_ADULTE : RANG_MASTER;
  return rangs[famille] ?? RANG_INCONNU;
}

/**
 * Clé de départ, comparée composante par composante (la plus petite part la
 * première) : Kids d'abord ; Gi puis No-Gi ; chez les Kids l'âge, ailleurs le
 * groupe de départ ; la plus longue durée prévue ; le poids.
 */
export function cleDeDepart(cat: CategoriePourPriorite): number[] {
  const tranche = resolveAgeGroup(cat.ageGroup);
  const kids = estKids(tranche);
  const classe = resolveWeightClass(cat.weightClass);
  const duree = Number.isFinite(cat.dureePrevueSecondes) ? cat.dureePrevueSecondes : 0;
  return [
    kids ? 0 : 1,
    cat.discipline === "gi" ? 0 : 1,
    kids ? AGE_GROUPS.indexOf(tranche) : groupeDeDepart(cat),
    0 - duree,
    classe === null ? WEIGHT_CLASSES.length : WEIGHT_CLASSES.indexOf(classe),
  ];
}

export function comparerPourLeDepart(a: CategoriePourPriorite, b: CategoriePourPriorite): number {
  return comparerRangs(cleDeDepart(a), cleDeDepart(b)) || comparerChaines(a.id, b.id);
}

export function trierPourLeDepart<T extends CategoriePourPriorite>(cats: readonly T[]): T[] {
  return cats
    .map((cat) => ({ cat, cle: cleDeDepart(cat) }))
    .sort((a, b) => comparerRangs(a.cle, b.cle) || comparerChaines(a.cat.id, b.cat.id))
    .map(({ cat }) => cat);
}

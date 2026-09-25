import { resolveAgeGroup, resolveWeightClass } from "./db-vocabulary";
import { comparerRangs } from "./ordre-sportif";
import { AGE_GROUPS, WEIGHT_CLASSES, isChildAgeGroup, type AgeGroup } from "./referential";

/**
 * L'ORDRE DE DÉPART DES CATÉGORIES ET LEUR PRIORITÉ SUR LES MEILLEURS TATAMIS.
 *
 * Réponses du client du 25/09/2026 (générateur de planning) :
 *   - ORD.1 A : l'ordre des ceintures (§7) décide de ce qu'un tatami libéré
 *     peut prendre : bleues et noires, puis violettes et marrons, puis
 *     blanches. La liste du §8 ne sert qu'à répartir les tatamis entre les
 *     catégories prêtes (`rangTatamiPrioritaire`).
 *   - ORD.4 A : les Masters de couleur passent au moment de leur ceinture,
 *     comme les adultes ; les adultes gardent les meilleurs tatamis.
 *   - ORD.5 C : les juvéniles en début de programme, avant les adultes.
 *   - ORD.6 B : chez les Kids, les plus jeunes d'abord (U7, puis U9… U15).
 *   - ORD.7 B : à priorité égale, la catégorie de plus longue durée prévue.
 *   - ORD.11 B : à durée égale, du poids le plus léger au plus lourd, sans
 *     distinction entre hommes et femmes (le sexe n'entre pas dans la clé).
 *   - JRS.4 A et SEP.4 A : les Kids d'abord, Kids Gi puis Kids No-Gi, puis le
 *     Gi, puis le No-Gi. « Les Kids passent toujours en premier sur une
 *     compétition. »
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

const PREMIERE_VAGUE: readonly string[] = [
  "blue",
  ...CEINTURES_NOIRES,
  "grey",
  "yellow",
  "orange",
  "green",
];

const DEUXIEME_VAGUE: readonly string[] = ["purple", "brown"];

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

/** 0 : bleues, noires (corail et rouge compris) et ceintures Kids ; 1 : violettes et marrons ; 2 : blanches (et ceinture inconnue). */
export function vagueDeCeinture(belt: string): 0 | 1 | 2 {
  const code = codeDeCeinture(belt);
  if (PREMIERE_VAGUE.includes(code)) return 0;
  if (DEUXIEME_VAGUE.includes(code)) return 1;
  return 2;
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
 * première) : Kids d'abord ; Gi puis No-Gi ; chez les Kids l'âge, ailleurs les
 * juvéniles avant les autres ; la vague de ceinture (hors Kids) ; les noires
 * adultes en tête de leur vague ; la plus longue durée prévue ; le poids.
 */
export function cleDeDepart(cat: CategoriePourPriorite): number[] {
  const tranche = resolveAgeGroup(cat.ageGroup);
  const kids = estKids(tranche);
  const noireAdulte = tranche === "Adulte" && CEINTURES_NOIRES.includes(codeDeCeinture(cat.belt));
  const classe = resolveWeightClass(cat.weightClass);
  const duree = Number.isFinite(cat.dureePrevueSecondes) ? cat.dureePrevueSecondes : 0;
  return [
    kids ? 0 : 1,
    cat.discipline === "gi" ? 0 : 1,
    kids ? AGE_GROUPS.indexOf(tranche) : tranche === "Juvénile" ? 0 : 1,
    kids ? 0 : vagueDeCeinture(cat.belt),
    noireAdulte ? 0 : 1,
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

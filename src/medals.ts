/**
 * Pure medal-need computation — no IO, no Supabase.
 * Rules mirror bracket-generator.ts / jourj podium exactly: the number of
 * bronze medals depends ONLY on third_place_mode and the competitor count.
 *
 * ⚠ CETTE EN-TÊTE DISAIT « The generator never reads bracket_mode, so neither
 * do we ». C'était exact, et c'était le bug : une catégorie en POULE n'a aucun
 * combat de 3e place — la table classe tout le monde — donc `thirdPlaceMode` y
 * est SANS OBJET. Laissé tel quel, `shared_bronze` faisait commander DEUX
 * bronzes pour une poule qui n'en distribue qu'un. Un stock de médailles se
 * commande des semaines à l'avance : l'écart ne se rattrape pas le jour J.
 *
 * Le format arrive donc par catégorie (`CategoryForMedals.format`), et il est
 * OPTIONNEL : absent, il vaut `single_elim` et le décompte est identique au bit
 * près à celui d'avant ce lot.
 */
import type { DrawFormat } from "./competition-format";
import type { ThirdPlaceModeDb } from "./enums";

export type MedalNeed = {
  gold: number;
  silver: number;
  bronze: number;
  total: number;
};

export type CategoryForMedals = {
  competitorCount: number;
  singleCompetitor: boolean;
  /**
   * Le format RÉELLEMENT appliqué, c'est-à-dire `CategoryDraw.appliedFormat` et
   * non le format demandé : une poule repliée en élimination directe distribue
   * ses médailles comme une élimination directe.
   */
  format?: DrawFormat;
};

type MedalOpts = {
  thirdPlaceMode: ThirdPlaceModeDb;
};

/**
 * Bronze count for a category, mirroring the fights the generator actually
 * produces (bracket-generator.ts ~l.287) and how the podium is materialized
 * (jourj/pull-results.ts computeCategoryPodium):
 *
 *   - pool3         → one Pool3 fight only when n ≥ 4 → 1 bronze, else 0.
 *   - shared_bronze → the semi-final losers share bronze:
 *                     n ≥ 4 → 2 losers, n = 3 → 1 loser, n < 3 → 0.
 */
function bronzeNeed(mode: ThirdPlaceModeDb, n: number): number {
  if (mode === "shared_bronze") {
    return n >= 4 ? 2 : n === 3 ? 1 : 0;
  }
  // "pool3": a dedicated third-place fight is generated only for n ≥ 4.
  return n >= 4 ? 1 : 0;
}

/**
 * Bronze d'une POULE : le 3e de la table, et il est unique.
 *
 * `thirdPlaceMode` n'entre pas dans ce calcul, et c'est le fond du correctif —
 * il n'existe pas de « demi-finalistes » à faire partager, ni de combat de 3e
 * place à programmer. Un bronze dès qu'il y a un troisième classé (n ≥ 3),
 * aucun en dessous. JAMAIS DEUX.
 */
function poolBronzeNeed(n: number): number {
  return n >= 3 ? 1 : 0;
}

function computeCategoryMedalNeed(cat: CategoryForMedals, opts: MedalOpts): MedalNeed {
  const n = cat.competitorCount;

  // No competitors → no medals.
  if (n === 0) return { gold: 0, silver: 0, bronze: 0, total: 0 };

  // 1 competitor (singleCompetitor flag OR count==1) → automatic gold only.
  // Mirrors the "1 inscrit → or automatique" rule in brackets/page.tsx.
  if (cat.singleCompetitor || n === 1) {
    return { gold: 1, silver: 0, bronze: 0, total: 1 };
  }

  // 2+ competitors: always gold + silver, plus bronze per FORMAT then
  // third_place_mode. Le format d'abord : en poule, le mode de 3e place n'a
  // aucun sens et ne doit pas être consulté.
  const bronze = cat.format === "pools" ? poolBronzeNeed(n) : bronzeNeed(opts.thirdPlaceMode, n);

  return { gold: 1, silver: 1, bronze, total: 2 + bronze };
}

export function computeMedalNeed(categories: CategoryForMedals[], opts: MedalOpts): MedalNeed {
  let gold = 0;
  let silver = 0;
  let bronze = 0;
  for (const cat of categories) {
    const need = computeCategoryMedalNeed(cat, opts);
    gold += need.gold;
    silver += need.silver;
    bronze += need.bronze;
  }
  return { gold, silver, bronze, total: gold + silver + bronze };
}

export function computeMedalSummary(
  categories: CategoryForMedals[],
  opts: MedalOpts,
  medalsDistributed: number,
): { need: MedalNeed; distributed: number; remaining: number } {
  const need = computeMedalNeed(categories, opts);
  return {
    need,
    distributed: medalsDistributed,
    remaining: Math.max(0, need.total - medalsDistributed),
  };
}

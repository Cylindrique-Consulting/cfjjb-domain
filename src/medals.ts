/**
 * Pure medal-need computation — no IO, no Supabase.
 * Rules mirror bracket-generator.ts / jourj podium exactly: the number of
 * bronze medals depends ONLY on third_place_mode and the competitor count.
 * The generator never reads bracket_mode, so neither do we.
 */
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

function computeCategoryMedalNeed(cat: CategoryForMedals, opts: MedalOpts): MedalNeed {
  const n = cat.competitorCount;

  // No competitors → no medals.
  if (n === 0) return { gold: 0, silver: 0, bronze: 0, total: 0 };

  // 1 competitor (singleCompetitor flag OR count==1) → automatic gold only.
  // Mirrors the "1 inscrit → or automatique" rule in brackets/page.tsx.
  if (cat.singleCompetitor || n === 1) {
    return { gold: 1, silver: 0, bronze: 0, total: 1 };
  }

  // 2+ competitors: always gold + silver, plus bronze per third_place_mode.
  const bronze = bronzeNeed(opts.thirdPlaceMode, n);

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

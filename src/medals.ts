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
  format?: DrawFormat;
};

type MedalOpts = {
  thirdPlaceMode: ThirdPlaceModeDb;
};

function bronzeNeed(mode: ThirdPlaceModeDb, n: number): number {
  if (n === 3) return 1;
  if (mode === "shared_bronze") {
    return n >= 4 ? 2 : 0;
  }
  return n >= 4 ? 1 : 0;
}

function poolBronzeNeed(n: number): number {
  return n >= 3 ? 1 : 0;
}

function computeCategoryMedalNeed(cat: CategoryForMedals, opts: MedalOpts): MedalNeed {
  const n = cat.competitorCount;

  if (n === 0) return { gold: 0, silver: 0, bronze: 0, total: 0 };

  if (cat.singleCompetitor || n === 1) {
    return { gold: 1, silver: 0, bronze: 0, total: 1 };
  }

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

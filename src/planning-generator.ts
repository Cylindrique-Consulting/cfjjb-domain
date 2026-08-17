import { AGE_GROUPS, WEIGHT_CLASSES, isChildAgeGroup, type AgeGroup } from "./referential";
import type { GeneratedFight } from "./bracket-generator";
import type { BeltDb, DisciplineDb } from "./enums";
import { ALL_BELTS } from "./belts";

/**
 * Planning generator: distributes categories over the physical tatamis and
 * computes sequential fight start times.
 *
 * - Phases: children first (default), then juveniles/adults/masters.
 * - Assignment: LPT (longest processing time) on the cumulated tatami load.
 * - Intra-tatami order: phase, then age group, belt, weight class,
 *   discipline (spectator-friendly grouping; load balance is unchanged).
 * - Times: one timeline per PHYSICAL tatami (Jour J splits a physical mat
 *   into one fight_area per Jour J competition, but the day is sequential
 *   on the mat). Within a category: deepest division first, index
 *   ascending, then the Pool3, then the final (finalists get to rest).
 * - Byes get no start time (Jour J's planning hides fights without one).
 */

export type PlanningCategory = {
  id: string;
  discipline: DisciplineDb;
  belt: BeltDb;
  ageGroup: AgeGroup;
  weightClass: string;
  fightTimeSeconds: number;
  /** Real (non-bye) fights, Pool3 included. */
  realFightCount: number;
};

export type PlanningParams = {
  tatamiCount: number;
  bufferSeconds?: number;
  childrenFirst?: boolean;
};

export type TatamiPlan = {
  tatamiIndex: number; // 0-based
  categoryIds: string[]; // ordered
  totalSeconds: number;
};

// CYL-434 — c'était une DUPLICATION LITTÉRALE d'`ALL_BELTS`
// (`lib/licensees/belts.ts`), au caractère près. Deux listes de grades
// finissent toujours par diverger, et la divergence serait muette : un
// planning trierait les catégories dans un ordre, l'éligibilité dans un autre.
const BELT_ORDER: ReadonlyArray<BeltDb> = ALL_BELTS;

function categoryDurationSeconds(cat: PlanningCategory, bufferSeconds: number): number {
  return cat.realFightCount * (cat.fightTimeSeconds + bufferSeconds);
}

function intraTatamiRank(cat: PlanningCategory): number[] {
  return [
    isChildAgeGroup(cat.ageGroup) ? 0 : 1,
    AGE_GROUPS.indexOf(cat.ageGroup),
    BELT_ORDER.indexOf(cat.belt),
    WEIGHT_CLASSES.indexOf(cat.weightClass as (typeof WEIGHT_CLASSES)[number]),
    cat.discipline === "gi" ? 0 : 1,
  ];
}

function compareRanks(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * Assign categories to tatamis (LPT per phase, cumulative loads) and order
 * them inside each tatami.
 */
export function planCategories(
  categories: PlanningCategory[],
  params: PlanningParams,
): TatamiPlan[] {
  const buffer = params.bufferSeconds ?? 60;
  const childrenFirst = params.childrenFirst ?? true;
  const count = Math.max(1, params.tatamiCount);

  const loads = new Array<number>(count).fill(0);
  const assigned: PlanningCategory[][] = Array.from({ length: count }, () => []);

  const phases: PlanningCategory[][] = childrenFirst
    ? [
        categories.filter((c) => isChildAgeGroup(c.ageGroup)),
        categories.filter((c) => !isChildAgeGroup(c.ageGroup)),
      ]
    : [categories];

  for (const phase of phases) {
    const byDuration = [...phase].sort(
      (a, b) => categoryDurationSeconds(b, buffer) - categoryDurationSeconds(a, buffer),
    );
    for (const cat of byDuration) {
      let best = 0;
      for (let t = 1; t < count; t++) {
        if ((loads[t] ?? 0) < (loads[best] ?? 0)) best = t;
      }
      loads[best] = (loads[best] ?? 0) + categoryDurationSeconds(cat, buffer);
      assigned[best]?.push(cat);
    }
  }

  return assigned.map((cats, tatamiIndex) => {
    const ordered = [...cats].sort((a, b) => compareRanks(intraTatamiRank(a), intraTatamiRank(b)));
    return {
      tatamiIndex,
      categoryIds: ordered.map((c) => c.id),
      totalSeconds: loads[tatamiIndex] ?? 0,
    };
  });
}

// ------------------------------------------------------------------
// Fight scheduling
// ------------------------------------------------------------------

export type SchedulableCategory = {
  id: string;
  fightTimeSeconds: number;
  fights: Array<Pick<GeneratedFight, "division" | "indexInDivision" | "type" | "isBye">>;
};

export type FightTimeKey = string; // `${categoryId}:${division}:${indexInDivision}:${type}`

export function fightTimeKey(
  categoryId: string,
  fight: Pick<GeneratedFight, "division" | "indexInDivision" | "type">,
): FightTimeKey {
  return `${categoryId}:${fight.division}:${fight.indexInDivision}:${fight.type}`;
}

/**
 * Spectator/fighter friendly running order inside a category:
 * deepest division first (index ascending), then the Pool3, then the final.
 */
export function categoryRunningOrder<
  T extends Pick<GeneratedFight, "division" | "indexInDivision" | "type">,
>(fights: T[]): T[] {
  const regular = fights.filter((f) => f.type === "BraketFight");
  const pool3 = fights.filter((f) => f.type === "BraketFightPool3");
  const final = regular.filter((f) => f.division === 1);
  const earlier = regular
    .filter((f) => f.division > 1)
    .sort((a, b) => b.division - a.division || a.indexInDivision - b.indexInDivision);
  return [...earlier, ...pool3, ...final];
}

export type ScheduleResult = {
  /** Start time (epoch ms) per real fight; byes are absent. */
  fightTimes: Map<FightTimeKey, number>;
  /** Start time (epoch ms) of each category's first real fight. */
  categoryStarts: Map<string, number>;
  /** End of the tatami's day (epoch ms). */
  endsAt: number;
};

/**
 * Sequential schedule of one tatami: categories in order, each category's
 * real fights back-to-back (fight time + buffer).
 */
export function computeTatamiSchedule(
  orderedCategories: SchedulableCategory[],
  startAtMs: number,
  bufferSeconds = 60,
): ScheduleResult {
  const fightTimes = new Map<FightTimeKey, number>();
  const categoryStarts = new Map<string, number>();
  let cursor = startAtMs;

  for (const cat of orderedCategories) {
    const real = categoryRunningOrder(cat.fights).filter((f) => !f.isBye);
    if (real.length > 0) categoryStarts.set(cat.id, cursor);
    for (const fight of real) {
      fightTimes.set(fightTimeKey(cat.id, fight), cursor);
      cursor += (cat.fightTimeSeconds + bufferSeconds) * 1000;
    }
  }

  return { fightTimes, categoryStarts, endsAt: cursor };
}

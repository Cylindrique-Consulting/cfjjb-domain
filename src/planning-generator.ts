import { AGE_GROUPS, WEIGHT_CLASSES, isChildAgeGroup, type AgeGroup } from "./referential";
import type { GeneratedFight } from "./bracket-generator";
import type { DrawFormat } from "./competition-format";
import type { BeltDb, DisciplineDb } from "./enums";
import { BELT_RANK_ORDER } from "./belts";

export type PlanningCategory = {
  id: string;
  discipline: DisciplineDb;
  belt: BeltDb;
  ageGroup: AgeGroup;
  weightClass: string;
  fightTimeSeconds: number;
  realFightCount: number;
};

export type PlanningParams = {
  tatamiCount: number;
  bufferSeconds?: number;
  childrenFirst?: boolean;
};

export type TatamiPlan = {
  tatamiIndex: number;
  categoryIds: string[];
  totalSeconds: number;
};

const BELT_ORDER: ReadonlyArray<BeltDb> = BELT_RANK_ORDER;

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

export type PlanningDay = {
  startAtMs: number;
  endAtMs: number;
};

export type MultiDayPlanningParams = PlanningParams & {
  days: PlanningDay[];
};

export type DayPlan = {
  dayIndex: number;
  startAtMs: number;
  endAtMs: number;
  tatamis: TatamiPlan[];
  overrunSeconds: number;
};

function dayLengthSeconds(day: PlanningDay): number {
  const ms = day.endAtMs - day.startAtMs;
  return ms > 0 ? ms / 1000 : Number.POSITIVE_INFINITY;
}

export function assignCategoriesToDays(
  categories: PlanningCategory[],
  params: MultiDayPlanningParams,
): PlanningCategory[][] {
  const days = params.days;
  if (days.length === 0) {
    throw new Error("planning : au moins un jour de compétition est requis.");
  }
  if (days.length === 1) return [[...categories]];

  const buffer = params.bufferSeconds ?? 60;
  const tatamiCount = Math.max(1, params.tatamiCount);
  const lengths = days.map(dayLengthSeconds);
  const capacities = lengths.map((length) => length * tatamiCount);
  const loads = new Array<number>(days.length).fill(0);
  const lastIndex = days.length - 1;

  const canonical = [...categories].sort((a, b) =>
    compareRanks(intraTatamiRank(a), intraTatamiRank(b)),
  );

  const dayOf = new Map<string, number>();
  let cursor = 0;
  for (const cat of canonical) {
    const duration = categoryDurationSeconds(cat, buffer);
    let target = lastIndex;
    for (let d = cursor; d < lastIndex; d++) {
      const tientSurUnTatami = duration <= (lengths[d] ?? 0);
      const tientDansLaJournee = (loads[d] ?? 0) + duration <= (capacities[d] ?? 0);
      if (tientSurUnTatami && tientDansLaJournee) {
        target = d;
        break;
      }
    }
    loads[target] = (loads[target] ?? 0) + duration;
    dayOf.set(cat.id, target);
    cursor = target;
  }

  return days.map((_day, dayIndex) => categories.filter((c) => dayOf.get(c.id) === dayIndex));
}

export function planCategoriesOverDays(
  categories: PlanningCategory[],
  params: MultiDayPlanningParams,
): DayPlan[] {
  const perDay = assignCategoriesToDays(categories, params);

  return params.days.map((day, dayIndex) => {
    const tatamis = planCategories(perDay[dayIndex] ?? [], params);
    const busiestSeconds = tatamis.reduce((max, t) => Math.max(max, t.totalSeconds), 0);
    const length = dayLengthSeconds(day);
    return {
      dayIndex,
      startAtMs: day.startAtMs,
      endAtMs: day.endAtMs,
      tatamis,
      overrunSeconds: Number.isFinite(length) ? Math.max(0, busiestSeconds - length) : 0,
    };
  });
}

export type SchedulableCategory = {
  id: string;
  fightTimeSeconds: number;
  fights: Array<Pick<GeneratedFight, "division" | "indexInDivision" | "type" | "isBye">>;
  format?: DrawFormat;
};

export type FightTimeKey = string;

export function fightTimeKey(
  categoryId: string,
  fight: Pick<GeneratedFight, "division" | "indexInDivision" | "type">,
): FightTimeKey {
  return `${categoryId}:${fight.division}:${fight.indexInDivision}:${fight.type}`;
}

export function categoryRunningOrder<
  T extends Pick<GeneratedFight, "division" | "indexInDivision" | "type">,
>(fights: T[], opts: { format?: DrawFormat } = {}): T[] {
  if (opts.format === "pools") {
    return [...fights].sort((a, b) => a.indexInDivision - b.indexInDivision);
  }
  const parOrdreDeRonde = (a: T, b: T): number =>
    b.division - a.division || a.indexInDivision - b.indexInDivision;

  const rondes = fights.filter((f) => f.type === "BraketFight");
  const annexes = fights.filter((f) => f.type !== "BraketFight").sort(parOrdreDeRonde);
  const finale = rondes.filter((f) => f.division === 1);
  const precedentes = rondes.filter((f) => f.division > 1).sort(parOrdreDeRonde);
  return [...precedentes, ...annexes, ...finale];
}

export type ScheduleResult = {
  fightTimes: Map<FightTimeKey, number>;
  categoryStarts: Map<string, number>;
  endsAt: number;
};

export function computeTatamiSchedule(
  orderedCategories: SchedulableCategory[],
  startAtMs: number,
  bufferSeconds = 60,
): ScheduleResult {
  const fightTimes = new Map<FightTimeKey, number>();
  const categoryStarts = new Map<string, number>();
  let cursor = startAtMs;

  for (const cat of orderedCategories) {
    const real = categoryRunningOrder(cat.fights, { format: cat.format }).filter((f) => !f.isBye);
    if (real.length > 0) categoryStarts.set(cat.id, cursor);
    for (const fight of real) {
      fightTimes.set(fightTimeKey(cat.id, fight), cursor);
      cursor += (cat.fightTimeSeconds + bufferSeconds) * 1000;
    }
  }

  return { fightTimes, categoryStarts, endsAt: cursor };
}

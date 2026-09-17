import type { BracketEntry, GeneratedFight } from "./bracket-generator";
import { generateCategoryDraw, type CategoryDraw, type DrawFallback } from "./category-draw";
import { formatForAgeGroup, type DrawFormat, type FormatByAgeGroup } from "./competition-format";
import { breakdownRegistrations, isActiveBracketStatus, type FillBreakdown } from "./capacity";
import { resolveAgeGroup, resolveWeightClass } from "./db-vocabulary";
import type { BeltDb, DisciplineDb, GenderDb, ThirdPlaceMode } from "./enums";
import { computeMedalNeed, type MedalNeed } from "./medals";
import {
  computeTatamiSchedule,
  planCategories,
  type PlanningCategory,
  type SchedulableCategory,
} from "./planning-generator";
import { MAX_POOL_SIZE_DEFAULT } from "./pool-generator";
import {
  buildCategoryFullname,
  getFightDurationSeconds,
  type AgeGroup,
  type WeightClassName,
} from "./referential";

export type SizingRegistration = {
  readonly registrationId: string;
  readonly clubId?: string | null;
  readonly status: string;
  readonly discipline: DisciplineDb | null;
  readonly belt: BeltDb | null;
  readonly ageGroup: string | null;
  readonly gender: GenderDb | null;
  readonly weightClass: string | null;
};

export function sizingTupleKey(r: {
  discipline: string;
  belt: string;
  ageGroup: string;
  gender: string;
  weightClass: string;
}): string {
  return [r.discipline, r.belt, r.ageGroup, r.gender, r.weightClass].join("|");
}

export type VirtualCategory = {
  readonly key: string;
  readonly discipline: DisciplineDb;
  readonly belt: BeltDb;
  readonly ageGroup: AgeGroup;
  readonly gender: GenderDb;
  readonly weightClass: WeightClassName;
  readonly fullname: string;
  readonly fightTimeSeconds: number;
  readonly competitorCount: number;
  readonly singleCompetitor: boolean;
  readonly registrationIds: readonly string[];
  readonly requestedFormat: DrawFormat;
  readonly appliedFormat: DrawFormat;
  readonly fallback?: DrawFallback;
  readonly fights: readonly GeneratedFight[];
  readonly realFightCount: number;
};

export type SizingRejections = {
  readonly colonnesManquantes: number;
  readonly ageNonResolu: number;
  readonly classeNonResolue: number;
  readonly dureeInconnue: number;
};

export type CategoryProjection = {
  readonly categories: readonly VirtualCategory[];
  readonly breakdown: FillBreakdown;
  readonly rejections: SizingRejections;
};

export type ProjectionOptions = {
  readonly thirdPlaceMode: ThirdPlaceMode;
  readonly formatTable?: Partial<FormatByAgeGroup>;
  readonly maxPoolSize?: number;
  readonly seed?: string;
};

function drawFights(draw: CategoryDraw): {
  fights: readonly GeneratedFight[];
  realFightCount: number;
} {
  if (draw.appliedFormat === "pools") {
    return draw.pool.kind === "pool"
      ? { fights: draw.pool.fights, realFightCount: draw.pool.realFightCount }
      : { fights: [], realFightCount: 0 };
  }
  return draw.bracket.kind === "bracket"
    ? { fights: draw.bracket.fights, realFightCount: draw.bracket.realFightCount }
    : { fights: [], realFightCount: 0 };
}

export function projectCategories(
  rows: readonly SizingRegistration[],
  opts: ProjectionOptions,
): CategoryProjection {
  const breakdown = breakdownRegistrations(rows.map((r) => r.status));

  let colonnesManquantes = 0;
  let ageNonResolu = 0;
  let classeNonResolue = 0;
  let dureeInconnue = 0;

  type Groupe = {
    key: string;
    discipline: DisciplineDb;
    belt: BeltDb;
    ageGroup: AgeGroup;
    gender: GenderDb;
    weightClass: WeightClassName;
    fightTimeSeconds: number;
    entries: BracketEntry[];
  };
  const groupes = new Map<string, Groupe>();

  for (const row of rows) {
    if (!isActiveBracketStatus(row.status)) continue;

    const { discipline, belt, gender } = row;
    if (!discipline || !belt || !gender || !row.ageGroup || !row.weightClass) {
      colonnesManquantes++;
      continue;
    }

    const ageGroup = resolveAgeGroup(row.ageGroup);
    if (!ageGroup) {
      ageNonResolu++;
      continue;
    }
    const weightClass = resolveWeightClass(row.weightClass);
    if (!weightClass) {
      classeNonResolue++;
      continue;
    }
    const fightTimeSeconds = getFightDurationSeconds(belt, ageGroup, discipline);
    if (fightTimeSeconds === null) {
      dureeInconnue++;
      continue;
    }

    const key = sizingTupleKey({
      discipline,
      belt,
      ageGroup: row.ageGroup,
      gender,
      weightClass: row.weightClass,
    });

    const existant = groupes.get(key);
    const entry: BracketEntry = { registrationId: row.registrationId, clubId: row.clubId ?? null };
    if (existant) existant.entries.push(entry);
    else {
      groupes.set(key, {
        key,
        discipline,
        belt,
        ageGroup,
        gender,
        weightClass,
        fightTimeSeconds,
        entries: [entry],
      });
    }
  }

  const maxPoolSize = opts.maxPoolSize ?? MAX_POOL_SIZE_DEFAULT;
  const categories: VirtualCategory[] = [];

  for (const groupe of groupes.values()) {
    const fullname = buildCategoryFullname({
      belt: groupe.belt,
      ageGroup: groupe.ageGroup,
      gender: groupe.gender,
      weightClass: groupe.weightClass,
    });
    const requestedFormat = formatForAgeGroup(groupe.ageGroup, opts.formatTable);
    const draw = generateCategoryDraw(
      groupe.entries,
      `${opts.seed ?? "dimensionnement"}:${fullname}`,
      {
        format: requestedFormat,
        thirdPlaceMode: opts.thirdPlaceMode,
        maxPoolSize,
      },
    );
    const { fights, realFightCount } = drawFights(draw);

    categories.push({
      key: groupe.key,
      discipline: groupe.discipline,
      belt: groupe.belt,
      ageGroup: groupe.ageGroup,
      gender: groupe.gender,
      weightClass: groupe.weightClass,
      fullname,
      fightTimeSeconds: groupe.fightTimeSeconds,
      competitorCount: groupe.entries.length,
      singleCompetitor: groupe.entries.length === 1,
      registrationIds: groupe.entries.map((e) => e.registrationId),
      requestedFormat,
      appliedFormat: draw.appliedFormat,
      ...(draw.appliedFormat === "single_elim" && draw.fallback ? { fallback: draw.fallback } : {}),
      fights,
      realFightCount,
    });
  }

  return {
    categories,
    breakdown,
    rejections: { colonnesManquantes, ageNonResolu, classeNonResolue, dureeInconnue },
  };
}

export function toPlanningCategories(categories: readonly VirtualCategory[]): PlanningCategory[] {
  return categories
    .filter((c) => !c.singleCompetitor)
    .map((c) => ({
      id: c.key,
      discipline: c.discipline,
      belt: c.belt,
      ageGroup: c.ageGroup,
      weightClass: c.weightClass,
      fightTimeSeconds: c.fightTimeSeconds,
      realFightCount: c.realFightCount,
    }));
}

export function toSchedulableCategories(
  categories: readonly VirtualCategory[],
): Map<string, SchedulableCategory> {
  const out = new Map<string, SchedulableCategory>();
  for (const c of categories) {
    if (c.singleCompetitor) continue;
    out.set(c.key, {
      id: c.key,
      fightTimeSeconds: c.fightTimeSeconds,
      fights: [...c.fights],
      format: c.appliedFormat,
    });
  }
  return out;
}

export type TatamiCandidate = {
  readonly tatamiCount: number;
  readonly endsAtMs: number;
  readonly longestTatamiSeconds: number;
  readonly overrunSeconds: number;
  readonly fits: boolean;
};

export type TatamiRecommendationOptions = {
  readonly dayStartMs: number;
  readonly dayEndMs: number;
  readonly bufferSeconds?: number;
  readonly maxTatamiCount?: number;
  readonly declaredTatamiCount?: number;
};

export const MAX_TATAMI_COUNT = 99;

export function evaluateTatamiCount(
  categories: readonly VirtualCategory[],
  tatamiCount: number,
  opts: TatamiRecommendationOptions,
): TatamiCandidate {
  const bufferSeconds = opts.bufferSeconds;
  const plans = planCategories(toPlanningCategories(categories), {
    tatamiCount,
    ...(bufferSeconds === undefined ? {} : { bufferSeconds }),
  });
  const schedulables = toSchedulableCategories(categories);

  let endsAtMs = opts.dayStartMs;
  for (const plan of plans) {
    const ordonnees = plan.categoryIds.flatMap((id) => {
      const cat = schedulables.get(id);
      return cat ? [cat] : [];
    });
    const schedule = computeTatamiSchedule(ordonnees, opts.dayStartMs, bufferSeconds);
    if (schedule.endsAt > endsAtMs) endsAtMs = schedule.endsAt;
  }

  const finInconnue = opts.dayEndMs <= opts.dayStartMs;
  const overrunMs = finInconnue ? 0 : Math.max(0, endsAtMs - opts.dayEndMs);
  return {
    tatamiCount,
    endsAtMs,
    longestTatamiSeconds: (endsAtMs - opts.dayStartMs) / 1000,
    overrunSeconds: overrunMs / 1000,
    fits: finInconnue || endsAtMs <= opts.dayEndMs,
  };
}

export type TatamiRecommendation = {
  readonly recommended: number | null;
  readonly candidates: readonly TatamiCandidate[];
  readonly declared?: TatamiCandidate;
};

export function recommendTatamiCount(
  categories: readonly VirtualCategory[],
  opts: TatamiRecommendationOptions,
): TatamiRecommendation {
  const max = Math.max(1, Math.floor(opts.maxTatamiCount ?? MAX_TATAMI_COUNT));
  const candidates: TatamiCandidate[] = [];
  let recommended: number | null = null;

  for (let t = 1; t <= max; t++) {
    const candidate = evaluateTatamiCount(categories, t, opts);
    candidates.push(candidate);
    if (candidate.fits) {
      recommended = t;
      break;
    }
  }

  const declaredCount = opts.declaredTatamiCount;
  const declared =
    declaredCount === undefined
      ? undefined
      : (candidates.find((c) => c.tatamiCount === declaredCount) ??
        evaluateTatamiCount(categories, Math.max(1, Math.floor(declaredCount)), opts));

  return { recommended, candidates, ...(declared ? { declared } : {}) };
}

export type SizingPanel = {
  readonly projection: CategoryProjection;
  readonly categoryCount: number;
  readonly competitorCount: number;
  readonly singleCompetitorCount: number;
  readonly fightCount: number;
  readonly totalFightSeconds: number;
  readonly medals: MedalNeed;
  readonly recommendation: TatamiRecommendation;
};

export type SizingPanelOptions = ProjectionOptions & TatamiRecommendationOptions;

export function buildSizingPanel(
  rows: readonly SizingRegistration[],
  opts: SizingPanelOptions,
): SizingPanel {
  const projection = projectCategories(rows, opts);
  const { categories } = projection;

  const bufferSeconds = opts.bufferSeconds ?? 60;
  let competitorCount = 0;
  let singleCompetitorCount = 0;
  let fightCount = 0;
  let totalFightSeconds = 0;
  for (const c of categories) {
    competitorCount += c.competitorCount;
    if (c.singleCompetitor) singleCompetitorCount++;
    else {
      fightCount += c.realFightCount;
      totalFightSeconds += c.realFightCount * (c.fightTimeSeconds + bufferSeconds);
    }
  }

  const medals = computeMedalNeed(
    categories.map((c) => ({
      competitorCount: c.competitorCount,
      singleCompetitor: c.singleCompetitor,
      format: c.appliedFormat,
    })),
    { thirdPlaceMode: opts.thirdPlaceMode },
  );

  return {
    projection,
    categoryCount: categories.length,
    competitorCount,
    singleCompetitorCount,
    fightCount,
    totalFightSeconds,
    medals,
    recommendation: recommendTatamiCount(categories, opts),
  };
}

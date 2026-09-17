import { generateBracket, type BracketEntry, type BracketResult } from "./bracket-generator";
import type { DrawFormat } from "./competition-format";
import type { ThirdPlaceMode } from "./enums";
import {
  generatePool,
  MAX_POOL_SIZE_DEFAULT,
  poolFightCount,
  type PoolResult,
} from "./pool-generator";
import type { SeedingPlan } from "./seeding-plan";

export type DrawFallback = {
  readonly code: "pool-too-large";
  readonly requestedFormat: "pools";
  readonly appliedFormat: "single_elim";
  readonly competitorCount: number;
  readonly maxPoolSize: number;
  readonly poolFightCount: number;
  readonly bracketFightCount: number;
};

export type CategoryDraw =
  | {
      readonly appliedFormat: "single_elim";
      readonly requestedFormat: DrawFormat;
      readonly fallback?: DrawFallback;
      readonly bracket: BracketResult;
    }
  | {
      readonly appliedFormat: "pools";
      readonly requestedFormat: "pools";
      readonly pool: PoolResult;
    };

export type CategoryDrawOptions = {
  readonly format: DrawFormat;
  readonly thirdPlaceMode: ThirdPlaceMode;
  readonly maxPoolSize?: number;
  readonly seedingPlan?: SeedingPlan;
};

export function resolveDrawFormat(
  requested: DrawFormat,
  competitorCount: number,
  maxPoolSize: number = MAX_POOL_SIZE_DEFAULT,
): { applied: DrawFormat; fallback?: DrawFallback } {
  if (requested !== "pools") return { applied: "single_elim" };
  if (competitorCount <= maxPoolSize) return { applied: "pools" };
  return {
    applied: "single_elim",
    fallback: {
      code: "pool-too-large",
      requestedFormat: "pools",
      appliedFormat: "single_elim",
      competitorCount,
      maxPoolSize,
      poolFightCount: poolFightCount(competitorCount),
      bracketFightCount: competitorCount - 1,
    },
  };
}

export function generateCategoryDraw(
  entries: BracketEntry[],
  seed: string,
  opts: CategoryDrawOptions,
): CategoryDraw {
  const maxPoolSize = opts.maxPoolSize ?? MAX_POOL_SIZE_DEFAULT;
  const decision = resolveDrawFormat(opts.format, entries.length, maxPoolSize);

  if (decision.applied === "pools") {
    return {
      appliedFormat: "pools",
      requestedFormat: "pools",
      pool: generatePool(entries, seed, { maxSize: maxPoolSize }),
    };
  }

  const bracket = generateBracket(entries, seed, {
    thirdPlaceMode: opts.thirdPlaceMode,
    ...(opts.seedingPlan ? { seedingPlan: opts.seedingPlan } : {}),
  });

  return {
    appliedFormat: "single_elim",
    requestedFormat: opts.format,
    ...(decision.fallback ? { fallback: decision.fallback } : {}),
    bracket,
  };
}

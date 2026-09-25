/**
 * LA CAPACITÉ EST CALCULÉE, JAMAIS SAISIE.
 */

import { resolveDrawFormat, type DrawFallback } from "./category-draw";
import type { DrawFormat } from "./competition-format";
import type { ThirdPlaceMode } from "./enums";
import { MAX_POOL_SIZE_DEFAULT, poolFightCount } from "./pool-generator";

export type RegistrationStatusDb =
  "pre_registered" | "registered" | "validated" | "paid" | "withdrawn" | "no_show";

export const REGISTRATION_STATUSES = [
  "pre_registered",
  "registered",
  "validated",
  "paid",
  "withdrawn",
  "no_show",
] as const satisfies readonly RegistrationStatusDb[];

export const ACTIVE_BRACKET_STATUSES = [
  "registered",
  "validated",
  "paid",
] as const satisfies readonly RegistrationStatusDb[];

export function isActiveBracketStatus(status: string): boolean {
  return (ACTIVE_BRACKET_STATUSES as readonly string[]).includes(status);
}

export function isRegistrationStatus(status: string): status is RegistrationStatusDb {
  return (REGISTRATION_STATUSES as readonly string[]).includes(status);
}

export function countsInRegistrationTotal(status: string): boolean {
  return isRegistrationStatus(status) && status !== "withdrawn";
}

export function statusesCountedButNotDrawn(): RegistrationStatusDb[] {
  return REGISTRATION_STATUSES.filter(
    (s) => countsInRegistrationTotal(s) && !isActiveBracketStatus(s),
  );
}

export type FillBreakdown = {
  readonly active: number;
  readonly preRegistered: number;
  readonly noShow: number;
  readonly withdrawn: number;
  readonly countedTotal: number;
  readonly unknown: number;
};

export function breakdownRegistrations(statuses: readonly string[]): FillBreakdown {
  let active = 0;
  let preRegistered = 0;
  let noShow = 0;
  let withdrawn = 0;
  let countedTotal = 0;
  let unknown = 0;

  for (const brut of statuses) {
    const status = brut.trim();
    if (!isRegistrationStatus(status)) {
      unknown++;
      continue;
    }
    if (countsInRegistrationTotal(status)) countedTotal++;
    if (isActiveBracketStatus(status)) active++;
    else if (status === "pre_registered") preRegistered++;
    else if (status === "no_show") noShow++;
    else withdrawn++;
  }

  return { active, preRegistered, noShow, withdrawn, countedTotal, unknown };
}

export type CategoryShape = {
  readonly competitorsPerCategory: number;
  readonly format: DrawFormat;
  readonly thirdPlaceMode?: ThirdPlaceMode;
  readonly maxPoolSize?: number;
};

export function fightsPerCompetitor(shape: CategoryShape): number {
  const n = Math.ceil(shape.competitorsPerCategory);
  if (!Number.isFinite(n) || n < 2) return 0;

  const maxPoolSize = shape.maxPoolSize ?? MAX_POOL_SIZE_DEFAULT;
  const { applied } = resolveDrawFormat(shape.format, n, maxPoolSize);

  if (applied === "pools") return poolFightCount(n) / n;

  const thirdPlace = (shape.thirdPlaceMode ?? "pool3") === "pool3" && n >= 4 ? 1 : 0;

  const repechage3 = n === 3 ? 1 : 0;

  return (n - 1 + thirdPlace + repechage3) / n;
}

/** Temps de rotation entre deux combats : 2 minutes par défaut (DUR.1 A, réponse du client du 25/09/2026). */
export const DEFAULT_BUFFER_SECONDS = 120;

export type CapacityParams = {
  readonly tatamiCount: number;
  readonly usableSecondsPerTatami: number;
  readonly averageFightSeconds: number;
  readonly bufferSeconds?: number;
};

export function computeFightCapacity(params: CapacityParams): number {
  const tatamis = Math.floor(params.tatamiCount);
  const slotSeconds = params.averageFightSeconds + (params.bufferSeconds ?? DEFAULT_BUFFER_SECONDS);
  if (!Number.isFinite(tatamis) || tatamis < 1) return 0;
  if (!Number.isFinite(slotSeconds) || slotSeconds <= 0) return 0;
  if (!Number.isFinite(params.usableSecondsPerTatami) || params.usableSecondsPerTatami <= 0) {
    return 0;
  }
  return Math.floor(params.usableSecondsPerTatami / slotSeconds) * tatamis;
}

export function computeCompetitorCapacity(params: CapacityParams, shape: CategoryShape): number {
  const ratio = fightsPerCompetitor(shape);
  if (ratio <= 0) return 0;
  return Math.floor(computeFightCapacity(params) / ratio);
}

export function computeFillRate(
  activeCompetitors: number,
  competitorCapacity: number,
): number | null {
  if (!Number.isFinite(competitorCapacity) || competitorCapacity <= 0) return null;
  return activeCompetitors / competitorCapacity;
}

export type CapacityExplanation = {
  readonly tatamiCount: number;
  readonly usableSecondsPerTatami: number;
  readonly slotSeconds: number;
  readonly fightsPerTatami: number;
  readonly fightCapacity: number;
  readonly fightsPerCompetitor: number;
  readonly competitorCapacity: number;
  readonly requestedFormat: DrawFormat;
  readonly appliedFormat: DrawFormat;
  readonly fallback?: DrawFallback;
};

export function explainCapacity(params: CapacityParams, shape: CategoryShape): CapacityExplanation {
  const tatamiCount = Math.max(0, Math.floor(params.tatamiCount));
  const slotSeconds = params.averageFightSeconds + (params.bufferSeconds ?? DEFAULT_BUFFER_SECONDS);
  const fightCapacity = computeFightCapacity(params);
  const ratio = fightsPerCompetitor(shape);
  const n = Math.ceil(shape.competitorsPerCategory);
  const decision = resolveDrawFormat(
    shape.format,
    Number.isFinite(n) ? n : 0,
    shape.maxPoolSize ?? MAX_POOL_SIZE_DEFAULT,
  );

  return {
    tatamiCount,
    usableSecondsPerTatami: params.usableSecondsPerTatami,
    slotSeconds,
    fightsPerTatami: tatamiCount > 0 ? fightCapacity / tatamiCount : 0,
    fightCapacity,
    fightsPerCompetitor: ratio,
    competitorCapacity: computeCompetitorCapacity(params, shape),
    requestedFormat: shape.format,
    appliedFormat: decision.applied,
    ...(decision.fallback ? { fallback: decision.fallback } : {}),
  };
}

export type FillReport = CapacityExplanation & {
  readonly breakdown: FillBreakdown;
  readonly fillRate: number | null;
};

export function computeFillReport(input: {
  readonly statuses: readonly string[];
  readonly capacity: CapacityParams;
  readonly shape: CategoryShape;
}): FillReport {
  const explanation = explainCapacity(input.capacity, input.shape);
  const breakdown = breakdownRegistrations(input.statuses);
  return {
    ...explanation,
    breakdown,
    fillRate: computeFillRate(breakdown.active, explanation.competitorCapacity),
  };
}

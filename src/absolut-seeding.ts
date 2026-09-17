import {
  generateBracket,
  type BracketEntry,
  type BracketResult,
  type ThirdPlaceMode,
} from "./bracket-generator";
import { resolveWeightClass } from "./db-vocabulary";
import { WEIGHT_CLASSES } from "./referential";
import { applySeedingPlan, SeedingPlanError, type SeedingPlan } from "./seeding-plan";

export type AbsolutRegistration = {
  readonly registrationId: string;
  readonly clubId?: string | null;
  readonly sourceCategoryId?: string | null;
  readonly sourcePlace?: number | null;
  readonly sourceWeightClass?: string | null;
  readonly status?: "active" | "cancelled";
};

export function sourceWeightRank(stored: string | null | undefined): number | null {
  const resolved = resolveWeightClass(stored);
  if (resolved === null) return null;
  const rank = (WEIGHT_CLASSES as readonly string[]).indexOf(resolved);
  return rank < 0 ? null : rank;
}

export function absolutEntries(registrations: readonly AbsolutRegistration[]): BracketEntry[] {
  return registrations
    .filter((r) => (r.status ?? "active") !== "cancelled")
    .map((r) => ({
      registrationId: r.registrationId,
      clubId: r.clubId ?? null,
      sourceCategoryId: r.sourceCategoryId ?? null,
      sourcePlace: r.sourcePlace ?? null,
      sourceWeightRank: sourceWeightRank(r.sourceWeightClass),
    }));
}

export const ABSOLUT_SEEDING_PLAN: SeedingPlan = {
  order: [
    { kind: "interleave", enabled: false, key: "club" },
    { kind: "source-place", enabled: true },
  ],
  constraints: [
    {
      name: "meme-categorie-source-premier-tour",
      enabled: true,
      key: "source-category",
      scope: { kind: "round", round: 1 },
      tier: 0,
      weight: 1,
    },
    {
      name: "meme-club-premier-tour",
      enabled: true,
      key: "club",
      scope: { kind: "round", round: 1 },
      tier: 1,
      weight: 1,
    },
    {
      name: "meme-club-quart-de-tableau",
      enabled: true,
      key: "club",
      scope: { kind: "round", round: 2 },
      tier: 2,
      weight: 1,
    },
  ],
  pins: [{ kind: "empty-leaves" }],
};

const TIRAGE_INTERDIT = (): number => {
  throw new SeedingPlanError(
    "Absolut : une règle du plan a consommé le tirage. L'ordre d'un absolut est un " +
      "classement par place source, pas un tirage au sort - vérifiez ABSOLUT_SEEDING_PLAN.",
  );
};

export function absolutSeedOrder(
  registrations: readonly AbsolutRegistration[],
): AbsolutRegistration[] {
  const entries = absolutEntries(registrations);
  if (entries.length === 0) return [];
  const size = 2 ** Math.ceil(Math.log2(Math.max(2, entries.length)));
  const outcome = applySeedingPlan(entries, size, TIRAGE_INTERDIT, ABSOLUT_SEEDING_PLAN);
  const byId = new Map(registrations.map((r) => [r.registrationId, r]));
  const out: AbsolutRegistration[] = [];
  for (const entry of outcome.seedOrder) {
    const found = byId.get(entry.registrationId);
    if (found) out.push(found);
  }
  return out;
}

export function generateAbsolutBracket(
  registrations: readonly AbsolutRegistration[],
  seed: string,
  opts: { thirdPlaceMode: ThirdPlaceMode },
): BracketResult {
  return generateBracket(absolutEntries(registrations), seed, {
    thirdPlaceMode: opts.thirdPlaceMode,
    seedingPlan: ABSOLUT_SEEDING_PLAN,
  });
}

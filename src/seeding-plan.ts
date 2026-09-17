import type { BracketEntry } from "./bracket-generator";
import { shuffle } from "./prng";

export class SeedingPlanError extends Error {}

export type SeparationKey = "club" | "team" | "national-team" | "source-category";

export function separationKeyOf(entry: BracketEntry | null, key: SeparationKey): string | null {
  if (entry === null) return null;
  switch (key) {
    case "club":
      return entry.clubId ?? null;
    case "team":
      return entry.teamId ?? null;
    case "national-team":
      return entry.nationalTeam === true ? "national-team" : null;
    case "source-category":
      return entry.sourceCategoryId ?? null;
  }
}

export type SeparationScope = { kind: "round"; round: number } | { kind: "half" };

export type SeparationConstraint = {
  readonly name: string;
  readonly enabled: boolean;
  readonly key: SeparationKey;
  readonly scope: SeparationScope;
  readonly tier: number;
  readonly weight: number;
};

export type SeedOrderStep =
  | { readonly kind: "interleave"; readonly enabled: boolean; readonly key: SeparationKey }
  | { readonly kind: "source-place"; readonly enabled: boolean }
  | {
      readonly kind: "rank-bonus";
      readonly enabled: boolean;
      readonly key: SeparationKey;
      readonly bonus: number;
    }
  | {
      readonly kind: "protected-ranking";
      readonly enabled: boolean;
      readonly count: number;
      readonly whenExceedingByes: "degrade" | "reject";
    };

export type PinRule =
  | { readonly kind: "empty-leaves" }
  | { readonly kind: "bye-holders" }
  | { readonly kind: "leaves"; readonly leaves: readonly number[] };

export type SeedingPlan = {
  readonly order: readonly SeedOrderStep[];
  readonly constraints: readonly SeparationConstraint[];
  readonly pins: readonly PinRule[];
};

export type SeedingWarning =
  | {
      readonly code: "protected-ranking-missing-rank";
      readonly requested: number;
      readonly ranked: number;
    }
  | {
      readonly code: "protected-ranking-exceeds-byes";
      readonly protectedCount: number;
      readonly byeCount: number;
    };

export type SeedingOutcome = {
  readonly seedOrder: readonly BracketEntry[];
  readonly placement: readonly (BracketEntry | null)[];
  readonly leaves: readonly (BracketEntry | null)[];
  readonly warnings: readonly SeedingWarning[];
};

export const DEFAULT_SEEDING_PLAN: SeedingPlan = {
  order: [
    { kind: "interleave", enabled: true, key: "club" },
    { kind: "rank-bonus", enabled: false, key: "national-team", bonus: 4 },
    { kind: "protected-ranking", enabled: false, count: 0, whenExceedingByes: "degrade" },
    { kind: "source-place", enabled: false },
  ],
  constraints: [
    {
      name: "meme-club-premier-tour",
      enabled: true,
      key: "club",
      scope: { kind: "round", round: 1 },
      tier: 0,
      weight: 1,
    },
    {
      name: "meme-club-quart-de-tableau",
      enabled: true,
      key: "club",
      scope: { kind: "round", round: 2 },
      tier: 1,
      weight: 1,
    },
    {
      name: "meme-equipe-premier-tour",
      enabled: false,
      key: "team",
      scope: { kind: "round", round: 1 },
      tier: 0,
      weight: 1,
    },
    {
      name: "meme-equipe-meme-moitie",
      enabled: false,
      key: "team",
      scope: { kind: "half" },
      tier: 2,
      weight: 1,
    },
    {
      name: "equipe-de-France-meme-moitie",
      enabled: false,
      key: "national-team",
      scope: { kind: "half" },
      tier: 2,
      weight: 1,
    },
    {
      name: "meme-categorie-source-premier-tour",
      enabled: false,
      key: "source-category",
      scope: { kind: "round", round: 1 },
      tier: 0,
      weight: 1,
    },
  ],
  pins: [{ kind: "empty-leaves" }],
};

export function describeSeedingPlan(plan: SeedingPlan = DEFAULT_SEEDING_PLAN): string[] {
  const state = (on: boolean) => (on ? "actif" : "éteint");
  const scope = (s: SeparationScope) =>
    s.kind === "half" ? "moitié de tableau" : `bloc du tour ${s.round}`;
  return [
    ...plan.order.map((step) => {
      switch (step.kind) {
        case "interleave":
          return `1. ordre des graines / entrelacement par ${step.key} (${state(step.enabled)})`;
        case "source-place":
          return `1. ordre des graines / place source puis catégorie la plus lourde (${state(step.enabled)})`;
        case "rank-bonus":
          return `1. ordre des graines / bonus de rang ${step.bonus} pour ${step.key} (${state(step.enabled)})`;
        case "protected-ranking":
          return `1. ordre des graines / classement protégé sur ${step.count}, débordement : ${step.whenExceedingByes} (${state(step.enabled)})`;
      }
    }),
    "2. placement standard (graines aux positions canoniques)",
    ...plan.constraints.map(
      (c) =>
        `3. réparation / ${c.name} : ${c.key} par ${scope(c.scope)}, palier ${c.tier}, poids ${c.weight} (${state(c.enabled)})`,
    ),
    ...plan.pins.map((p) =>
      p.kind === "leaves"
        ? `3. réparation / figé : positions ${p.leaves.join(", ")}`
        : `3. réparation / figé : ${p.kind}`,
    ),
  ];
}

export function seedPositions(size: number): number[] {
  let arr = [1];
  while (arr.length < size) {
    const len = arr.length * 2;
    const next: number[] = [];
    for (const s of arr) {
      next.push(s, len + 1 - s);
    }
    arr = next;
  }
  return arr;
}

function interleaveByKey(
  entries: readonly BracketEntry[],
  key: SeparationKey,
  rng: () => number,
): BracketEntry[] {
  const groups = new Map<string, BracketEntry[]>();
  entries.forEach((entry, i) => {
    const k = separationKeyOf(entry, key) ?? `__solo_${i}`;
    const group = groups.get(k);
    if (group) group.push(entry);
    else groups.set(k, [entry]);
  });

  const shuffledGroups = shuffle(
    [...groups.values()].map((g) => shuffle(g, rng)),
    rng,
  ).sort((a, b) => b.length - a.length);

  const out: BracketEntry[] = [];
  let added = true;
  let round = 0;
  while (added) {
    added = false;
    for (const group of shuffledGroups) {
      const item = group[round];
      if (item !== undefined) {
        out.push(item);
        added = true;
      }
    }
    round++;
  }
  return out;
}

function applySourcePlaceOrder(order: readonly BracketEntry[]): BracketEntry[] {
  const cmp = (x: number, y: number) => (x < y ? -1 : x > y ? 1 : 0);
  return order
    .map((entry, index) => ({
      entry,
      index,
      place: entry.sourcePlace ?? Number.POSITIVE_INFINITY,
      weight: entry.sourceWeightRank ?? Number.NEGATIVE_INFINITY,
    }))
    .sort((a, b) => cmp(a.place, b.place) || cmp(b.weight, a.weight) || a.index - b.index)
    .map((x) => x.entry);
}

function applyRankBonus(
  order: readonly BracketEntry[],
  key: SeparationKey,
  bonus: number,
): BracketEntry[] {
  return order
    .map((entry, index) => ({
      entry,
      index,
      adjusted: index - (separationKeyOf(entry, key) !== null ? bonus : 0),
    }))
    .sort((a, b) => a.adjusted - b.adjusted || a.index - b.index)
    .map((x) => x.entry);
}

function applyProtectedRanking(
  order: readonly BracketEntry[],
  step: Extract<SeedOrderStep, { kind: "protected-ranking" }>,
  size: number,
  warnings: SeedingWarning[],
): BracketEntry[] {
  const ranked = order
    .map((entry, index) => ({ entry, index, rank: entry.rank ?? null }))
    .filter((x): x is { entry: BracketEntry; index: number; rank: number } => x.rank !== null)
    .sort((a, b) => a.rank - b.rank || a.index - b.index);

  const count = Math.min(step.count, ranked.length);
  if (count < step.count) {
    warnings.push({
      code: "protected-ranking-missing-rank",
      requested: step.count,
      ranked: ranked.length,
    });
  }

  const byeCount = size - order.length;
  if (count > byeCount) {
    if (step.whenExceedingByes === "reject") {
      throw new SeedingPlanError(
        `Classement protégé : ${count} protégés pour ${byeCount} bye(s) disponible(s). ` +
          `Un tableau de taille ${size} pour ${order.length} inscrits ne peut pas faire sauter ` +
          `un tour à tout le monde.`,
      );
    }
    warnings.push({ code: "protected-ranking-exceeds-byes", protectedCount: count, byeCount });
  }

  const chosen = ranked.slice(0, count);
  const chosenIndexes = new Set(chosen.map((x) => x.index));
  return [...chosen.map((x) => x.entry), ...order.filter((_, i) => !chosenIndexes.has(i))];
}

type Leaf = BracketEntry | null;

function blockSizeOf(scope: SeparationScope, size: number): number {
  const raw = scope.kind === "half" ? size / 2 : 2 ** scope.round;
  return Math.max(1, Math.floor(raw));
}

function penaltyOf(leaves: readonly Leaf[], constraint: SeparationConstraint): number {
  const size = leaves.length;
  const block = blockSizeOf(constraint.scope, size);
  let pairs = 0;
  for (let start = 0; start < size; start += block) {
    const counts = new Map<string, number>();
    const end = Math.min(size, start + block);
    for (let l = start; l < end; l++) {
      const k = separationKeyOf(leaves[l] ?? null, constraint.key);
      if (k !== null) counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    for (const n of counts.values()) pairs += (n * (n - 1)) / 2;
  }
  return pairs * constraint.weight;
}

function scoreOf(leaves: readonly Leaf[], constraints: readonly SeparationConstraint[]): number[] {
  const tiers = constraints.reduce((max, c) => Math.max(max, c.tier + 1), 0);
  const out = new Array<number>(tiers).fill(0);
  for (const c of constraints) out[c.tier] = (out[c.tier] ?? 0) + penaltyOf(leaves, c);
  return out;
}

function isBetter(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}

function isInertSwap(a: Leaf, b: Leaf, constraints: readonly SeparationConstraint[]): boolean {
  if ((a === null) !== (b === null)) return false;
  return constraints.every((c) => separationKeyOf(a, c.key) === separationKeyOf(b, c.key));
}

function pinnedLeaves(leaves: readonly Leaf[], pins: readonly PinRule[]): Set<number> {
  const out = new Set<number>();
  for (const pin of pins) {
    switch (pin.kind) {
      case "empty-leaves":
        leaves.forEach((leaf, i) => {
          if (leaf === null) out.add(i);
        });
        break;
      case "bye-holders":
        for (let f = 0; 2 * f + 1 < leaves.length; f++) {
          const a = leaves[2 * f] ?? null;
          const b = leaves[2 * f + 1] ?? null;
          if (a === null && b !== null) out.add(2 * f + 1);
          if (b === null && a !== null) out.add(2 * f);
        }
        break;
      case "leaves":
        for (const i of pin.leaves) out.add(i);
        break;
    }
  }
  return out;
}

function leavesAnEmptyFight(leaves: readonly Leaf[], ...touched: number[]): boolean {
  for (const l of touched) {
    const fight = Math.floor(l / 2);
    if ((leaves[2 * fight] ?? null) === null && (leaves[2 * fight + 1] ?? null) === null) {
      return true;
    }
  }
  return false;
}

function repair(placement: readonly Leaf[], plan: SeedingPlan): Leaf[] {
  const out = [...placement];
  const size = out.length;
  const constraints = plan.constraints.filter((c) => c.enabled);
  const pinned = pinnedLeaves(out, plan.pins);
  const movable: number[] = [];
  for (let i = 0; i < size; i++) if (!pinned.has(i)) movable.push(i);

  let score = scoreOf(out, constraints);
  let improved = true;
  let guard = size * 2;

  while (improved && score.some((v) => v > 0) && guard-- > 0) {
    improved = false;
    outer: for (const i of movable) {
      for (const j of movable) {
        if (j <= i) continue;
        const a = out[i] ?? null;
        const b = out[j] ?? null;
        if (isInertSwap(a, b, constraints)) continue;
        [out[i], out[j]] = [b, a];
        if (leavesAnEmptyFight(out, i, j)) {
          [out[i], out[j]] = [a, b];
          continue;
        }
        const next = scoreOf(out, constraints);
        if (isBetter(next, score)) {
          score = next;
          improved = true;
          break outer;
        }
        [out[i], out[j]] = [a, b];
      }
    }
  }
  return out;
}

export function applySeedingPlan(
  entries: readonly BracketEntry[],
  size: number,
  rng: () => number,
  plan: SeedingPlan = DEFAULT_SEEDING_PLAN,
): SeedingOutcome {
  const warnings: SeedingWarning[] = [];

  let order: readonly BracketEntry[] = entries;
  for (const step of plan.order) {
    if (!step.enabled) continue;
    switch (step.kind) {
      case "interleave":
        order = interleaveByKey(order, step.key, rng);
        break;
      case "source-place":
        order = applySourcePlaceOrder(order);
        break;
      case "rank-bonus":
        order = applyRankBonus(order, step.key, step.bonus);
        break;
      case "protected-ranking":
        order = applyProtectedRanking(order, step, size, warnings);
        break;
    }
  }

  const placement: Leaf[] = seedPositions(size).map((seedNumber) => order[seedNumber - 1] ?? null);

  const leaves = repair(placement, plan);

  return { seedOrder: order, placement, leaves, warnings };
}

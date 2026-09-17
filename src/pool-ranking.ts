import { fnv1a, mulberry32, shuffle } from "./prng";

export class PoolRankingError extends Error {}

export type PoolBout = {
  readonly a: string;
  readonly b: string;
  readonly winner: string | null;
  readonly pointsA: number;
  readonly pointsB: number;
  readonly submission: boolean;
  readonly penaltiesA: number;
  readonly penaltiesB: number;
};

export type TieBreaker =
  "head-to-head" | "point-differential" | "points-scored" | "submissions" | "penalties" | "draw";

export const DEFAULT_TIE_BREAK_ORDER: readonly TieBreaker[] = [
  "head-to-head",
  "point-differential",
  "points-scored",
  "submissions",
  "penalties",
  "draw",
];

export type PoolStanding = {
  readonly registrationId: string;
  readonly rank: number;
  readonly bouts: number;
  readonly wins: number;
  readonly losses: number;
  readonly noContest: number;
  readonly pointsFor: number;
  readonly pointsAgainst: number;
  readonly pointDifferential: number;
  readonly submissions: number;
  readonly penalties: number;
};

export type TieBreakRecord = {
  readonly criterion: TieBreaker;
  readonly registrationIds: readonly string[];
  readonly separated: boolean;
};

export type PoolPodium = {
  readonly gold: string;
  readonly silver: string | null;
  readonly bronze: string | null;
};

export type PoolRankingResult = {
  readonly complete: boolean;
  readonly standings: readonly PoolStanding[];
  readonly missingPairs: readonly (readonly [string, string])[];
  readonly podium: PoolPodium | null;
  readonly tieBreakApplied: readonly TieBreakRecord[];
};

export type PoolRankingOptions = {
  readonly seed: string;
  readonly categoryId: string;
  readonly order?: readonly TieBreaker[];
};

type Tally = {
  registrationId: string;
  bouts: number;
  wins: number;
  losses: number;
  noContest: number;
  pointsFor: number;
  pointsAgainst: number;
  submissions: number;
  penalties: number;
};

function pairKey(x: string, y: string): string {
  return x < y ? `${x} ${y}` : `${y} ${x}`;
}

function tallyOf(competitorIds: readonly string[], bouts: readonly PoolBout[]): Map<string, Tally> {
  const map = new Map<string, Tally>();
  for (const id of competitorIds) {
    map.set(id, {
      registrationId: id,
      bouts: 0,
      wins: 0,
      losses: 0,
      noContest: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      submissions: 0,
      penalties: 0,
    });
  }

  for (const bout of bouts) {
    const ta = map.get(bout.a);
    const tb = map.get(bout.b);
    if (!ta || !tb) continue;
    ta.bouts++;
    tb.bouts++;
    ta.pointsFor += bout.pointsA;
    ta.pointsAgainst += bout.pointsB;
    tb.pointsFor += bout.pointsB;
    tb.pointsAgainst += bout.pointsA;
    ta.penalties += bout.penaltiesA;
    tb.penalties += bout.penaltiesB;
    if (bout.winner === null) {
      ta.noContest++;
      tb.noContest++;
      continue;
    }
    const winner = bout.winner === bout.a ? ta : tb;
    const loser = bout.winner === bout.a ? tb : ta;
    winner.wins++;
    loser.losses++;
    if (bout.submission) winner.submissions++;
  }

  return map;
}

function validate(competitorIds: readonly string[], bouts: readonly PoolBout[]): void {
  const known = new Set(competitorIds);
  if (known.size !== competitorIds.length) {
    throw new PoolRankingError("Classement de poule : un compétiteur est listé deux fois.");
  }
  const seen = new Set<string>();
  for (const bout of bouts) {
    if (bout.a === bout.b) {
      throw new PoolRankingError(`Classement de poule : combat de ${bout.a} contre lui-même.`);
    }
    if (!known.has(bout.a) || !known.has(bout.b)) {
      throw new PoolRankingError(
        `Classement de poule : le combat ${bout.a} / ${bout.b} porte un compétiteur hors de la poule.`,
      );
    }
    if (bout.winner !== null && bout.winner !== bout.a && bout.winner !== bout.b) {
      throw new PoolRankingError(
        `Classement de poule : le vainqueur ${bout.winner} n'a pas disputé ${bout.a} / ${bout.b}.`,
      );
    }
    const key = pairKey(bout.a, bout.b);
    if (seen.has(key)) {
      throw new PoolRankingError(
        `Classement de poule : la paire ${bout.a} / ${bout.b} est enregistrée deux fois.`,
      );
    }
    seen.add(key);
  }
}

function missingPairsOf(
  competitorIds: readonly string[],
  bouts: readonly PoolBout[],
): (readonly [string, string])[] {
  const played = new Set(bouts.map((b) => pairKey(b.a, b.b)));
  const out: (readonly [string, string])[] = [];
  for (let i = 0; i < competitorIds.length; i++) {
    for (let j = i + 1; j < competitorIds.length; j++) {
      const x = competitorIds[i];
      const y = competitorIds[j];
      if (x === undefined || y === undefined) continue;
      if (!played.has(pairKey(x, y))) out.push([x, y]);
    }
  }
  return out;
}

type Context = {
  readonly order: readonly TieBreaker[];
  readonly tally: Map<string, Tally>;
  readonly bouts: readonly PoolBout[];
  readonly seed: string;
  readonly categoryId: string;
  readonly trace: TieBreakRecord[];
};

function headToHeadWins(group: readonly string[], bouts: readonly PoolBout[]): Map<string, number> {
  const inGroup = new Set(group);
  const wins = new Map<string, number>();
  for (const id of group) wins.set(id, 0);
  for (const bout of bouts) {
    if (!inGroup.has(bout.a) || !inGroup.has(bout.b)) continue;
    if (bout.winner === null) continue;
    wins.set(bout.winner, (wins.get(bout.winner) ?? 0) + 1);
  }
  return wins;
}

function blocksByNumber(
  group: readonly string[],
  keyOf: (id: string) => number,
  direction: 1 | -1,
): string[][] {
  const buckets = new Map<number, string[]>();
  for (const id of group) {
    const k = keyOf(id);
    const bucket = buckets.get(k);
    if (bucket) bucket.push(id);
    else buckets.set(k, [id]);
  }
  return [...buckets.entries()]
    .sort((x, y) => (y[0] - x[0]) * direction)
    .map(([, members]) => members);
}

function drawBlocks(group: readonly string[], ctx: Context): string[][] {
  const canonical = [...group].sort();
  const seedText = `${ctx.seed}|${ctx.categoryId}|${canonical.join(",")}`;
  const rng = mulberry32(fnv1a(seedText));
  return shuffle(canonical, rng).map((id) => [id]);
}

function blocksFor(group: readonly string[], criterion: TieBreaker, ctx: Context): string[][] {
  const stat = (id: string) => ctx.tally.get(id);
  switch (criterion) {
    case "head-to-head": {
      const wins = headToHeadWins(group, ctx.bouts);
      return blocksByNumber(group, (id) => wins.get(id) ?? 0, 1);
    }
    case "point-differential":
      return blocksByNumber(
        group,
        (id) => {
          const t = stat(id);
          return t ? t.pointsFor - t.pointsAgainst : 0;
        },
        1,
      );
    case "points-scored":
      return blocksByNumber(group, (id) => stat(id)?.pointsFor ?? 0, 1);
    case "submissions":
      return blocksByNumber(group, (id) => stat(id)?.submissions ?? 0, 1);
    case "penalties":
      return blocksByNumber(group, (id) => stat(id)?.penalties ?? 0, -1);
    case "draw":
      return drawBlocks(group, ctx);
  }
}

function orderGroup(group: readonly string[], from: number, ctx: Context): string[] {
  if (group.length <= 1) return [...group];
  for (let i = from; i < ctx.order.length; i++) {
    const criterion = ctx.order[i];
    if (!criterion) continue;
    const blocks = blocksFor(group, criterion, ctx);
    const separated = blocks.length > 1;
    ctx.trace.push({ criterion, registrationIds: [...group], separated });
    if (!separated) continue;
    return blocks.flatMap((block) => orderGroup(block, 0, ctx));
  }
  return [...group];
}

function effectiveOrder(order: readonly TieBreaker[] | undefined): readonly TieBreaker[] {
  const source = order ?? DEFAULT_TIE_BREAK_ORDER;
  const out: TieBreaker[] = [];
  for (const criterion of source) if (!out.includes(criterion)) out.push(criterion);
  if (!out.includes("draw")) out.push("draw");
  return out;
}

export function rankPool(
  competitorIds: readonly string[],
  bouts: readonly PoolBout[],
  opts: PoolRankingOptions,
): PoolRankingResult {
  validate(competitorIds, bouts);

  const tally = tallyOf(competitorIds, bouts);
  const missingPairs = missingPairsOf(competitorIds, bouts);
  const complete = missingPairs.length === 0;

  const ctx: Context = {
    order: effectiveOrder(opts.order),
    tally,
    bouts,
    seed: opts.seed,
    categoryId: opts.categoryId,
    trace: [],
  };

  const byWins = blocksByNumber(competitorIds, (id) => tally.get(id)?.wins ?? 0, 1);
  const ordered = byWins.flatMap((block) => orderGroup(block, 0, ctx));

  const standings: PoolStanding[] = ordered.map((id, index) => {
    const t = tally.get(id);
    return {
      registrationId: id,
      rank: index + 1,
      bouts: t?.bouts ?? 0,
      wins: t?.wins ?? 0,
      losses: t?.losses ?? 0,
      noContest: t?.noContest ?? 0,
      pointsFor: t?.pointsFor ?? 0,
      pointsAgainst: t?.pointsAgainst ?? 0,
      pointDifferential: (t?.pointsFor ?? 0) - (t?.pointsAgainst ?? 0),
      submissions: t?.submissions ?? 0,
      penalties: t?.penalties ?? 0,
    };
  });

  const podium: PoolPodium | null =
    complete && ordered.length > 0
      ? {
          gold: ordered[0] as string,
          silver: ordered[1] ?? null,
          bronze: ordered[2] ?? null,
        }
      : null;

  return { complete, standings, missingPairs, podium, tieBreakApplied: ctx.trace };
}

export function explainTieBreaks(records: readonly TieBreakRecord[]): string[] {
  const label: Record<TieBreaker, string> = {
    "head-to-head": "confrontation directe",
    "point-differential": "écart de points",
    "points-scored": "points marqués",
    submissions: "soumissions",
    penalties: "pénalités",
    draw: "tirage au sort",
  };
  return records.map(
    (r) =>
      `${r.registrationIds.join(", ")} : ${label[r.criterion]} ` +
      (r.separated ? "a séparé" : "n'a pas séparé"),
  );
}

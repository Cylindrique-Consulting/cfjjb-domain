import type { BracketEntry, GeneratedFight } from "./bracket-generator";
import { fnv1a, mulberry32, shuffle } from "./prng";

export class PoolTooLargeError extends Error {}

export const MAX_POOL_SIZE_DEFAULT = 6;

export function poolFightCount(n: number): number {
  return n < 2 ? 0 : (n * (n - 1)) / 2;
}

export function poolRoundCount(n: number): number {
  if (n < 2) return 0;
  return n % 2 === 0 ? n - 1 : n;
}

export const POOL_SIZES_WITHOUT_REST: readonly number[] = [3, 4];

export type PoolRound = {
  readonly round: number;
  readonly fightIndexes: readonly number[];
  readonly restingRegistrationId: string | null;
};

export type PoolWarning = {
  readonly code: "back-to-back-unavoidable";
  readonly competitorCount: number;
  readonly occurrences: number;
  readonly fightIndexes: readonly number[];
};

export type PoolResult =
  | { readonly kind: "empty" }
  | { readonly kind: "single"; readonly registrationId: string }
  | {
      readonly kind: "pool";
      readonly competitorIds: readonly string[];
      readonly fights: GeneratedFight[];
      readonly rounds: readonly PoolRound[];
      readonly realFightCount: number;
      readonly warnings?: PoolWarning[];
    };

type Pairing = readonly [number, number];

const PHANTOM = -1;

function circleRounds(n: number): Pairing[][] {
  const odd = n % 2 === 1;
  const m = odd ? n + 1 : n;
  let seats: number[] = [];
  for (let i = 0; i < n; i++) seats.push(i);
  if (odd) seats.push(PHANTOM);

  const rounds: Pairing[][] = [];
  for (let r = 0; r < m - 1; r++) {
    const pairs: Pairing[] = [];
    for (let i = 0; i < m / 2; i++) {
      const a = seats[i] ?? PHANTOM;
      const b = seats[m - 1 - i] ?? PHANTOM;
      if (a !== PHANTOM && b !== PHANTOM) pairs.push([a, b]);
    }
    rounds.push(pairs);
    const head = seats[0] ?? PHANTOM;
    const rest = seats.slice(1);
    const tail = rest.pop();
    if (tail !== undefined) rest.unshift(tail);
    seats = [head, ...rest];
  }
  return rounds;
}

function restingPerRound(n: number, rounds: readonly Pairing[][]): (number | null)[] {
  if (n % 2 === 0) return rounds.map(() => null);
  return rounds.map((pairs) => {
    const busy = new Set<number>();
    for (const [a, b] of pairs) {
      busy.add(a);
      busy.add(b);
    }
    for (let i = 0; i < n; i++) if (!busy.has(i)) return i;
    return null;
  });
}

function sharesCompetitor(x: Pairing, y: Pairing): boolean {
  return x[0] === y[0] || x[0] === y[1] || x[1] === y[0] || x[1] === y[1];
}

function adjustHinges(rounds: Pairing[][]): { rounds: Pairing[][]; unresolvedRounds: number[] } {
  const out = rounds.map((r) => [...r]);
  const unresolvedRounds: number[] = [];

  for (let r = 1; r < out.length; r++) {
    const previous = out[r - 1] ?? [];
    const current = out[r] ?? [];
    const last = previous[previous.length - 1];
    const first = current[0];
    if (!last || !first) continue;
    if (!sharesCompetitor(last, first)) continue;

    let swapWith = -1;
    for (let i = 1; i < current.length; i++) {
      const candidate = current[i];
      if (candidate && !sharesCompetitor(last, candidate)) {
        swapWith = i;
        break;
      }
    }
    if (swapWith < 0) {
      unresolvedRounds.push(r);
      continue;
    }
    const head = current[0] as Pairing;
    current[0] = current[swapWith] as Pairing;
    current[swapWith] = head;
  }

  return { rounds: out, unresolvedRounds };
}

export function generatePool(
  entries: readonly BracketEntry[],
  seed: string,
  opts: { maxSize?: number } = {},
): PoolResult {
  const n = entries.length;
  if (n === 0) return { kind: "empty" };
  const first = entries[0];
  if (n === 1 && first) return { kind: "single", registrationId: first.registrationId };

  const maxSize = opts.maxSize ?? MAX_POOL_SIZE_DEFAULT;
  if (n > maxSize) {
    throw new PoolTooLargeError(
      `Poule de ${n} inscrits pour un plafond de ${maxSize} : ${poolFightCount(n)} combats ` +
        `au lieu de ${n - 1} en élimination directe. Le repli est une décision de format ` +
        `(voir generateCategoryDraw), pas une décision du moteur.`,
    );
  }

  const rng = mulberry32(fnv1a(seed));
  const ordered = shuffle(entries, rng);
  const competitorIds = ordered.map((e) => e.registrationId);

  const raw = circleRounds(n);
  const resting = restingPerRound(n, raw);
  const adjusted = adjustHinges(raw);

  const fights: GeneratedFight[] = [];
  const rounds: PoolRound[] = [];
  adjusted.rounds.forEach((pairs, r) => {
    const fightIndexes: number[] = [];
    for (const [a, b] of pairs) {
      fightIndexes.push(fights.length);
      fights.push({
        division: 0,
        indexInDivision: fights.length,
        type: "BraketFight",
        slotA: competitorIds[a] ?? null,
        slotB: competitorIds[b] ?? null,
        isBye: false,
      });
    }
    const rest = resting[r] ?? null;
    rounds.push({
      round: r + 1,
      fightIndexes,
      restingRegistrationId: rest === null ? null : (competitorIds[rest] ?? null),
    });
  });

  const backToBack: number[] = [];
  for (let i = 1; i < fights.length; i++) {
    const previous = fights[i - 1];
    const current = fights[i];
    if (!previous || !current) continue;
    const shared =
      previous.slotA === current.slotA ||
      previous.slotA === current.slotB ||
      previous.slotB === current.slotA ||
      previous.slotB === current.slotB;
    if (shared) backToBack.push(current.indexInDivision);
  }

  const warnings: PoolWarning[] =
    backToBack.length > 0
      ? [
          {
            code: "back-to-back-unavoidable",
            competitorCount: n,
            occurrences: backToBack.length,
            fightIndexes: backToBack,
          },
        ]
      : [];

  return {
    kind: "pool",
    competitorIds,
    fights,
    rounds,
    realFightCount: fights.length,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

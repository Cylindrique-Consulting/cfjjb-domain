/**
 * Single-elimination bracket generator, structurally compatible with the
 * Jour J app.
 *
 * Jour J contract (src/lib/bracket-utils.ts findNextFight):
 * - fights of a (category, division) are sorted by INTEGER id ascending;
 *   the fight at index i sends its winner to floor(i/2) in division-1,
 *   slot 1 if i is even, slot 2 if i is odd;
 * - division 1 = final, 2 = semis, deepest division = first round;
 * - the third-place fight is type 'BraketFightPool3', division 2, with an
 *   id GREATER than both semis (sorted index 2 → never targeted).
 *
 * Consequences implemented here:
 * - the tree is COMPLETE: division d has exactly 2^(d-1) fights, byes are
 *   materialized as pre-resolved fights (winner known, status finished on
 *   push) and their winner is pre-placed in the next division;
 * - emission order (deepest division first, index ascending, Pool3 last)
 *   doubles as the jourj_fight_id allocation order.
 *
 * Pure module: no IO, deterministic for a given seed.
 */

import type { ThirdPlaceMode } from "./enums";

export type BracketEntry = {
  registrationId: string;
  clubId: string | null;
};

export type BracketFightType = "BraketFight" | "BraketFightPool3";

export type GeneratedFight = {
  division: number;
  indexInDivision: number;
  type: BracketFightType;
  slotA: string | null;
  slotB: string | null;
  isBye: boolean;
};

export type BracketResult =
  | { kind: "empty" }
  | { kind: "single"; registrationId: string }
  | { kind: "bracket"; fights: GeneratedFight[]; realFightCount: number };

// `ThirdPlaceMode` était déclaré ici ET dans types/supabase.ts de la
// plateforme : deux unions jumelles. Une seule source désormais.
export type { ThirdPlaceMode } from "./enums";

// ------------------------------------------------------------------
// Deterministic PRNG (fnv1a hash -> mulberry32)
// ------------------------------------------------------------------

function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

// ------------------------------------------------------------------
// Standard seed placement
// ------------------------------------------------------------------

/**
 * Leaf positions of a complete bracket of size S (power of two), so that
 * seed 1 meets seed S in round 1, the top two seeds are in opposite halves
 * and byes (seeds > N) pair with the best seeds in distinct pairs.
 * seedPositions(8) = [1, 8, 4, 5, 2, 7, 3, 6].
 */
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

// ------------------------------------------------------------------
// Anti-club seeding
// ------------------------------------------------------------------

/**
 * Order entries as pseudo-seeds 1..N so that competitors of the same club
 * are spread across the bracket: clubs shuffled then interleaved
 * round-robin, biggest clubs first.
 */
function antiClubSeedOrder(entries: BracketEntry[], rng: () => number): BracketEntry[] {
  const groups = new Map<string, BracketEntry[]>();
  entries.forEach((entry, i) => {
    // null club = singleton group (cannot conflict with anyone).
    const key = entry.clubId ?? `__solo_${i}`;
    const group = groups.get(key);
    if (group) group.push(entry);
    else groups.set(key, [entry]);
  });

  const shuffledGroups = shuffle(
    [...groups.values()].map((g) => shuffle(g, rng)),
    rng,
  ).sort((a, b) => b.length - a.length); // stable: keeps shuffled order among equal sizes

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

type Leaf = BracketEntry | null;

function clubOf(leaf: Leaf): string | null {
  return leaf?.clubId ?? null;
}

/** Count same-club pairings: round 1 conflicts and potential round 2 conflicts. */
function conflictScore(leaves: Leaf[]): [number, number] {
  let round1 = 0;
  let round2 = 0;
  for (let f = 0; f < leaves.length / 2; f++) {
    const a = clubOf(leaves[2 * f] ?? null);
    const b = clubOf(leaves[2 * f + 1] ?? null);
    if (a !== null && a === b) round1++;
  }
  // Round 2 pods: leaves 4p..4p+3 - count same-club pairs across the two fights.
  for (let p = 0; p < leaves.length / 4; p++) {
    const pod = [leaves[4 * p], leaves[4 * p + 1], leaves[4 * p + 2], leaves[4 * p + 3]];
    const clubs = pod.map((l) => clubOf(l ?? null)).filter((c): c is string => c !== null);
    const counts = new Map<string, number>();
    for (const c of clubs) counts.set(c, (counts.get(c) ?? 0) + 1);
    for (const n of counts.values()) round2 += (n * (n - 1)) / 2;
  }
  return [round1, round2];
}

function isBetter(a: [number, number], b: [number, number]): boolean {
  return a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
}

/**
 * Local swap pass: while a strictly improving swap of two leaves exists
 * (lexicographic on round-1 then round-2 conflicts), apply it.
 * Byes (null leaves) never move: swapping a competitor into a bye slot
 * would change who gets the bye, which is a seeding fairness decision -
 * we only permute competitors among occupied slots.
 */
function antiClubSwapPass(leaves: Leaf[]): Leaf[] {
  const out = [...leaves];
  const occupied = out.map((l, i) => (l !== null ? i : -1)).filter((i) => i >= 0);
  let score = conflictScore(out);
  let improved = true;
  let guard = out.length * 2;

  while (improved && score[0] + score[1] > 0 && guard-- > 0) {
    improved = false;
    outer: for (const i of occupied) {
      for (const j of occupied) {
        if (j <= i) continue;
        const a = out[i] ?? null;
        const b = out[j] ?? null;
        if (clubOf(a) === clubOf(b)) continue; // same club (or both solo): no effect
        [out[i], out[j]] = [b, a];
        const next = conflictScore(out);
        if (isBetter(next, score)) {
          score = next;
          improved = true;
          break outer;
        }
        [out[i], out[j]] = [a, b]; // revert
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------
// Generator
// ------------------------------------------------------------------

export function generateBracket(
  entries: BracketEntry[],
  seed: string,
  opts: { thirdPlaceMode: ThirdPlaceMode },
): BracketResult {
  const n = entries.length;
  if (n === 0) return { kind: "empty" };
  const first = entries[0];
  if (n === 1 && first) return { kind: "single", registrationId: first.registrationId };

  const rng = mulberry32(fnv1a(seed));
  const size = 2 ** Math.ceil(Math.log2(n));
  const deepest = Math.log2(size); // division of the first round

  // Pseudo-seeds then standard placement on the leaves.
  const seeded = antiClubSeedOrder(entries, rng);
  const positions = seedPositions(size);
  let leaves: Leaf[] = positions.map((seedNumber) => seeded[seedNumber - 1] ?? null);
  leaves = antiClubSwapPass(leaves);

  // Emit the complete tree, deepest division first (= id allocation order).
  const fights: GeneratedFight[] = [];
  const byDivision = new Map<number, GeneratedFight[]>();

  for (let division = deepest; division >= 1; division--) {
    const count = 2 ** (division - 1);
    const divisionFights: GeneratedFight[] = [];
    for (let index = 0; index < count; index++) {
      let slotA: string | null = null;
      let slotB: string | null = null;
      let isBye = false;
      if (division === deepest) {
        const a = leaves[2 * index] ?? null;
        const b = leaves[2 * index + 1] ?? null;
        slotA = a?.registrationId ?? null;
        slotB = b?.registrationId ?? null;
        isBye = (a === null) !== (b === null);
        // Both-null is impossible: byes = size - n < size/2 and standard
        // placement pairs each bye with a top seed.
      }
      const fight: GeneratedFight = {
        division,
        indexInDivision: index,
        type: "BraketFight",
        slotA,
        slotB,
        isBye,
      };
      divisionFights.push(fight);
      fights.push(fight);
    }
    byDivision.set(division, divisionFights);
  }

  // Pre-place bye winners into the next division (Jour J only propagates
  // through the UI when a fight is finished by an operator; bye fights are
  // pushed already finished, so the placement must be materialized here).
  if (deepest > 1) {
    const firstRound = byDivision.get(deepest) ?? [];
    const nextRound = byDivision.get(deepest - 1) ?? [];
    firstRound.forEach((fight, index) => {
      if (!fight.isBye) return;
      const winner = fight.slotA ?? fight.slotB;
      const target = nextRound[Math.floor(index / 2)];
      if (!target || !winner) return;
      if (index % 2 === 0) target.slotA = winner;
      else target.slotB = winner;
    });
  }

  // Third-place fight: only when two REAL semi-final losers will exist
  // (n >= 4). Jour J's podium falls back to "semi losers" otherwise.
  const realFights = fights.filter((f) => !f.isBye).length;
  let pool3 = false;
  if (opts.thirdPlaceMode === "pool3" && n >= 4) {
    fights.push({
      division: 2,
      indexInDivision: 2,
      type: "BraketFightPool3",
      slotA: null,
      slotB: null,
      isBye: false,
    });
    pool3 = true;
  }

  return {
    kind: "bracket",
    fights,
    realFightCount: realFights + (pool3 ? 1 : 0),
  };
}

// ------------------------------------------------------------------
// Manual editing - swap two first-round leaf slots
// ------------------------------------------------------------------

export class BracketEditError extends Error {}

/**
 * Read the first-round leaf occupants (registrationId | null) from a set of
 * generated fights. Leaf index l → first-round fight floor(l/2), slot A if l
 * even, slot B if odd. Length = bracket size S.
 */
export function readLeafOccupants(fights: GeneratedFight[]): (string | null)[] {
  const regular = fights.filter((f) => f.type === "BraketFight");
  const deepest = Math.max(0, ...regular.map((f) => f.division));
  const firstRound = regular
    .filter((f) => f.division === deepest)
    .sort((a, b) => a.indexInDivision - b.indexInDivision);
  const out: (string | null)[] = [];
  for (const f of firstRound) out.push(f.slotA, f.slotB);
  return out;
}

/**
 * Return a NEW set of fights with two first-round leaf slots swapped and the
 * bracket re-resolved (byes recomputed, bye winners re-placed into the next
 * division, Pool3 untouched). Pure - same fight identities (division, index,
 * type), only slot contents and isBye change.
 *
 * Throws BracketEditError if the swap would leave a first-round fight with
 * two byes (no competitor at all).
 */
export function swapBracketLeafSlots(
  fights: GeneratedFight[],
  leafA: number,
  leafB: number,
): GeneratedFight[] {
  const regular = fights.filter((f) => f.type === "BraketFight");
  const deepest = Math.max(0, ...regular.map((f) => f.division));
  const size = regular.filter((f) => f.division === deepest).length * 2;
  if (leafA < 0 || leafB < 0 || leafA >= size || leafB >= size) {
    throw new BracketEditError("Position de tableau invalide.");
  }

  const occ = readLeafOccupants(fights);
  const swap = leafA === leafB ? occ : occ.slice();
  if (leafA !== leafB) {
    const t = swap[leafA] ?? null;
    swap[leafA] = swap[leafB] ?? null;
    swap[leafB] = t;
  }

  for (let j = 0; j < size / 2; j++) {
    if ((swap[2 * j] ?? null) === null && (swap[2 * j + 1] ?? null) === null) {
      throw new BracketEditError(
        "Déplacement refusé : un combat du premier tour se retrouverait sans aucun compétiteur.",
      );
    }
  }

  // Clone every fight; reset higher BraketFight divisions to TBD.
  const out: GeneratedFight[] = fights.map((f) => ({ ...f }));
  const byDiv = new Map<number, GeneratedFight[]>();
  for (const f of out) {
    if (f.type !== "BraketFight") continue;
    const list = byDiv.get(f.division) ?? [];
    list.push(f);
    byDiv.set(f.division, list);
  }
  for (const [division, list] of byDiv) {
    list.sort((a, b) => a.indexInDivision - b.indexInDivision);
    if (division === deepest) continue;
    for (const f of list) {
      f.slotA = null;
      f.slotB = null;
      f.isBye = false;
    }
  }

  const firstRound = byDiv.get(deepest) ?? [];
  const nextRound = byDiv.get(deepest - 1) ?? [];
  firstRound.forEach((f, idx) => {
    const a = swap[2 * idx] ?? null;
    const b = swap[2 * idx + 1] ?? null;
    f.slotA = a;
    f.slotB = b;
    f.isBye = (a === null) !== (b === null);
    if (f.isBye && deepest > 1) {
      const winner = a ?? b;
      const target = nextRound[Math.floor(idx / 2)];
      if (target && winner) {
        if (idx % 2 === 0) target.slotA = winner;
        else target.slotB = winner;
      }
    }
  });

  return out;
}

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
 *
 * OÙ VIT LE PLACEMENT. Plus ici. Qui affronte qui au premier tour est décidé
 * par le pipeline de `seeding-plan.ts` (ordre des graines, placement standard,
 * réparation sous contraintes pondérées) ; ce module ne fait plus que poser
 * l'arbre autour des feuilles qu'on lui rend. Les règles de tirage de la
 * fédération sont donc des DONNÉES, et non plus du code enfoui au milieu de
 * l'émission des combats.
 */

import type { ThirdPlaceMode } from "./enums";
import { fnv1a, mulberry32 } from "./prng";
import {
  applySeedingPlan,
  DEFAULT_SEEDING_PLAN,
  type SeedingPlan,
  type SeedingWarning,
} from "./seeding-plan";

/**
 * Un inscrit, tel que l'APPELANT le décrit. Les trois derniers champs sont les
 * entrées des règles de placement du pipeline (`seeding-plan.ts`) ; ce paquet
 * ne les lit nulle part, il les reçoit. Ils sont optionnels : un appelant qui
 * ne les remplit pas obtient exactement le tableau d'avant le pipeline.
 */
export type BracketEntry = {
  registrationId: string;
  clubId: string | null;
  /** Clé d'ÉQUIPE, au-delà du club (un club peut en aligner plusieurs). */
  teamId?: string | null;
  /** Rang de classement, 1 = le meilleur. Entrée du « classement protégé ». */
  rank?: number | null;
  /** Sélection en équipe de France. */
  nationalTeam?: boolean;
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
  | {
      kind: "bracket";
      fights: GeneratedFight[];
      realFightCount: number;
      /**
       * Ce que le plan de placement n'a pas pu tenir. ABSENT quand il n'y a
       * rien à dire - le plan par défaut n'en produit jamais, et le résultat
       * reste donc identique au bit à celui d'avant le pipeline. Une règle
       * qu'on allume et qui déborde le dit ici plutôt que de dégrader en
       * silence.
       */
      warnings?: SeedingWarning[];
    };

// `ThirdPlaceMode` était déclaré ici ET dans types/supabase.ts de la
// plateforme : deux unions jumelles. Une seule source désormais.
export type { ThirdPlaceMode } from "./enums";

// Le placement vit dans `seeding-plan.ts` : trois étapes nommées plutôt qu'une
// fonction anti-club et une passe de swap enfouies ici. Réexporté pour que les
// consommateurs qui importaient `seedPositions` d'ici ne bougent pas.
export { seedPositions } from "./seeding-plan";

// ------------------------------------------------------------------
// Generator
// ------------------------------------------------------------------

export function generateBracket(
  entries: BracketEntry[],
  seed: string,
  opts: { thirdPlaceMode: ThirdPlaceMode; seedingPlan?: SeedingPlan },
): BracketResult {
  const n = entries.length;
  if (n === 0) return { kind: "empty" };
  const first = entries[0];
  if (n === 1 && first) return { kind: "single", registrationId: first.registrationId };

  const rng = mulberry32(fnv1a(seed));
  const size = 2 ** Math.ceil(Math.log2(n));
  const deepest = Math.log2(size); // division of the first round

  // Le PIPELINE de placement : ordre des graines, placement standard,
  // réparation. Le plan par défaut rend exactement les mêmes feuilles que
  // l'anti-club monolithique d'avant, pour la même graine.
  const seeding = applySeedingPlan(entries, size, rng, opts.seedingPlan ?? DEFAULT_SEEDING_PLAN);
  const leaves = seeding.leaves;

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
    // Clé ABSENTE quand il n'y a rien à dire : le plan par défaut doit rendre
    // un objet identique à celui d'avant le pipeline.
    ...(seeding.warnings.length > 0 ? { warnings: [...seeding.warnings] } : {}),
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

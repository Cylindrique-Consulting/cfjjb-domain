import type { DrawFormat } from "./competition-format";
import type { ThirdPlaceMode } from "./enums";
import { fnv1a, mulberry32 } from "./prng";
import {
  applySeedingPlan,
  DEFAULT_SEEDING_PLAN,
  type SeedingPlan,
  type SeedingWarning,
} from "./seeding-plan";

export type BracketEntry = {
  registrationId: string;
  clubId: string | null;
  teamId?: string | null;
  rank?: number | null;
  nationalTeam?: boolean;
  sourcePlace?: number | null;
  sourceWeightRank?: number | null;
  sourceCategoryId?: string | null;
};

export type BracketFightType = "BraketFight" | "BraketFightPool3" | "BraketFightRepechage3";

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
      warnings?: SeedingWarning[];
    };

export type { ThirdPlaceMode } from "./enums";

export { seedPositions } from "./seeding-plan";

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
  const deepest = Math.log2(size);

  const seeding = applySeedingPlan(entries, size, rng, opts.seedingPlan ?? DEFAULT_SEEDING_PLAN);
  const leaves = seeding.leaves;

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

  const repechage3 = n === 3 ? (byDivision.get(2) ?? []).find((f) => f.isBye) : undefined;
  if (repechage3) {
    repechage3.type = "BraketFightRepechage3";
    repechage3.isBye = false;
    repechage3.slotB = repechage3.slotA ?? repechage3.slotB;
    repechage3.slotA = null;
  }

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
    ...(seeding.warnings.length > 0 ? { warnings: [...seeding.warnings] } : {}),
  };
}

export class BracketEditError extends Error {}

function occupeUneCase(f: GeneratedFight): boolean {
  return f.type !== "BraketFightPool3";
}

function feuillesReservees(premierTour: readonly GeneratedFight[]): Set<number> {
  const reservees = new Set<number>();
  premierTour.forEach((f, idx) => {
    if (f.type === "BraketFightRepechage3") reservees.add(2 * idx);
  });
  return reservees;
}

function refuseIfPool(fights: readonly GeneratedFight[], format?: DrawFormat): void {
  if (format === "pools" || fights.some((f) => f.division === 0)) {
    throw new BracketEditError(
      "Format poule : il n'y a pas de tableau à permuter. Une poule se joue en entier, " +
        "et l'ordre de passage se règle sur le planning, pas en déplaçant une tête de série.",
    );
  }
}

export function readLeafOccupants(fights: GeneratedFight[]): (string | null)[] {
  refuseIfPool(fights);
  const regular = fights.filter(occupeUneCase);
  const deepest = Math.max(0, ...regular.map((f) => f.division));
  const firstRound = regular
    .filter((f) => f.division === deepest)
    .sort((a, b) => a.indexInDivision - b.indexInDivision);
  const out: (string | null)[] = [];
  for (const f of firstRound) out.push(f.slotA, f.slotB);
  return out;
}

export function swapBracketLeafSlots(
  fights: GeneratedFight[],
  leafA: number,
  leafB: number,
  opts: { format?: DrawFormat } = {},
): GeneratedFight[] {
  refuseIfPool(fights, opts.format);
  const regular = fights.filter(occupeUneCase);
  const deepest = Math.max(0, ...regular.map((f) => f.division));
  const premierTour = regular
    .filter((f) => f.division === deepest)
    .sort((a, b) => a.indexInDivision - b.indexInDivision);
  const size = premierTour.length * 2;
  if (leafA < 0 || leafB < 0 || leafA >= size || leafB >= size) {
    throw new BracketEditError("Position de tableau invalide.");
  }
  const reservees = feuillesReservees(premierTour);
  if (reservees.has(leafA) || reservees.has(leafB)) {
    throw new BracketEditError(
      "Cette place attend le perdant de la demi-finale : on n'y met personne à la main. " +
        "Pour changer qui attend au repêchage, échangez les compétiteurs entre eux.",
    );
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

  const out: GeneratedFight[] = fights.map((f) => ({ ...f }));
  const byDiv = new Map<number, GeneratedFight[]>();
  for (const f of out) {
    if (!occupeUneCase(f)) continue;
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
    if (f.type === "BraketFightRepechage3") {
      f.isBye = false;
      return;
    }
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

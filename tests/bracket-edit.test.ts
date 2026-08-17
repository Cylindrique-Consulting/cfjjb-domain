import { describe, expect, it } from "vitest";
import {
  BracketEditError,
  generateBracket,
  readLeafOccupants,
  swapBracketLeafSlots,
  type BracketEntry,
  type GeneratedFight,
} from "../src/bracket-generator";

// ===================================================================
// Jour J runtime replica (same as bracket-generator.test.ts) - proves a
// manually edited bracket still propagates to a complete podium.
// ===================================================================

type SimFight = {
  id: number;
  category_id: number;
  division: number;
  type: "BraketFight" | "BraketFightPool3";
  competitor_1_id: string | null;
  competitor_2_id: string | null;
  winner_id: string | null;
  status: "scheduled" | "finished";
};

function findNextFight(
  fights: SimFight[],
  current: SimFight,
): { fight: SimFight; slot: 1 | 2 } | null {
  if (current.division <= 1) return null;
  const same = fights
    .filter((f) => f.category_id === current.category_id && f.division === current.division)
    .sort((a, b) => a.id - b.id);
  const idx = same.findIndex((f) => f.id === current.id);
  if (idx === -1) return null;
  const next = fights
    .filter((f) => f.category_id === current.category_id && f.division === current.division - 1)
    .sort((a, b) => a.id - b.id)[Math.floor(idx / 2)];
  return next ? { fight: next, slot: idx % 2 === 0 ? 1 : 2 } : null;
}

/** ids allocated in emission order, exactly like generate.ts. */
function toSim(fights: GeneratedFight[]): SimFight[] {
  return fights.map((f, i) => ({
    id: 1_000_000 + i,
    category_id: 1,
    division: f.division,
    type: f.type,
    competitor_1_id: f.slotA,
    competitor_2_id: f.slotB,
    winner_id: f.isBye ? (f.slotA ?? f.slotB) : null,
    status: f.isBye ? "finished" : "scheduled",
  }));
}

function simulateDay(fights: SimFight[]): void {
  const pool3 = fights.find((f) => f.type === "BraketFightPool3") ?? null;
  for (let guard = 0; guard < 200; guard++) {
    const ready = fights
      .filter((f) => f.status === "scheduled" && f.competitor_1_id && f.competitor_2_id)
      .sort((a, b) => a.id - b.id);
    if (ready.length === 0) break;
    const fight = ready[0]!;
    fight.winner_id = fight.competitor_1_id;
    fight.status = "finished";
    const next = findNextFight(fights, fight);
    if (next) {
      if (next.slot === 1) next.fight.competitor_1_id = fight.winner_id;
      else next.fight.competitor_2_id = fight.winner_id;
    }
    if (pool3 && fight.division === 2 && fight.type === "BraketFight") {
      const loser =
        fight.competitor_1_id === fight.winner_id ? fight.competitor_2_id : fight.competitor_1_id;
      const semis = fights
        .filter((f) => f.division === 2 && f.type === "BraketFight")
        .sort((a, b) => a.id - b.id);
      const i = semis.findIndex((f) => f.id === fight.id);
      if (loser && i === 0) pool3.competitor_1_id = loser;
      else if (loser && i === 1) pool3.competitor_2_id = loser;
    }
  }
}

function entries(n: number): BracketEntry[] {
  return Array.from({ length: n }, (_, i) => ({ registrationId: `r${i + 1}`, clubId: null }));
}

function gen(n: number, seed = "edit"): GeneratedFight[] {
  const r = generateBracket(entries(n), seed, { thirdPlaceMode: "pool3" });
  if (r.kind !== "bracket") throw new Error("expected bracket");
  return r.fights;
}

function multiset(fights: GeneratedFight[]): string[] {
  return readLeafOccupants(fights)
    .map((x) => x ?? "·")
    .sort();
}

describe("swapBracketLeafSlots - invariants", () => {
  it("swapping two competitors actually swaps their leaf positions", () => {
    const fights = gen(8);
    const before = readLeafOccupants(fights);
    const out = swapBracketLeafSlots(fights, 0, 3);
    const after = readLeafOccupants(out);
    expect(after[0]).toBe(before[3]);
    expect(after[3]).toBe(before[0]);
    // The original is untouched (pure).
    expect(readLeafOccupants(fights)).toEqual(before);
  });

  it("preserves the competitor multiset for every N and swap", () => {
    for (let n = 2; n <= 17; n++) {
      const fights = gen(n);
      const size = readLeafOccupants(fights).length;
      for (let a = 0; a < size; a++) {
        for (let b = a + 1; b < size; b++) {
          let out: GeneratedFight[];
          try {
            out = swapBracketLeafSlots(fights, a, b);
          } catch (e) {
            expect(e).toBeInstanceOf(BracketEditError); // only double-bye rejections
            continue;
          }
          expect(multiset(out)).toEqual(multiset(fights));
        }
      }
    }
  });

  it("rejects a swap that creates a fight with two byes", () => {
    // N=5, S=8 → 3 byes. Find two bye leaves in different fights and merge them.
    const fights = gen(5);
    const occ = readLeafOccupants(fights);
    const byeLeaves = occ.map((o, i) => (o === null ? i : -1)).filter((i) => i >= 0);
    // A real competitor adjacent to a bye, swapped to co-locate two byes.
    // Construct: pick a bye leaf b1 in fight j1 and the partner (real) of
    // another bye leaf so the swap empties a fight.
    expect(byeLeaves.length).toBe(3);
    // Brute force: there must exist at least one rejected swap.
    let rejected = 0;
    const size = occ.length;
    for (let a = 0; a < size; a++) {
      for (let b = a + 1; b < size; b++) {
        try {
          swapBracketLeafSlots(fights, a, b);
        } catch (e) {
          if (e instanceof BracketEditError) rejected++;
        }
      }
    }
    expect(rejected).toBeGreaterThan(0);
  });

  it("keeps fight identities (division, index, type) stable", () => {
    const fights = gen(6);
    const out = swapBracketLeafSlots(fights, 0, 2);
    const key = (f: GeneratedFight) => `${f.division}:${f.indexInDivision}:${f.type}`;
    expect(out.map(key).sort()).toEqual(fights.map(key).sort());
  });
});

describe("swapBracketLeafSlots - Jour J propagation after edit", () => {
  for (let n = 2; n <= 17; n++) {
    it(`N=${n}: every valid swap still resolves to a complete podium`, () => {
      const base = gen(n);
      const size = readLeafOccupants(base).length;
      for (let a = 0; a < size; a++) {
        for (let b = a + 1; b < size; b++) {
          let out: GeneratedFight[];
          try {
            out = swapBracketLeafSlots(base, a, b);
          } catch {
            continue; // rejected double-bye
          }
          const sim = toSim(out);
          simulateDay(sim);
          // No fight stuck.
          expect(sim.filter((f) => f.status !== "finished")).toHaveLength(0);
          // Final produces a single winner.
          const final = sim.find((f) => f.division === 1 && f.type === "BraketFight");
          expect(final?.winner_id).toBeTruthy();
          // Pool3 (if any) fully resolved.
          const pool3 = sim.find((f) => f.type === "BraketFightPool3");
          if (pool3) {
            expect(pool3.competitor_1_id && pool3.competitor_2_id && pool3.winner_id).toBeTruthy();
          }
        }
      }
    });
  }
});

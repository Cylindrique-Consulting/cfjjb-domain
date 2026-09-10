import { describe, expect, it } from "vitest";
import {
  generateBracket,
  seedPositions,
  type BracketEntry,
  type GeneratedFight,
} from "../src/bracket-generator";
import {
  findNextSlot,
  findRepechage3Slot,
  fromGenerated,
  repechage3Of,
} from "../src/bracket-propagation";

// ===================================================================
// Faithful replica of Jour J's runtime model
// (CFJJB - Jour J repo: src/lib/bracket-utils.ts findNextFight and
// src/app/admin/resultats/resultats-client.tsx podium computation).
// The generated brackets MUST behave correctly under this exact logic.
// ===================================================================

type SimFight = {
  id: number;
  category_id: number;
  division: number;
  type: "BraketFight" | "BraketFightPool3" | "BraketFightRepechage3";
  competitor_1_id: string | null;
  competitor_2_id: string | null;
  winner_id: string | null;
  status: "scheduled" | "finished";
};

function findNextFight(
  fights: SimFight[],
  currentFight: SimFight,
): { fight: SimFight; slot: 1 | 2 } | null {
  if (currentFight.division <= 1) return null;
  const nextDivision = currentFight.division - 1;
  const sameDivisionFights = fights
    .filter(
      (f) => f.category_id === currentFight.category_id && f.division === currentFight.division,
    )
    .sort((a, b) => a.id - b.id);
  const currentIndex = sameDivisionFights.findIndex((f) => f.id === currentFight.id);
  if (currentIndex === -1) return null;
  const nextIndex = Math.floor(currentIndex / 2);
  const slot: 1 | 2 = currentIndex % 2 === 0 ? 1 : 2;
  const nextDivisionFights = fights
    .filter((f) => f.category_id === currentFight.category_id && f.division === nextDivision)
    .sort((a, b) => a.id - b.id);
  const nextFight = nextDivisionFights[nextIndex];
  if (!nextFight) return null;
  return { fight: nextFight, slot };
}

/** Jour J podium computation (resultats-client.tsx lines ~133-158). */
function computePodium(fights: SimFight[]): Map<number, string[]> {
  const podium = new Map<number, string[]>();
  const final = fights.find((f) => f.division === 1 && f.type !== "BraketFightPool3");
  if (final?.status === "finished" && final.winner_id) {
    podium.set(1, [final.winner_id]);
    const loserId =
      final.competitor_1_id === final.winner_id ? final.competitor_2_id : final.competitor_1_id;
    if (loserId) podium.set(2, [loserId]);
  }
  // À TROIS, LE BRONZE EST LE PERDANT DU REPÊCHAGE. Surtout pas « le perdant de
  // la demie » : celui-là peut très bien être en finale, justement PARCE QU'il
  // a gagné son repêchage. Le décerner ici mettrait un finaliste sur la
  // troisième marche.
  const repechage = fights.find((f) => f.type === "BraketFightRepechage3");
  if (repechage?.status === "finished" && repechage.winner_id) {
    const loserId =
      repechage.competitor_1_id === repechage.winner_id
        ? repechage.competitor_2_id
        : repechage.competitor_1_id;
    if (loserId) podium.set(3, [loserId]);
    return podium;
  }

  const thirdPlaceFight = fights.find((f) => f.type === "BraketFightPool3");
  if (thirdPlaceFight?.status === "finished" && thirdPlaceFight.winner_id) {
    podium.set(3, [thirdPlaceFight.winner_id]);
  } else if (!thirdPlaceFight) {
    const bronzes: string[] = [];
    fights
      .filter(
        (f) =>
          f.division === 2 && f.status === "finished" && f.winner_id && f.type === "BraketFight",
      )
      .forEach((sf) => {
        const loserId =
          sf.competitor_1_id === sf.winner_id ? sf.competitor_2_id : sf.competitor_1_id;
        if (loserId) bronzes.push(loserId);
      });
    if (bronzes.length > 0) podium.set(3, bronzes);
  }
  return podium;
}

/**
 * Build the Jour J runtime view of a generated bracket: ids allocated in
 * emission order (this is exactly how generate.ts allocates jourj ids),
 * byes pre-finished with their winner.
 */
function toSimFights(fights: GeneratedFight[], baseId = 1_000_000): SimFight[] {
  return fights.map((f, i) => {
    const winner = f.isBye ? (f.slotA ?? f.slotB) : null;
    return {
      id: baseId + i,
      category_id: 1,
      division: f.division,
      type: f.type,
      competitor_1_id: f.slotA,
      competitor_2_id: f.slotB,
      winner_id: winner,
      status: f.isBye ? "finished" : "scheduled",
    };
  });
}

/**
 * Run the full day: repeatedly finish a random ready fight (both slots set)
 * with a random winner, propagating winners exactly like Jour J, plus the
 * Phase-6 companion patch behaviour (semi loser feeds the Pool3).
 */
function simulateDay(fights: SimFight[], rngSeed: number): void {
  let state = rngSeed;
  const rand = () => {
    state = (state * 1103515245 + 12345) % 2 ** 31;
    return state / 2 ** 31;
  };

  const pool3 = fights.find((f) => f.type === "BraketFightPool3") ?? null;
  const repechage = fights.find((f) => f.type === "BraketFightRepechage3") ?? null;

  for (let guard = 0; guard < 1000; guard++) {
    const ready = fights.filter(
      (f) => f.status === "scheduled" && f.competitor_1_id && f.competitor_2_id,
    );
    if (ready.length === 0) break;
    const fight = ready[Math.floor(rand() * ready.length)];
    if (!fight) break;

    fight.winner_id = rand() < 0.5 ? fight.competitor_1_id : fight.competitor_2_id;
    fight.status = "finished";

    // Jour J winner propagation.
    const next = findNextFight(fights, fight);
    if (next && fight.winner_id) {
      if (next.slot === 1) next.fight.competitor_1_id = fight.winner_id;
      else next.fight.competitor_2_id = fight.winner_id;
    }

    // À TROIS : le perdant de la demie descend au REPÊCHAGE, où l'attend le
    // troisième. C'est le pendant exact de la règle du Pool3 ci-dessous — un
    // « perdant de », et le second du système.
    if (repechage && fight.division === 2 && fight.type === "BraketFight") {
      const loser =
        fight.competitor_1_id === fight.winner_id ? fight.competitor_2_id : fight.competitor_1_id;
      // Toujours l'emplacement 1 : le générateur pose celui qui attend en 2.
      if (loser) repechage.competitor_1_id = loser;
    }

    // Companion patch: semi-final loser feeds the Pool3.
    if (pool3 && fight.division === 2 && fight.type === "BraketFight") {
      const loser =
        fight.competitor_1_id === fight.winner_id ? fight.competitor_2_id : fight.competitor_1_id;
      if (loser) {
        const semis = fights
          .filter((f) => f.division === 2 && f.type === "BraketFight")
          .sort((a, b) => a.id - b.id);
        const semiIndex = semis.findIndex((f) => f.id === fight.id);
        if (semiIndex === 0) pool3.competitor_1_id = loser;
        else if (semiIndex === 1) pool3.competitor_2_id = loser;
      }
    }
  }
}

function makeEntries(n: number, clubPattern?: (i: number) => string | null): BracketEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    registrationId: `reg-${i + 1}`,
    clubId: clubPattern ? clubPattern(i) : null,
  }));
}

// ===================================================================
// Tests
// ===================================================================

describe("seedPositions", () => {
  it("produces the standard bracket placement", () => {
    expect(seedPositions(2)).toEqual([1, 2]);
    expect(seedPositions(4)).toEqual([1, 4, 2, 3]);
    expect(seedPositions(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
  });
});

describe("generateBracket - edge cases", () => {
  it("N=0 → empty", () => {
    expect(generateBracket([], "s", { thirdPlaceMode: "pool3" })).toEqual({ kind: "empty" });
  });

  it("N=1 → single (automatic gold, no fights)", () => {
    const result = generateBracket(makeEntries(1), "s", { thirdPlaceMode: "pool3" });
    expect(result).toEqual({ kind: "single", registrationId: "reg-1" });
  });

  it("N=2 → a single final, no Pool3", () => {
    const result = generateBracket(makeEntries(2), "s", { thirdPlaceMode: "pool3" });
    if (result.kind !== "bracket") throw new Error("expected bracket");
    expect(result.fights).toHaveLength(1);
    expect(result.fights[0]).toMatchObject({ division: 1, type: "BraketFight", isBye: false });
    expect(result.realFightCount).toBe(1);
  });

  it("N=3 → demie + REPÊCHAGE + finale, personne ne monte gratuitement", () => {
    /**
     * ┌─ CE QUE CE CAS PROUVE, ET CE QU'IL REMPLACE ────────────────────────────┐
     * │ Il éprouvait l'inverse : « une demie réelle, un BYE, une finale », donc  │
     * │ deux combats et un combattant porté en finale sans combattre. Décision   │
     * │ produit du 10/09/2026 : ce passage gratuit disparaît. Le bye devient un  │
     * │ repêchage où le troisième attend le PERDANT de la demie, et le vainqueur │
     * │ de ce combat-là monte en finale.                                          │
     * │                                                                          │
     * │ LE REPÊCHAGE RESTE À LA PLACE DU BYE, et c'est la propriété qui compte : │
     * │ `findNextSlot` route alors son vainqueur vers la finale par la même      │
     * │ arithmétique que tous les autres combats, sans règle de plus.            │
     * └──────────────────────────────────────────────────────────────────────────┘
     */
    const result = generateBracket(makeEntries(3), "s", { thirdPlaceMode: "pool3" });
    if (result.kind !== "bracket") throw new Error("expected bracket");

    expect(result.fights).toHaveLength(3); // demie + repêchage + finale
    expect(
      result.fights.filter((f) => f.isBye),
      "plus personne ne passe gratuitement",
    ).toHaveLength(0);
    expect(result.realFightCount, "trois combats se jouent, contre deux avant").toBe(3);
    expect(result.fights.some((f) => f.type === "BraketFightPool3")).toBe(false);

    const rep = result.fights.find((f) => f.type === "BraketFightRepechage3");
    const demie = result.fights.find((f) => f.type === "BraketFight" && f.division === 2);
    const finale = result.fights.find((f) => f.division === 1);
    if (!rep || !demie || !finale) throw new Error("structure attendue");

    // Le repêchage occupe la case du bye : même division, l'autre index.
    expect(rep.division).toBe(2);
    expect(rep.indexInDivision).not.toBe(demie.indexInDivision);

    // Il attend le perdant en A, et le troisième y est DÉJÀ posé en B.
    expect(rep.slotA, "l'emplacement du perdant est libre à la génération").toBeNull();
    expect(rep.slotB).not.toBeNull();

    // LA FINALE EST VIDE : elle n'a plus d'occupant pré-placé, puisqu'il n'y a
    // plus de bye. C'est exactement ce que le lot enlève.
    expect([finale.slotA, finale.slotB]).toEqual([null, null]);

    // Les trois inscrits sont présents une fois, demie et repêchage confondus.
    const places = [demie.slotA, demie.slotB, rep.slotB].filter((x): x is string => x !== null);
    expect(places.sort()).toEqual(
      makeEntries(3)
        .map((e) => e.registrationId)
        .sort(),
    );
  });

  it("N=3 : le vainqueur du repêchage monte en finale, et son perdant est bronze", () => {
    // ÉPROUVÉ CONTRE LA VRAIE PROPAGATION, pas contre la réplique de l'ancienne
    // application : c'est `bracket-propagation` que le module exécute.
    const result = generateBracket(makeEntries(3), "s", { thirdPlaceMode: "pool3" });
    if (result.kind !== "bracket") throw new Error("expected bracket");
    const fights = fromGenerated(result.fights);

    const demie = fights.find((f) => f.type === "BraketFight" && f.division === 2)!;
    const rep = repechage3Of(fights)!;
    const finale = fights.find((f) => f.division === 1 && f.type === "BraketFight")!;

    expect(findNextSlot(fights, demie), "le vainqueur de la demie va en finale").toEqual({
      fightId: finale.id,
      slot: demie.indexInDivision % 2 === 0 ? "A" : "B",
    });
    expect(findNextSlot(fights, rep), "le vainqueur du repêchage AUSSI").toEqual({
      fightId: finale.id,
      slot: rep.indexInDivision % 2 === 0 ? "A" : "B",
    });
    expect(
      findRepechage3Slot(fights, demie),
      "le perdant de la demie descend au repêchage",
    ).toEqual({ fightId: rep.id, slot: "A" });
    expect(
      findRepechage3Slot(fights, rep),
      "un repêchage ne se nourrit pas de lui-même",
    ).toBeNull();
  });

  it("N=4 → 2 semis + final + Pool3", () => {
    const result = generateBracket(makeEntries(4), "s", { thirdPlaceMode: "pool3" });
    if (result.kind !== "bracket") throw new Error("expected bracket");
    expect(result.fights).toHaveLength(4);
    expect(result.fights.filter((f) => f.isBye)).toHaveLength(0);
    const pool3 = result.fights.find((f) => f.type === "BraketFightPool3");
    expect(pool3).toMatchObject({ division: 2, indexInDivision: 2 });
    expect(result.realFightCount).toBe(4); // N-1 + Pool3
  });

  it("shared_bronze mode never emits a Pool3", () => {
    const result = generateBracket(makeEntries(8), "s", { thirdPlaceMode: "shared_bronze" });
    if (result.kind !== "bracket") throw new Error("expected bracket");
    expect(result.fights.some((f) => f.type === "BraketFightPool3")).toBe(false);
    expect(result.realFightCount).toBe(7); // N-1
  });
});

describe("generateBracket - structural properties (N=2..33)", () => {
  const seeds = ["alpha", "beta", "gamma"];

  for (let n = 2; n <= 33; n++) {
    for (const seed of seeds) {
      it(`N=${n} seed=${seed}: complete tree, byes valid, Pool3 placement`, () => {
        const entries = makeEntries(n, (i) => `club-${i % 5}`);
        const result = generateBracket(entries, seed, { thirdPlaceMode: "pool3" });
        if (result.kind !== "bracket") throw new Error("expected bracket");

        const size = 2 ** Math.ceil(Math.log2(n));
        const deepest = Math.log2(size);
        const regular = result.fights.filter((f) => f.type === "BraketFight");
        const pool3s = result.fights.filter((f) => f.type === "BraketFightPool3");

        const repechages = result.fights.filter((f) => f.type === "BraketFightRepechage3");
        // À TROIS, LE BYE EST DEVENU UN REPÊCHAGE : l'arbre garde sa forme —
        // trois combats aux mêmes coordonnées — mais l'un d'eux n'est plus un
        // combat « ordinaire ». On le remet dans le compte pour éprouver la
        // FORME, qui elle n'a pas bougé.
        expect(repechages).toHaveLength(n === 3 ? 1 : 0);
        const structurels = [...regular, ...repechages];

        // Complete tree: division d has exactly 2^(d-1) fights of the tree.
        for (let d = 1; d <= deepest; d++) {
          expect(structurels.filter((f) => f.division === d)).toHaveLength(2 ** (d - 1));
        }
        expect(structurels).toHaveLength(size - 1);

        // Pool3 present iff n >= 4, always division 2 index 2, emitted LAST
        // (highest id under sequential allocation).
        expect(pool3s).toHaveLength(n >= 4 ? 1 : 0);
        if (pool3s.length === 1) {
          expect(result.fights[result.fights.length - 1]?.type).toBe("BraketFightPool3");
        }

        // Byes: only in the deepest division, exactly one slot, never two.
        // À TROIS il n'y en a PLUS : le seul qu'il y avait est devenu le
        // repêchage, et c'est tout l'objet du lot — personne ne monte
        // gratuitement en finale.
        const byes = result.fights.filter((f) => f.isBye);
        expect(byes).toHaveLength(n === 3 ? 0 : size - n);
        for (const bye of byes) {
          expect(bye.division).toBe(deepest);
          expect([bye.slotA, bye.slotB].filter(Boolean)).toHaveLength(1);
        }
        // No first-round fight with two empty slots (bye-vs-bye).
        for (const f of structurels.filter((f) => f.division === deepest)) {
          expect(f.slotA !== null || f.slotB !== null).toBe(true);
        }

        // Every entry appears exactly once in the first round.
        const firstRoundIds = structurels
          .filter((f) => f.division === deepest)
          .flatMap((f) => [f.slotA, f.slotB])
          .filter((s): s is string => s !== null)
          .sort();
        expect(firstRoundIds).toEqual(entries.map((e) => e.registrationId).sort());

        // realFightCount invariant. À TROIS il passe de 2 à 3 : le bye qui ne se
        // jouait pas est devenu un combat qui se joue, et c'est la mesure même
        // du lot — un combattant de moins qui monte gratuitement.
        expect(result.realFightCount).toBe(n === 3 ? 3 : n - 1 + (n >= 4 ? 1 : 0));

        // Determinism: same inputs → identical bracket.
        const again = generateBracket(entries, seed, { thirdPlaceMode: "pool3" });
        expect(again).toEqual(result);
      });
    }
  }
});

describe("generateBracket - Jour J propagation simulation", () => {
  const seeds = ["x1", "x2"];

  for (let n = 2; n <= 33; n++) {
    for (const seed of seeds) {
      it(`N=${n} seed=${seed}: the full day resolves to a complete podium`, () => {
        const entries = makeEntries(n, (i) => `club-${i % 4}`);
        const result = generateBracket(entries, seed, { thirdPlaceMode: "pool3" });
        if (result.kind !== "bracket") throw new Error("expected bracket");

        const sim = toSimFights(result.fights);
        simulateDay(sim, fnvSeed(seed) + n);

        // Every fight must be finished - a stuck fight means the structure
        // is incompatible with Jour J's propagation.
        const unfinished = sim.filter((f) => f.status !== "finished");
        expect(unfinished).toHaveLength(0);

        const podium = computePodium(sim);
        const gold = podium.get(1) ?? [];
        const silver = podium.get(2) ?? [];
        const bronze = podium.get(3) ?? [];

        expect(gold).toHaveLength(1);
        expect(silver).toHaveLength(1);
        if (n >= 4) {
          expect(bronze).toHaveLength(1); // Pool3 winner
        } else if (n === 3) {
          expect(bronze).toHaveLength(1); // perdant du repêchage
        } else {
          expect(bronze).toHaveLength(0);
        }

        // Podium competitors are distinct real entries.
        const all = [...gold, ...silver, ...bronze];
        expect(new Set(all).size).toBe(all.length);
        const validIds = new Set(entries.map((e) => e.registrationId));
        for (const id of all) expect(validIds.has(id)).toBe(true);
      });
    }
  }

  it("the Pool3 is never targeted by winner propagation", () => {
    const result = generateBracket(makeEntries(8), "probe", { thirdPlaceMode: "pool3" });
    if (result.kind !== "bracket") throw new Error("expected bracket");
    const sim = toSimFights(result.fights);
    const pool3 = sim.find((f) => f.type === "BraketFightPool3");
    if (!pool3) throw new Error("expected pool3");

    // Quarters (division 3) target indexes 0..1 of division 2 sorted by id;
    // the Pool3 has the highest id → index 2 → never a target.
    const quarters = sim.filter((f) => f.division === 3);
    for (const q of quarters) {
      const target = findNextFight(sim, q);
      expect(target?.fight.id).not.toBe(pool3.id);
    }
    // The Pool3 winner propagates nowhere.
    expect(findNextFight(sim, pool3)).toBeNull();
  });
});

describe("generateBracket - anti-club seeding", () => {
  it("avoids same-club first-round pairings when club sizes allow it", () => {
    // 4 clubs × 4 competitors in a 16 bracket: a zero-conflict round 1 exists.
    for (const seed of ["s1", "s2", "s3", "s4", "s5"]) {
      const entries = makeEntries(16, (i) => `club-${i % 4}`);
      const result = generateBracket(entries, seed, { thirdPlaceMode: "pool3" });
      if (result.kind !== "bracket") throw new Error("expected bracket");
      const clubByReg = new Map(entries.map((e) => [e.registrationId, e.clubId]));
      const firstRound = result.fights.filter((f) => f.division === 4 && !f.isBye);
      const conflicts = firstRound.filter(
        (f) => f.slotA && f.slotB && clubByReg.get(f.slotA) === clubByReg.get(f.slotB),
      );
      expect(conflicts).toHaveLength(0);
    }
  });

  it("a dominant club (more than half the field) yields the minimum conflicts", () => {
    // 6 of 8 from the same club: round 1 has 4 fights, at most 2 can avoid
    // pairing two clubmates → at least 2 conflicts are unavoidable.
    const entries = makeEntries(8, (i) => (i < 6 ? "big-club" : `solo-${i}`));
    const result = generateBracket(entries, "dominant", { thirdPlaceMode: "pool3" });
    if (result.kind !== "bracket") throw new Error("expected bracket");
    const clubByReg = new Map(entries.map((e) => [e.registrationId, e.clubId]));
    const conflicts = result.fights.filter(
      (f) =>
        f.division === 3 && f.slotA && f.slotB && clubByReg.get(f.slotA) === clubByReg.get(f.slotB),
    );
    expect(conflicts.length).toBeLessThanOrEqual(2);
  });
});

function fnvSeed(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

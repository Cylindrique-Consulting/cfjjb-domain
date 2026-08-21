import { describe, expect, it } from "vitest";
import { generateBracket, type BracketEntry, type GeneratedFight } from "../src/bracket-generator";
import { fnv1a, mulberry32 } from "../src/prng";
import {
  applySeedingPlan,
  DEFAULT_SEEDING_PLAN,
  describeSeedingPlan,
  seedPositions,
  SeedingPlanError,
  type SeedingPlan,
} from "../src/seeding-plan";

// ===================================================================
// Outils de lecture
// ===================================================================

function sizeFor(n: number): number {
  return 2 ** Math.ceil(Math.log2(n));
}

/** Le pipeline seul, alimenté par le MÊME tirage que `generateBracket`. */
function seedOnly(entries: BracketEntry[], seed: string, plan: SeedingPlan = DEFAULT_SEEDING_PLAN) {
  return applySeedingPlan(entries, sizeFor(entries.length), mulberry32(fnv1a(seed)), plan);
}

/** Les feuilles du premier tour telles que le tableau généré les expose. */
function generatedLeaves(
  entries: BracketEntry[],
  seed: string,
  plan?: SeedingPlan,
): (string | null)[] {
  const result = generateBracket(entries, seed, { thirdPlaceMode: "pool3", seedingPlan: plan });
  if (result.kind !== "bracket") throw new Error("bracket attendu");
  const regular = result.fights.filter((f: GeneratedFight) => f.type === "BraketFight");
  const deepest = Math.max(...regular.map((f) => f.division));
  return regular
    .filter((f) => f.division === deepest)
    .sort((a, b) => a.indexInDivision - b.indexInDivision)
    .flatMap((f) => [f.slotA, f.slotB]);
}

function ids(leaves: readonly (BracketEntry | null)[]): (string | null)[] {
  return leaves.map((l) => l?.registrationId ?? null);
}

/** Positions des emplacements VIDES (les byes eux-mêmes). */
function byePositions(leaves: readonly (BracketEntry | null)[]): number[] {
  return leaves.map((l, i) => (l === null ? i : -1)).filter((i) => i >= 0);
}

/** Qui saute un tour : l'occupant dont la feuille jumelle est vide. */
function byeHolders(leaves: readonly (BracketEntry | null)[]): string[] {
  const out: string[] = [];
  for (let f = 0; 2 * f + 1 < leaves.length; f++) {
    const a = leaves[2 * f] ?? null;
    const b = leaves[2 * f + 1] ?? null;
    if (a === null && b !== null) out.push(b.registrationId);
    if (b === null && a !== null) out.push(a.registrationId);
  }
  return out.sort();
}

function pairCount(
  leaves: readonly (BracketEntry | null)[],
  block: number,
  key: (e: BracketEntry) => string | null,
): number {
  let pairs = 0;
  for (let start = 0; start < leaves.length; start += block) {
    const counts = new Map<string, number>();
    for (let l = start; l < Math.min(leaves.length, start + block); l++) {
      const entry = leaves[l] ?? null;
      const k = entry ? key(entry) : null;
      if (k !== null) counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    for (const n of counts.values()) pairs += (n * (n - 1)) / 2;
  }
  return pairs;
}

const byClub = (e: BracketEntry) => e.clubId ?? null;
const byTeam = (e: BracketEntry) => e.teamId ?? null;

function withPlan(patch: {
  order?: Partial<Record<string, boolean>>;
  enable?: string[];
  pins?: SeedingPlan["pins"];
}): SeedingPlan {
  return {
    order: DEFAULT_SEEDING_PLAN.order.map((step) =>
      patch.order && step.kind in patch.order
        ? { ...step, enabled: patch.order[step.kind] === true }
        : step,
    ),
    constraints: DEFAULT_SEEDING_PLAN.constraints.map((c) =>
      patch.enable?.includes(c.name) ? { ...c, enabled: true } : c,
    ),
    pins: patch.pins ?? DEFAULT_SEEDING_PLAN.pins,
  };
}

// ===================================================================
// LE GEL : identité au bit avec le placement d'avant le pipeline
// ===================================================================

/**
 * Corpus de référence : 13 inscrits, quatre clubs de tailles inégales et deux
 * sans club.
 *
 * L'ORDRE D'ENTRÉE EST DÉLIBÉRÉMENT MÉLANGÉ, et ce n'est pas décoratif.
 * L'étape 1 regroupe par club dans l'ordre de PREMIÈRE APPARITION, puis
 * mélange groupe par groupe : l'ordre d'arrivée pilote donc la consommation du
 * tirage. Le test `le mélange d'entrée change le tableau` ci-dessous le
 * prouve — sans lui, le gel ne prouverait rien, puisqu'un pipeline qui trierait
 * ses entrées passerait quand même.
 */
const CORPUS: BracketEntry[] = [
  { registrationId: "reg-marseille-2", clubId: "club-marseille" },
  { registrationId: "reg-solo-1", clubId: null },
  { registrationId: "reg-lyon-1", clubId: "club-lyon" },
  { registrationId: "reg-paris-3", clubId: "club-paris" },
  { registrationId: "reg-lyon-3", clubId: "club-lyon" },
  { registrationId: "reg-paris-1", clubId: "club-paris" },
  { registrationId: "reg-nantes-1", clubId: "club-nantes" },
  { registrationId: "reg-marseille-1", clubId: "club-marseille" },
  { registrationId: "reg-paris-4", clubId: "club-paris" },
  { registrationId: "reg-solo-2", clubId: null },
  { registrationId: "reg-lyon-2", clubId: "club-lyon" },
  { registrationId: "reg-paris-2", clubId: "club-paris" },
  { registrationId: "reg-nantes-2", clubId: "club-nantes" },
];

const CORPUS_TRIE = [...CORPUS].sort((a, b) => a.registrationId.localeCompare(b.registrationId));

/** Sortie du générateur AVANT le lot 1e (commit 35b0fc0), relevée telle quelle. */
const GEL_CORPUS: Record<string, (string | null)[]> = {
  "open-idf-2026": [
    "reg-paris-2",
    null,
    "reg-lyon-1",
    "reg-nantes-2",
    "reg-marseille-2",
    "reg-paris-1",
    "reg-solo-2",
    "reg-lyon-3",
    "reg-lyon-2",
    null,
    "reg-paris-4",
    "reg-marseille-1",
    "reg-nantes-1",
    null,
    "reg-solo-1",
    "reg-paris-3",
  ],
  "coupe-de-france": [
    "reg-paris-4",
    null,
    "reg-lyon-1",
    "reg-nantes-2",
    "reg-marseille-1",
    "reg-paris-3",
    "reg-solo-2",
    "reg-lyon-3",
    "reg-lyon-2",
    null,
    "reg-paris-2",
    "reg-marseille-2",
    "reg-nantes-1",
    null,
    "reg-solo-1",
    "reg-paris-1",
  ],
  "graine-3": [
    "reg-paris-2",
    null,
    "reg-lyon-1",
    "reg-nantes-2",
    "reg-marseille-2",
    "reg-paris-3",
    "reg-solo-2",
    "reg-lyon-2",
    "reg-lyon-3",
    null,
    "reg-paris-1",
    "reg-marseille-1",
    "reg-nantes-1",
    null,
    "reg-solo-1",
    "reg-paris-4",
  ],
};

/** Même relevé, sur des sous-ensembles du corpus (tailles 5, 8 et 11). */
const GEL_TAILLES: Record<number, (string | null)[]> = {
  5: ["reg-paris-3", null, "reg-solo-1", "reg-lyon-3", "reg-lyon-1", null, "reg-marseille-2", null],
  8: [
    "reg-lyon-3",
    "reg-paris-3",
    "reg-marseille-2",
    "reg-solo-1",
    "reg-nantes-1",
    "reg-lyon-1",
    "reg-paris-1",
    "reg-marseille-1",
  ],
  11: [
    "reg-lyon-2",
    null,
    "reg-paris-4",
    "reg-marseille-1",
    "reg-paris-1",
    null,
    "reg-solo-1",
    null,
    "reg-nantes-1",
    null,
    "reg-lyon-1",
    "reg-paris-3",
    "reg-marseille-2",
    null,
    "reg-solo-2",
    "reg-lyon-3",
  ],
};

/**
 * Balayage compact, relevé sur le même commit : N = 2..33, deux graines, cinq
 * clubs répartis par `(i × 3) % 5`. Format : `NN/graine feuilles`, un `.` pour
 * un emplacement de bye, le préfixe `reg-` retiré.
 */
const GEL_BALAYAGE: string[] = [
  "02/alpha 1,2",
  "02/beta 2,1",
  "03/alpha 3,.,1,2",
  "03/beta 3,.,1,2",
  "04/alpha 4,3,2,1",
  "04/beta 3,2,1,4",
  "05/alpha 1,.,2,3,4,.,5,.",
  "05/beta 3,.,5,2,4,.,1,.",
  "06/alpha 1,.,4,2,5,.,3,6",
  "06/beta 6,.,5,2,4,.,3,1",
  "07/alpha 1,.,7,5,4,6,3,2",
  "07/beta 7,.,6,4,3,2,5,1",
  "08/alpha 7,8,1,5,4,2,3,6",
  "08/beta 6,3,7,5,4,1,8,2",
  "09/alpha 3,.,2,9,4,.,5,.,1,.,8,.,7,.,6,.",
  "09/beta 8,.,2,9,4,.,5,.,6,.,3,.,7,.,1,.",
  "10/alpha 1,.,8,9,4,.,7,.,5,.,6,2,3,.,10,.",
  "10/beta 4,.,3,2,7,.,5,.,6,.,9,10,8,.,1,.",
  "11/alpha 1,.,8,5,10,.,4,.,11,.,7,9,3,.,2,6",
  "11/beta 1,.,10,9,4,.,7,.,11,.,8,2,5,.,3,6",
  "12/alpha 7,.,8,4,9,.,5,6,2,.,1,10,3,.,11,12",
  "12/beta 1,.,9,8,3,.,10,2,11,.,7,5,4,.,12,6",
  "13/alpha 7,.,1,9,4,6,5,13,2,.,3,10,11,.,8,12",
  "13/beta 1,.,8,10,5,13,9,2,11,.,7,4,3,.,12,6",
  "14/alpha 3,.,9,1,11,14,10,12,8,.,7,5,4,6,2,13",
  "14/beta 1,.,8,7,12,13,5,9,11,.,14,10,3,2,4,6",
  "15/alpha 9,.,5,3,8,12,10,6,4,7,1,15,2,13,11,14",
  "15/beta 5,.,2,14,4,13,12,6,15,8,1,7,3,9,11,10",
  "16/alpha 8,12,16,10,15,11,3,14,7,6,4,13,2,5,9,1",
  "16/beta 10,12,11,9,4,6,15,13,7,1,3,5,2,14,8,16",
  "17/alpha 14,.,11,17,16,.,10,.,6,.,4,.,3,.,12,.,7,.,13,.,2,.,8,.,9,.,15,.,5,.,1,.",
  "17/beta 4,.,17,6,2,.,13,.,7,.,9,.,15,.,16,.,11,.,5,.,1,.,10,.,14,.,8,.,3,.,12,.",
  "18/alpha 2,.,18,11,8,.,15,.,3,.,12,.,14,.,1,.,16,.,4,17,6,.,9,.,7,.,10,.,5,.,13,.",
  "18/beta 1,.,17,8,2,.,10,.,7,.,16,.,14,.,13,.,3,.,9,6,18,.,4,.,11,.,15,.,5,.,12,.",
  "19/alpha 2,.,16,4,7,.,3,.,8,.,1,.,15,.,14,.,19,.,10,11,9,.,5,.,17,.,6,18,13,.,12,.",
  "19/beta 19,.,11,17,14,.,18,.,3,.,16,.,10,.,12,.,2,.,15,6,7,.,5,.,9,.,1,8,13,.,4,.",
  "20/alpha 20,.,19,11,5,.,2,.,7,.,14,18,8,.,1,.,16,.,13,4,6,.,3,.,15,.,9,17,12,.,10,.",
  "20/beta 7,.,3,20,2,.,1,.,11,.,13,9,14,.,5,.,15,.,4,8,10,.,19,.,17,.,18,6,16,.,12,.",
  "21/alpha 16,.,4,18,1,.,20,.,5,.,9,12,2,.,3,11,8,.,7,19,13,.,17,.,6,.,14,10,15,.,21,.",
  "21/beta 16,.,7,9,11,.,10,.,20,.,12,18,13,.,14,6,4,.,8,17,19,.,3,.,21,.,2,5,15,.,1,.",
  "22/alpha 22,.,19,6,2,.,5,.,15,.,9,3,13,.,21,17,1,.,18,14,16,.,8,.,7,.,4,20,10,.,12,11",
  "22/beta 12,.,10,21,2,.,3,.,18,.,15,19,9,.,1,22,11,.,14,20,16,.,4,.,17,.,5,13,8,.,7,6",
  "23/alpha 16,.,2,23,1,.,20,.,10,.,12,14,4,.,13,11,18,.,9,7,8,.,19,17,6,.,22,15,5,.,21,3",
  "23/beta 18,.,11,17,23,.,10,.,20,.,1,19,14,.,7,13,2,.,4,21,12,.,9,6,8,.,16,15,5,.,3,22",
  "24/alpha 16,.,12,23,1,.,19,17,2,.,24,10,22,.,13,11,18,.,20,9,8,.,5,14,4,.,6,7,15,.,21,3",
  "24/beta 16,.,7,4,11,.,18,22,2,.,3,5,12,.,14,6,19,.,15,8,9,.,20,13,23,.,21,17,10,.,1,24",
  "25/alpha 19,.,5,6,4,3,22,10,15,.,12,23,20,.,21,14,1,.,13,7,16,.,8,17,2,.,9,25,18,.,24,11",
  "25/beta 18,.,14,21,23,22,10,24,19,.,25,17,9,.,1,13,11,.,7,15,16,.,12,5,20,.,8,4,2,.,3,6",
  "26/alpha 21,.,8,5,1,9,2,3,23,.,12,19,13,.,25,6,10,.,24,17,20,16,4,7,22,.,26,18,14,.,11,15",
  "26/beta 16,.,13,7,1,20,24,8,3,.,14,5,18,.,12,6,2,.,15,19,17,11,25,4,9,.,21,23,10,.,26,22",
  "27/alpha 21,.,25,22,1,23,12,10,5,.,4,13,15,.,2,6,7,.,8,14,27,16,3,24,9,.,26,20,18,19,11,17",
  "27/beta 2,.,4,21,12,8,11,24,19,.,10,18,9,.,26,7,1,.,13,20,16,22,3,5,25,.,17,14,23,15,27,6",
  "28/alpha 21,.,20,23,1,14,28,25,5,.,2,9,15,12,8,6,3,.,19,22,18,16,4,17,7,.,26,10,24,27,11,13",
  "28/beta 2,.,14,18,12,25,8,19,9,.,26,10,24,11,3,7,13,.,15,21,28,22,20,6,1,.,17,4,5,16,27,23",
  "29/alpha 27,.,3,26,7,15,16,13,22,28,4,25,18,19,11,17,1,.,8,24,21,12,5,9,14,.,20,23,10,29,2,6",
  "29/beta 2,.,1,18,12,10,8,6,17,11,29,20,16,24,3,7,13,.,26,14,28,22,5,4,19,.,15,21,25,9,27,23",
  "30/alpha 19,.,25,22,3,9,12,20,23,15,11,24,10,16,2,13,7,.,5,26,27,28,29,6,1,18,14,30,4,21,8,17",
  "30/beta 11,.,10,18,19,6,8,25,14,15,27,21,20,22,3,4,13,.,5,17,28,24,16,7,12,9,1,30,26,2,29,23",
  "31/alpha 1,.,3,2,26,15,22,13,31,18,24,10,28,9,17,21,12,23,25,4,7,6,30,14,29,16,5,8,20,19,11,27",
  "31/beta 21,.,9,5,1,22,30,19,16,4,13,27,24,28,20,6,10,14,7,3,25,31,2,23,18,11,17,29,12,8,26,15",
  "32/alpha 7,9,5,31,17,16,3,10,22,6,23,19,4,25,11,2,26,15,24,28,1,32,29,8,27,14,18,30,13,20,12,21",
  "32/beta 21,3,10,7,1,12,14,5,16,27,9,18,8,15,2,6,22,30,13,19,17,31,23,4,11,28,24,25,29,20,26,32",
  "33/alpha 14,.,18,16,4,.,28,.,19,.,25,.,17,.,24,.,22,.,9,.,11,.,15,.,30,.,6,.,3,.,2,.,8,.,27,.,20,.,31,.,33,.,32,.,5,.,21,.,26,.,10,.,1,.,29,.,7,.,13,.,12,.,23,.",
  "33/beta 15,.,12,33,10,.,7,.,20,.,24,.,1,.,30,.,16,.,5,.,3,.,9,.,29,.,8,.,2,.,6,.,22,.,11,.,14,.,13,.,17,.,31,.,19,.,23,.,18,.,4,.,28,.,25,.,21,.,27,.,26,.,32,.",
];

describe("gel : le plan par défaut rend le placement d'avant le pipeline", () => {
  for (const [seed, expected] of Object.entries(GEL_CORPUS)) {
    it(`corpus mélangé, graine ${seed} : feuilles identiques au bit`, () => {
      expect(generatedLeaves(CORPUS, seed)).toEqual(expected);
    });
  }

  for (const [n, expected] of Object.entries(GEL_TAILLES)) {
    it(`corpus mélangé tronqué à ${n} inscrits : feuilles identiques au bit`, () => {
      expect(generatedLeaves(CORPUS.slice(0, Number(n)), "open-idf-2026")).toEqual(expected);
    });
  }

  it("balayage N=2..33 sur deux graines : feuilles identiques au bit", () => {
    const actual: string[] = [];
    for (let n = 2; n <= 33; n++) {
      for (const seed of ["alpha", "beta"]) {
        const entries = Array.from({ length: n }, (_, i) => ({
          registrationId: `reg-${i + 1}`,
          clubId: `club-${(i * 3) % 5}`,
        }));
        actual.push(
          `${String(n).padStart(2, "0")}/${seed} ${generatedLeaves(entries, seed)
            .map((x) => (x === null ? "." : x.replace("reg-", "")))
            .join(",")}`,
        );
      }
    }
    expect(actual).toEqual(GEL_BALAYAGE);
  });

  it("le mélange d'entrée change le tableau (sans quoi le gel ne prouverait rien)", () => {
    for (const seed of Object.keys(GEL_CORPUS)) {
      expect(
        generatedLeaves(CORPUS_TRIE, seed),
        `graine ${seed} : le corpus trié doit donner un AUTRE tableau que le corpus mélangé`,
      ).not.toEqual(GEL_CORPUS[seed]);
    }
  });

  it("le plan par défaut ne pose aucun avertissement sur le résultat", () => {
    const result = generateBracket(CORPUS, "open-idf-2026", { thirdPlaceMode: "pool3" });
    if (result.kind !== "bracket") throw new Error("bracket attendu");
    expect(Object.hasOwn(result, "warnings")).toBe(false);
  });

  it("passer explicitement le plan par défaut ne change rien", () => {
    for (const seed of Object.keys(GEL_CORPUS)) {
      expect(generatedLeaves(CORPUS, seed, DEFAULT_SEEDING_PLAN)).toEqual(GEL_CORPUS[seed]);
    }
  });
});

// ===================================================================
// Les trois étapes sont nommées et lisibles
// ===================================================================

describe("le pipeline en trois étapes", () => {
  it("rend l'ordre des graines, le placement standard et la réparation", () => {
    const outcome = seedOnly(CORPUS, "open-idf-2026");
    expect(outcome.seedOrder).toHaveLength(CORPUS.length);
    expect(new Set(outcome.seedOrder.map((e) => e.registrationId)).size).toBe(CORPUS.length);

    // Étape 2 : les graines aux positions canoniques, byes aux rangs > N.
    const positions = seedPositions(16);
    expect(ids(outcome.placement)).toEqual(
      positions.map((s) => outcome.seedOrder[s - 1]?.registrationId ?? null),
    );

    // Étape 3 : une permutation des mêmes occupants.
    expect(ids(outcome.leaves).slice().sort()).toEqual(ids(outcome.placement).slice().sort());
    expect(ids(outcome.leaves)).toEqual(GEL_CORPUS["open-idf-2026"]);
  });

  it("le plan se décrit sans lire le code", () => {
    const lines = describeSeedingPlan();
    expect(lines.some((l) => l.includes("entrelacement par club") && l.includes("actif"))).toBe(
      true,
    );
    expect(lines.some((l) => l.includes("classement protégé") && l.includes("éteint"))).toBe(true);
    expect(lines.some((l) => l.includes("meme-equipe-meme-moitie") && l.includes("éteint"))).toBe(
      true,
    );
    expect(lines.some((l) => l.startsWith("2. placement standard"))).toBe(true);
  });

  it("toutes les règles neuves sont ÉTEINTES dans le plan par défaut", () => {
    expect(
      DEFAULT_SEEDING_PLAN.order.filter((s) => s.enabled).map((s) => s.kind),
      "seul l'entrelacement anti-club est actif par défaut",
    ).toEqual(["interleave"]);
    expect(
      DEFAULT_SEEDING_PLAN.constraints.filter((c) => c.enabled).map((c) => c.name),
      "seules les deux contraintes anti-club historiques sont actives par défaut",
    ).toEqual(["meme-club-premier-tour", "meme-club-quart-de-tableau"]);
  });
});

// ===================================================================
// `pinned` : ce que la réparation n'a pas le droit de déplacer
// ===================================================================

describe("pinned", () => {
  const CLUBS_6: BracketEntry[] = Array.from({ length: 6 }, (_, i) => ({
    registrationId: `reg-${i + 1}`,
    clubId: `club-${i % 3}`,
  }));

  const GRAINES = Array.from({ length: 40 }, (_, i) => `graine-${i}`);

  it("les EMPLACEMENTS de bye ne bougent jamais (le comportement d'avant, nommé)", () => {
    for (let n = 3; n <= 24; n++) {
      const entries = Array.from({ length: n }, (_, i) => ({
        registrationId: `reg-${i + 1}`,
        clubId: `club-${i % 3}`,
      }));
      for (const seed of GRAINES.slice(0, 8)) {
        const { placement, leaves } = seedOnly(entries, seed);
        expect(
          byePositions(leaves),
          `N=${n} graine=${seed} : la réparation a déplacé un emplacement de bye`,
        ).toEqual(byePositions(placement));
      }
    }
  });

  it("mais le BÉNÉFICIAIRE du bye, lui, peut changer de mains", () => {
    // La prémisse « un combattant à qui on a accordé un bye ne peut jamais en
    // être échangé » est FAUSSE sur le code d'avant : seul l'emplacement est
    // figé. Ce test fige la mesure.
    const transferts = GRAINES.filter((seed) => {
      const { placement, leaves } = seedOnly(CLUBS_6, seed);
      return byeHolders(leaves).join() !== byeHolders(placement).join();
    });
    expect(
      transferts.length,
      "aucun transfert de bye : la mesure du 21/08 en relevait sur la moitié des tirages",
    ).toBeGreaterThan(0);
  });

  it("la règle `bye-holders` fige vraiment le bénéficiaire", () => {
    const plan = withPlan({ pins: [{ kind: "empty-leaves" }, { kind: "bye-holders" }] });
    for (let n = 3; n <= 24; n++) {
      const entries = Array.from({ length: n }, (_, i) => ({
        registrationId: `reg-${i + 1}`,
        clubId: `club-${i % 3}`,
      }));
      for (const seed of GRAINES.slice(0, 8)) {
        const { placement, leaves } = seedOnly(entries, seed, plan);
        expect(
          byeHolders(leaves),
          `N=${n} graine=${seed} : un bye a changé de mains malgré le verrou`,
        ).toEqual(byeHolders(placement));
      }
    }
  });

  it("sans le verrou `empty-leaves`, un bye se déplace - mais jamais un combat vide", () => {
    const plan = withPlan({ pins: [] });
    let deplacements = 0;
    for (let n = 3; n <= 24; n++) {
      const entries = Array.from({ length: n }, (_, i) => ({
        registrationId: `reg-${i + 1}`,
        clubId: `club-${i % 3}`,
      }));
      for (const seed of GRAINES.slice(0, 12)) {
        const { placement, leaves } = seedOnly(entries, seed, plan);
        if (byePositions(leaves).join() !== byePositions(placement).join()) deplacements++;
        // L'invariant structurel tient quand même : aucun combat du premier
        // tour ne peut se retrouver sans aucun compétiteur.
        for (let f = 0; 2 * f + 1 < leaves.length; f++) {
          expect(
            (leaves[2 * f] ?? null) !== null || (leaves[2 * f + 1] ?? null) !== null,
            `N=${n} graine=${seed} : combat ${f} sans aucun compétiteur`,
          ).toBe(true);
        }
      }
    }
    expect(deplacements, "le verrou `empty-leaves` ne retenait donc rien").toBeGreaterThan(0);
  });

  it("la règle `leaves` fige des positions nommées", () => {
    const entries = Array.from({ length: 8 }, (_, i) => ({
      registrationId: `reg-${i + 1}`,
      clubId: `club-${i % 2}`,
    }));
    const plan = withPlan({
      pins: [{ kind: "empty-leaves" }, { kind: "leaves", leaves: [0, 1, 2, 3] }],
    });
    const { placement, leaves } = seedOnly(entries, "graine-fixe", plan);
    expect(ids(leaves).slice(0, 4)).toEqual(ids(placement).slice(0, 4));
  });
});

// ===================================================================
// Classement protégé
// ===================================================================

describe("classement protégé", () => {
  /** N inscrits de clubs tous distincts : la réparation n'a rien à faire. */
  function ranked(n: number, ranks: Record<number, number>): BracketEntry[] {
    return Array.from({ length: n }, (_, i) => ({
      registrationId: `reg-${i + 1}`,
      clubId: `club-${i + 1}`,
      rank: ranks[i + 1] ?? null,
    }));
  }

  function planProtege(count: number, whenExceedingByes: "degrade" | "reject"): SeedingPlan {
    return {
      ...DEFAULT_SEEDING_PLAN,
      order: DEFAULT_SEEDING_PLAN.order.map((step) =>
        step.kind === "protected-ranking"
          ? { ...step, enabled: true, count, whenExceedingByes }
          : step,
      ),
    };
  }

  it("les k premiers du classement prennent les graines 1..k et sautent un tour", () => {
    // N=5 → taille 8 → 3 byes. Deux protégés tiennent largement.
    const entries = ranked(5, { 4: 1, 2: 2 });
    const { seedOrder, leaves } = seedOnly(entries, "protege-a", planProtege(2, "degrade"));
    expect(seedOrder.slice(0, 2).map((e) => e.registrationId)).toEqual(["reg-4", "reg-2"]);
    expect(byeHolders(leaves)).toContain("reg-4");
    expect(byeHolders(leaves)).toContain("reg-2");
  });

  it("le rang 1 passe devant le rang 2, quelle que soit la graine", () => {
    // Le classement protégé s'applique APRÈS l'entrelacement : c'est bien le
    // rang, et non le hasard du tourniquet, qui doit trancher.
    const entries = ranked(5, { 1: 9, 5: 3 });
    for (let i = 0; i < 24; i++) {
      const seed = `protege-b-${i}`;
      const { seedOrder } = seedOnly(entries, seed, planProtege(2, "degrade"));
      expect(
        seedOrder.slice(0, 2).map((e) => e.registrationId),
        `graine ${seed} : le mieux classé n'est pas la graine 1`,
      ).toEqual(["reg-5", "reg-1"]);
    }
  });

  it("protéger plus de monde qu'il n'y a de byes : dégradation ANNONCÉE, pas tue", () => {
    // N=6 → taille 8 → 2 byes seulement, pour 4 protégés.
    const entries = ranked(6, { 1: 4, 2: 1, 3: 3, 4: 2 });
    const { seedOrder, leaves, warnings } = seedOnly(
      entries,
      "protege-c",
      planProtege(4, "degrade"),
    );
    expect(seedOrder.slice(0, 4).map((e) => e.registrationId)).toEqual([
      "reg-2",
      "reg-4",
      "reg-3",
      "reg-1",
    ]);
    expect(warnings).toEqual([
      { code: "protected-ranking-exceeds-byes", protectedCount: 4, byeCount: 2 },
    ]);
    // Les DEUX mieux classés sautent un tour, les deux suivants combattent.
    expect(byeHolders(leaves)).toEqual(["reg-2", "reg-4"].sort());
  });

  it("le débordement remonte jusqu'au résultat du générateur", () => {
    const entries = ranked(6, { 1: 4, 2: 1, 3: 3, 4: 2 });
    const result = generateBracket(entries, "protege-c", {
      thirdPlaceMode: "pool3",
      seedingPlan: planProtege(4, "degrade"),
    });
    if (result.kind !== "bracket") throw new Error("bracket attendu");
    expect(result.warnings).toEqual([
      { code: "protected-ranking-exceeds-byes", protectedCount: 4, byeCount: 2 },
    ]);
  });

  it("`reject` refuse plutôt que de dégrader", () => {
    const entries = ranked(6, { 1: 4, 2: 1, 3: 3, 4: 2 });
    expect(() => seedOnly(entries, "protege-c", planProtege(4, "reject"))).toThrow(
      SeedingPlanError,
    );
  });

  it("protéger plus de monde que de classés le dit aussi", () => {
    const entries = ranked(8, { 3: 1 });
    const { warnings } = seedOnly(entries, "protege-d", planProtege(3, "degrade"));
    expect(warnings).toContainEqual({
      code: "protected-ranking-missing-rank",
      requested: 3,
      ranked: 1,
    });
  });

  it("sans verrou, la réparation peut reprendre le bye d'un protégé ; `bye-holders` le tient", () => {
    // Des clubmates, donc une réparation qui a du travail.
    const entries: BracketEntry[] = Array.from({ length: 6 }, (_, i) => ({
      registrationId: `reg-${i + 1}`,
      clubId: `club-${i % 2}`,
      rank: i < 2 ? i + 1 : null,
    }));
    const graines = Array.from({ length: 40 }, (_, i) => `p-${i}`);

    const perdus = graines.filter((seed) => {
      const { leaves } = seedOnly(entries, seed, planProtege(2, "degrade"));
      return !byeHolders(leaves).includes("reg-1");
    });
    expect(
      perdus.length,
      "le classement protégé sans verrou serait donc déjà garanti - il ne l'est pas",
    ).toBeGreaterThan(0);

    const plan = {
      ...planProtege(2, "degrade"),
      pins: [{ kind: "empty-leaves" as const }, { kind: "bye-holders" as const }],
    };
    for (const seed of graines) {
      const { leaves } = seedOnly(entries, seed, plan);
      expect(byeHolders(leaves), `graine ${seed} : le protégé a perdu son bye`).toContain("reg-1");
    }
  });
});

// ===================================================================
// Équipe de France : les deux formes, toutes deux exprimables
// ===================================================================

describe("équipe de France", () => {
  it("forme « bonus de rang » : chaque sélectionné remonte de `bonus` places", () => {
    const entries: BracketEntry[] = Array.from({ length: 8 }, (_, i) => ({
      registrationId: `reg-${i + 1}`,
      clubId: `club-${i + 1}`,
      nationalTeam: i === 5,
    }));
    // Entrelacement éteint : l'ordre d'entrée est l'ordre des graines, donc le
    // bonus se lit à l'oeil nu.
    const plan: SeedingPlan = {
      ...DEFAULT_SEEDING_PLAN,
      order: DEFAULT_SEEDING_PLAN.order.map((step) => {
        if (step.kind === "interleave") return { ...step, enabled: false };
        if (step.kind === "rank-bonus") return { ...step, enabled: true, bonus: 3 };
        return step;
      }),
    };
    const { seedOrder } = seedOnly(entries, "edf-a", plan);
    expect(seedOrder.map((e) => e.registrationId)).toEqual([
      "reg-1",
      "reg-2",
      "reg-3",
      "reg-6",
      "reg-4",
      "reg-5",
      "reg-7",
      "reg-8",
    ]);
  });

  it("forme « séparation » : les sélectionnés se répartissent entre les moitiés", () => {
    const entries: BracketEntry[] = Array.from({ length: 8 }, (_, i) => ({
      registrationId: `reg-${i + 1}`,
      clubId: `club-${i + 1}`,
      nationalTeam: i < 4,
    }));
    const plan = withPlan({ enable: ["equipe-de-France-meme-moitie"] });
    for (const seed of ["edf-1", "edf-2", "edf-3", "edf-4", "edf-5"]) {
      const { leaves } = seedOnly(entries, seed, plan);
      const premiere = leaves.slice(0, 4).filter((l) => l?.nationalTeam === true).length;
      expect(premiere, `graine ${seed} : répartition ${premiere}/4 dans la première moitié`).toBe(
        2,
      );
    }
  });

  it("les deux formes sont éteintes par défaut", () => {
    const entries: BracketEntry[] = Array.from({ length: 8 }, (_, i) => ({
      registrationId: `reg-${i + 1}`,
      clubId: `club-${i + 1}`,
      nationalTeam: i < 4,
    }));
    const sans = entries.map((e) => ({ registrationId: e.registrationId, clubId: e.clubId }));
    for (const seed of ["edf-1", "edf-2", "edf-3"]) {
      expect(
        ids(seedOnly(entries, seed).leaves),
        `graine ${seed} : le drapeau équipe de France a changé le tableau par défaut`,
      ).toEqual(ids(seedOnly(sans, seed).leaves));
    }
  });
});

// ===================================================================
// Même équipe des deux côtés du tableau
// ===================================================================

describe("même équipe", () => {
  /** Huit inscrits, clubs tous distincts, quatre équipes de deux. */
  const EQUIPES: BracketEntry[] = Array.from({ length: 8 }, (_, i) => ({
    registrationId: `reg-${i + 1}`,
    clubId: `club-${i + 1}`,
    teamId: `team-${String.fromCharCode(65 + Math.floor(i / 2))}`,
  }));

  const GRAINES = ["eq-1", "eq-2", "eq-3", "eq-4", "eq-5", "eq-6"];

  it("le plan par défaut ignore la clé d'équipe (elle n'est pas le club)", () => {
    const collisions = GRAINES.filter(
      (seed) => pairCount(seedOnly(EQUIPES, seed).leaves, 2, byTeam) > 0,
    );
    expect(
      collisions.length,
      "sans la contrainte d'équipe, des coéquipiers devraient se rencontrer au premier tour",
    ).toBeGreaterThan(0);
  });

  it("la contrainte de premier tour supprime les rencontres entre coéquipiers", () => {
    const plan = withPlan({ enable: ["meme-equipe-premier-tour"] });
    for (const seed of GRAINES) {
      expect(
        pairCount(seedOnly(EQUIPES, seed, plan).leaves, 2, byTeam),
        `graine ${seed} : coéquipiers appariés au premier tour`,
      ).toBe(0);
    }
  });

  it("la contrainte de moitié met chaque équipe des DEUX côtés du tableau", () => {
    const plan = withPlan({ enable: ["meme-equipe-meme-moitie"] });
    for (const seed of GRAINES) {
      const leaves = seedOnly(EQUIPES, seed, plan).leaves;
      expect(
        pairCount(leaves, 4, byTeam),
        `graine ${seed} : une équipe entière dans la même moitié`,
      ).toBe(0);
    }
  });

  it("elle n'abîme pas l'anti-club, qui reste au palier supérieur", () => {
    // Clubs ET équipes en conflit : le club passe d'abord.
    const melange: BracketEntry[] = Array.from({ length: 8 }, (_, i) => ({
      registrationId: `reg-${i + 1}`,
      clubId: `club-${i % 4}`,
      teamId: `team-${i % 2}`,
    }));
    const plan = withPlan({ enable: ["meme-equipe-meme-moitie"] });
    for (const seed of GRAINES) {
      expect(
        pairCount(seedOnly(melange, seed, plan).leaves, 2, byClub),
        `graine ${seed} : clubmates au premier tour alors que l'anti-club est prioritaire`,
      ).toBe(0);
    }
  });
});

// ===================================================================
// Paliers et poids
// ===================================================================

describe("amélioration lexicographique", () => {
  const CLUBMATES: BracketEntry[] = Array.from({ length: 16 }, (_, i) => ({
    registrationId: `reg-${i + 1}`,
    clubId: `club-${i % 4}`,
  }));
  const GRAINES = Array.from({ length: 12 }, (_, i) => `lex-${i}`);

  it("le premier tour passe AVANT le quart de tableau", () => {
    for (const seed of GRAINES) {
      expect(
        pairCount(seedOnly(CLUBMATES, seed).leaves, 2, byClub),
        `graine ${seed} : un conflit de premier tour subsiste alors qu'il est évitable`,
      ).toBe(0);
    }
  });

  it("le score est lu PALIER PAR PALIER, et non additionné", () => {
    // Une somme des paliers serait invariante par échange des deux paliers :
    // les deux plans rendraient alors le même tableau, sur toutes les graines.
    // 13 inscrits, trois clubs (5, 4, 4) et trois byes : le corpus où
    // l'ordre des paliers se voit.
    const treize: BracketEntry[] = Array.from({ length: 13 }, (_, i) => ({
      registrationId: `reg-${i + 1}`,
      clubId: `club-${i % 3}`,
    }));
    const inverse: SeedingPlan = {
      ...DEFAULT_SEEDING_PLAN,
      constraints: DEFAULT_SEEDING_PLAN.constraints.map((c) => {
        if (c.name === "meme-club-premier-tour") return { ...c, tier: 1 };
        if (c.name === "meme-club-quart-de-tableau") return { ...c, tier: 0 };
        return c;
      }),
    };
    const differents = GRAINES.filter(
      (seed) =>
        ids(seedOnly(treize, seed, inverse).leaves).join() !==
        ids(seedOnly(treize, seed).leaves).join(),
    );
    expect(
      differents.length,
      "les deux ordres de paliers rendent le même tableau : le score est plat",
    ).toBe(GRAINES.length);
  });

  it("un poids nul éteint une contrainte aussi sûrement qu'`enabled: false`", () => {
    const sansPoids: SeedingPlan = {
      ...DEFAULT_SEEDING_PLAN,
      constraints: DEFAULT_SEEDING_PLAN.constraints.map((c) =>
        c.key === "club" ? { ...c, weight: 0 } : c,
      ),
    };
    for (const seed of GRAINES) {
      // Score entièrement nul : la réparation ne tourne pas, le placement
      // standard sort tel quel.
      const outcome = seedOnly(CLUBMATES, seed, sansPoids);
      expect(ids(outcome.leaves)).toEqual(ids(outcome.placement));
    }
  });
});

// ===================================================================
// Déterminisme
// ===================================================================

describe("déterminisme", () => {
  it("deux exécutions du pipeline rendent le même tableau", () => {
    for (const seed of ["det-1", "det-2", "det-3"]) {
      expect(ids(seedOnly(CORPUS, seed).leaves)).toEqual(ids(seedOnly(CORPUS, seed).leaves));
    }
  });

  it("deux graines différentes rendent des tableaux différents", () => {
    const a = ids(seedOnly(CORPUS, "det-1").leaves).join();
    const b = ids(seedOnly(CORPUS, "det-2").leaves).join();
    expect(a).not.toEqual(b);
  });
});

import { describe, expect, it } from "vitest";
import type { BracketEntry, GeneratedFight } from "../src/bracket-generator";
import {
  generatePool,
  MAX_POOL_SIZE_DEFAULT,
  poolFightCount,
  poolRoundCount,
  PoolTooLargeError,
  POOL_SIZES_WITHOUT_REST,
  type PoolResult,
} from "../src/pool-generator";

// ===================================================================
// Outils de lecture
// ===================================================================

function entries(n: number): BracketEntry[] {
  return Array.from({ length: n }, (_, i) => ({ registrationId: `r${i + 1}`, clubId: null }));
}

type Pool = Extract<PoolResult, { kind: "pool" }>;

/** `maxSize` généreux : le plafond est une POLITIQUE, testée à part. */
function poolOf(n: number, seed = "graine"): Pool {
  const result = generatePool(entries(n), seed, { maxSize: 64 });
  if (result.kind !== "pool") throw new Error(`poule attendue pour n=${n}, reçu ${result.kind}`);
  return result;
}

function pairKey(a: string | null, b: string | null): string {
  const x = a ?? "";
  const y = b ?? "";
  return x < y ? `${x}|${y}` : `${y}|${x}`;
}

function share(f: GeneratedFight, g: GeneratedFight): boolean {
  return f.slotA === g.slotA || f.slotA === g.slotB || f.slotB === g.slotA || f.slotB === g.slotB;
}

/** Les enchaînements RÉELS de la suite aplatie : le second combat de chaque paire. */
function backToBackIndexes(fights: readonly GeneratedFight[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < fights.length; i++) {
    const previous = fights[i - 1];
    const current = fights[i];
    if (previous && current && share(previous, current)) out.push(current.indexInDivision);
  }
  return out;
}

/**
 * PREUVE, et non commentaire : existe-t-il UN ordre des C(n,2) combats sans
 * enchaînement ? La recherche n'impose même pas la structure en tours, elle est
 * donc plus permissive que le générateur : un « non » ici est définitif.
 */
function unOrdreSansEnchainementExiste(n: number): boolean {
  const combats: Array<readonly [number, number]> = [];
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) combats.push([a, b]);
  const utilise = new Array<boolean>(combats.length).fill(false);
  const conflit = (x: readonly [number, number], y: readonly [number, number]) =>
    x[0] === y[0] || x[0] === y[1] || x[1] === y[0] || x[1] === y[1];

  const explorer = (dernier: number, profondeur: number): boolean => {
    if (profondeur === combats.length) return true;
    for (let i = 0; i < combats.length; i++) {
      if (utilise[i]) continue;
      const candidat = combats[i];
      const precedent = dernier >= 0 ? combats[dernier] : null;
      if (!candidat) continue;
      if (precedent && conflit(precedent, candidat)) continue;
      utilise[i] = true;
      if (explorer(i, profondeur + 1)) return true;
      utilise[i] = false;
    }
    return false;
  };
  return explorer(-1, 0);
}

const TAILLES = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

// ===================================================================
// La méthode du cercle
// ===================================================================

describe("le round-robin", () => {
  it("fait se rencontrer chaque paire EXACTEMENT une fois", () => {
    for (const n of TAILLES) {
      const pool = poolOf(n);
      const vues = pool.fights.map((f) => pairKey(f.slotA, f.slotB));
      const distinctes = new Set(vues);
      expect(
        { n, combats: vues.length, distinctes: distinctes.size },
        `n=${n} : un appariement est répété`,
      ).toEqual({ n, combats: poolFightCount(n), distinctes: poolFightCount(n) });
    }
  });

  it("ne laisse aucune paire non disputée", () => {
    for (const n of TAILLES) {
      const pool = poolOf(n);
      const vues = new Set(pool.fights.map((f) => pairKey(f.slotA, f.slotB)));
      const attendues: string[] = [];
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          attendues.push(pairKey(pool.competitorIds[i] ?? null, pool.competitorIds[j] ?? null));
        }
      }
      const manquantes = attendues.filter((p) => !vues.has(p));
      expect(manquantes, `n=${n} : paires jamais programmées`).toEqual([]);
    }
  });

  it("compte n-1 tours à n pair, n tours à n impair", () => {
    for (const n of TAILLES) {
      expect(poolOf(n).rounds.length, `n=${n}`).toBe(poolRoundCount(n));
    }
  });

  it("fait combattre chacun EXACTEMENT une fois par tour quand n est pair", () => {
    for (const n of TAILLES.filter((x) => x % 2 === 0)) {
      const pool = poolOf(n);
      for (const round of pool.rounds) {
        const occupants = round.fightIndexes.flatMap((i) => {
          const f = pool.fights[i];
          return [f?.slotA ?? null, f?.slotB ?? null];
        });
        expect(new Set(occupants).size, `n=${n}, tour ${round.round}`).toBe(n);
        expect(round.restingRegistrationId, `n=${n} : personne ne se repose à n pair`).toBeNull();
      }
    }
  });

  it("met EXACTEMENT un compétiteur au repos par tour quand n est impair, et chacun une seule fois", () => {
    for (const n of TAILLES.filter((x) => x % 2 === 1)) {
      const pool = poolOf(n);
      const repos: string[] = [];
      for (const round of pool.rounds) {
        const occupants = round.fightIndexes.flatMap((i) => {
          const f = pool.fights[i];
          return [f?.slotA ?? null, f?.slotB ?? null];
        });
        expect(new Set(occupants).size, `n=${n}, tour ${round.round}`).toBe(n - 1);
        const rest = round.restingRegistrationId;
        expect(rest, `n=${n}, tour ${round.round} : le repos doit être nommé`).not.toBeNull();
        if (rest) {
          expect(occupants, `n=${n} : le repos ne combat pas`).not.toContain(rest);
          repos.push(rest);
        }
      }
      // Le repos est réparti PAR CONSTRUCTION : chacun se repose une fois, pas
      // « à peu près une fois ».
      expect([...repos].sort(), `n=${n} : répartition du repos`).toEqual(
        [...(pool.competitorIds as string[])].sort(),
      );
    }
  });
});

// ===================================================================
// Des lignes de combat ORDINAIRES
// ===================================================================

describe("la forme des combats de poule", () => {
  it("est celle d'une ligne de combat ordinaire : division 0, index = ordre de passage", () => {
    const pool = poolOf(6);
    expect(pool.fights.map((f) => f.division)).toEqual(new Array(15).fill(0));
    expect(pool.fights.map((f) => f.type)).toEqual(new Array(15).fill("BraketFight"));
    expect(pool.fights.map((f) => f.indexInDivision)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
    ]);
  });

  it("n'a jamais de bye ni d'emplacement vide : tout le monde combat tout le monde", () => {
    for (const n of TAILLES) {
      const pool = poolOf(n);
      expect(
        pool.fights.some((f) => f.isBye),
        `n=${n}`,
      ).toBe(false);
      expect(
        pool.fights.some((f) => f.slotA === null || f.slotB === null),
        `n=${n}`,
      ).toBe(false);
      expect(pool.realFightCount, `n=${n}`).toBe(poolFightCount(n));
    }
  });

  it("range les combats d'un tour de façon contiguë, dans l'ordre des tours", () => {
    const pool = poolOf(7);
    const aplati = pool.rounds.flatMap((r) => [...r.fightIndexes]);
    expect(aplati).toEqual(pool.fights.map((f) => f.indexInDivision));
  });
});

// ===================================================================
// LA PASSE D'AJUSTEMENT, et les deux tailles où elle ne peut rien
// ===================================================================

describe("l'enchaînement à la charnière entre deux tours", () => {
  it("est nul pour tout n >= 5, jusqu'à 24", () => {
    for (let n = 5; n <= 24; n++) {
      const pool = poolOf(n, `graine-${n}`);
      expect(backToBackIndexes(pool.fights), `n=${n} : quelqu'un enchaîne`).toEqual([]);
      expect(pool.warnings, `n=${n} : rien à signaler, donc pas de clé`).toBeUndefined();
    }
  });

  it("est nul à n = 5, alors que le cercle brut en produit deux : la passe SERT", () => {
    // n = 5 est le cas qui distingue « la méthode du cercle suffit » de « la
    // passe d'ajustement fait quelque chose ». Sans elle, deux enchaînements.
    const pool = poolOf(5);
    expect(backToBackIndexes(pool.fights)).toEqual([]);
  });

  it("est structurellement IMPOSSIBLE à n = 3 et n = 4, et c'est démontré ici", () => {
    // Recherche exhaustive sur TOUS les ordres possibles, sans même imposer la
    // structure en tours. Aucun n'évite l'enchaînement.
    expect(unOrdreSansEnchainementExiste(3), "n=3").toBe(false);
    expect(unOrdreSansEnchainementExiste(4), "n=4").toBe(false);
    // Et dès 5, il en existe un — la borne est donc exactement {3, 4}.
    expect(unOrdreSansEnchainementExiste(5), "n=5").toBe(true);
    expect(unOrdreSansEnchainementExiste(6), "n=6").toBe(true);
    expect([...POOL_SIZES_WITHOUT_REST]).toEqual([3, 4]);
  });

  it("est RAPPORTÉ à n = 3 et n = 4, jamais masqué", () => {
    for (const n of [3, 4]) {
      const pool = poolOf(n);
      const reels = backToBackIndexes(pool.fights);
      expect(pool.warnings, `n=${n} : le compte-rendu manque`).toEqual([
        {
          code: "back-to-back-unavoidable",
          competitorCount: n,
          occurrences: reels.length,
          fightIndexes: reels,
        },
      ]);
      // Le minimum démontré : la plus longue suite sans enchaînement vaut 1 à
      // n = 3 (donc 2 enchaînements sur 3 combats) et 2 à n = 4 (donc 2 sur 6).
      expect(reels.length, `n=${n}`).toBe(2);
    }
  });

  it("ne signale rien quand il n'y a rien à signaler (n = 2)", () => {
    const pool = poolOf(2);
    expect(pool.fights).toHaveLength(1);
    expect(pool.warnings).toBeUndefined();
  });
});

// ===================================================================
// Déterminisme
// ===================================================================

describe("le tirage de l'ordre de poule", () => {
  it("rejoue à l'identique pour la même graine", () => {
    const a = generatePool(entries(6), "championnat-2026:cat-42", { maxSize: 8 });
    const b = generatePool(entries(6), "championnat-2026:cat-42", { maxSize: 8 });
    expect(a).toEqual(b);
  });

  it("change avec la graine : il tire vraiment, il ne recopie pas l'ordre d'inscription", () => {
    const a = poolOf(6, "graine-A");
    const b = poolOf(6, "graine-B");
    expect(a.competitorIds).not.toEqual(b.competitorIds);
  });

  it("ne rend pas l'ordre d'inscription tel quel", () => {
    // Un `shuffle` remplacé par l'identité passerait tous les tests
    // structurels : celui-ci est le seul à le voir.
    const ordres = ["s1", "s2", "s3", "s4"].map((s) => poolOf(8, s).competitorIds.join(","));
    const identite = entries(8)
      .map((e) => e.registrationId)
      .join(",");
    expect(ordres.every((o) => o === identite)).toBe(false);
  });
});

// ===================================================================
// LE PLAFOND, côté moteur
// ===================================================================

describe("le plafond de taille", () => {
  it("vaut 6 par défaut : 15 combats, soit la charge d'un arbre de 16", () => {
    expect(MAX_POOL_SIZE_DEFAULT).toBe(6);
    expect(poolFightCount(6)).toBe(15);
  });

  it("chiffre l'explosion combinatoire qu'il évite", () => {
    expect([6, 8, 12, 16].map(poolFightCount)).toEqual([15, 28, 66, 120]);
  });

  it("fait LEVER le moteur au-delà : un appelant direct n'obtient pas 190 combats en silence", () => {
    expect(() => generatePool(entries(7), "g")).toThrow(PoolTooLargeError);
    expect(() => generatePool(entries(20), "g", { maxSize: 6 })).toThrow(/20 inscrits/);
  });

  it("accepte exactement le plafond, et refuse le suivant", () => {
    expect(generatePool(entries(6), "g").kind).toBe("pool");
    expect(() => generatePool(entries(7), "g")).toThrow(PoolTooLargeError);
  });
});

// ===================================================================
// Les bords
// ===================================================================

describe("les catégories dégénérées", () => {
  it("rend `empty` à zéro inscrit et `single` à un, comme l'arbre", () => {
    expect(generatePool([], "g")).toEqual({ kind: "empty" });
    expect(generatePool(entries(1), "g")).toEqual({ kind: "single", registrationId: "r1" });
  });

  it("ne fait pas jouer le plafond sur un inscrit unique", () => {
    // Une catégorie d'un seul inscrit n'est pas un repli de format : il n'y a
    // pas de tirage du tout.
    expect(generatePool(entries(1), "g", { maxSize: 0 }).kind).toBe("single");
  });
});

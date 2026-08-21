import { describe, expect, it } from "vitest";
import {
  DEFAULT_TIE_BREAK_ORDER,
  explainTieBreaks,
  PoolRankingError,
  rankPool,
  type PoolBout,
  type PoolRankingOptions,
} from "../src/pool-ranking";

// ===================================================================
// Outils de lecture
// ===================================================================

function bout(
  a: string,
  b: string,
  winner: string | null,
  extra: Partial<Omit<PoolBout, "a" | "b" | "winner">> = {},
): PoolBout {
  return {
    a,
    b,
    winner,
    pointsA: 0,
    pointsB: 0,
    submission: false,
    penaltiesA: 0,
    penaltiesB: 0,
    ...extra,
  };
}

const OPTS: PoolRankingOptions = { seed: "championnat-2026", categoryId: "cat-42" };

function ordre(ids: readonly string[], bouts: readonly PoolBout[], opts = OPTS): string[] {
  return rankPool(ids, bouts, opts).standings.map((s) => s.registrationId);
}

// ===================================================================
// Le classement de base
// ===================================================================

describe("le classement d'une poule complète", () => {
  const ids = ["A", "B", "C", "D"];
  const bouts = [
    bout("A", "B", "A"),
    bout("A", "C", "A"),
    bout("A", "D", "A"),
    bout("B", "C", "B"),
    bout("B", "D", "B"),
    bout("C", "D", "C"),
  ];

  it("classe par victoires, sans avoir besoin d'un seul départage", () => {
    const r = rankPool(ids, bouts, OPTS);
    expect(r.standings.map((s) => [s.registrationId, s.rank, s.wins])).toEqual([
      ["A", 1, 3],
      ["B", 2, 2],
      ["C", 3, 1],
      ["D", 4, 0],
    ]);
    expect(r.tieBreakApplied, "aucun ex æquo : le tuple ne doit pas s'ouvrir").toEqual([]);
  });

  it("rend un podium quand, et seulement quand, la poule est complète", () => {
    const r = rankPool(ids, bouts, OPTS);
    expect(r.complete).toBe(true);
    expect(r.podium).toEqual({ gold: "A", silver: "B", bronze: "C" });
  });

  it("compte les agrégats de chacun", () => {
    const marque = [
      bout("A", "B", "A", { pointsA: 6, pointsB: 2, submission: true, penaltiesB: 1 }),
      bout("A", "C", "C", { pointsA: 0, pointsB: 4, penaltiesA: 2 }),
      bout("B", "C", null, { pointsA: 1, pointsB: 1 }),
    ];
    const r = rankPool(["A", "B", "C"], marque, OPTS);
    const a = r.standings.find((s) => s.registrationId === "A");
    expect(a).toMatchObject({
      bouts: 2,
      wins: 1,
      losses: 1,
      noContest: 0,
      pointsFor: 6,
      pointsAgainst: 6,
      pointDifferential: 0,
      submissions: 1,
      penalties: 2,
    });
    const b = r.standings.find((s) => s.registrationId === "B");
    expect(b).toMatchObject({ bouts: 2, wins: 0, losses: 1, noContest: 1, penalties: 1 });
  });
});

// ===================================================================
// LA CONFRONTATION DIRECTE : une mini-table, restreinte au sous-ensemble
// ===================================================================

describe("la confrontation directe", () => {
  // A et B sont à deux victoires. B a battu A, mais A a un bien meilleur écart
  // de points. C'est ce contraste qui rend la restriction MESURABLE : évaluée
  // sur toute la poule, la confrontation directe ne séparerait rien (les deux
  // ont le même nombre de victoires, par définition du groupe), on tomberait
  // sur l'écart de points, et A passerait devant B.
  const ids = ["A", "B", "C", "D"];
  const bouts = [
    bout("A", "B", "B", { pointsA: 0, pointsB: 2 }),
    bout("A", "C", "A", { pointsA: 20, pointsB: 0 }),
    bout("A", "D", "A", { pointsA: 20, pointsB: 0 }),
    bout("B", "C", "B", { pointsA: 2, pointsB: 0 }),
    bout("B", "D", "D", { pointsA: 0, pointsB: 2 }),
    bout("C", "D", "C", { pointsA: 2, pointsB: 0 }),
  ];

  it("tranche sur la MINI-TABLE du sous-ensemble, et non sur la poule entière", () => {
    expect(ordre(ids, bouts)).toEqual(["B", "A", "C", "D"]);
    const r = rankPool(ids, bouts, OPTS);
    expect(r.standings.slice(0, 2).map((s) => [s.registrationId, s.wins])).toEqual([
      ["B", 2],
      ["A", 2],
    ]);
    // Et l'écart de points, qui aurait dit l'inverse, n'a jamais été consulté.
    expect(r.tieBreakApplied.map((t) => t.criterion)).toEqual(["head-to-head", "head-to-head"]);
  });

  it("laisse dans la trace le sous-ensemble sur lequel elle a été évaluée", () => {
    const r = rankPool(ids, bouts, OPTS);
    expect(r.tieBreakApplied).toEqual([
      { criterion: "head-to-head", registrationIds: ["A", "B"], separated: true },
      { criterion: "head-to-head", registrationIds: ["C", "D"], separated: true },
    ]);
  });
});

// ===================================================================
// LE CYCLE : trois ex æquo qui ne s'ordonnent pas, et AUCUNE BOUCLE
// ===================================================================

describe("le cycle de confrontation directe", () => {
  // A bat B, B bat C, C bat A : trois à deux victoires, et un ordre qui
  // n'existe pas. Ce n'est pas une anomalie de saisie, c'est un résultat
  // normal d'une poule de quatre.
  const ids = ["A", "B", "C", "D"];
  const bouts = [
    bout("A", "B", "A", { pointsA: 10, pointsB: 0 }),
    bout("B", "C", "B", { pointsA: 2, pointsB: 0 }),
    bout("C", "A", "C", { pointsA: 2, pointsB: 0 }),
    bout("A", "D", "A", { pointsA: 5, pointsB: 0 }),
    bout("B", "D", "B", { pointsA: 5, pointsB: 0 }),
    bout("C", "D", "C", { pointsA: 20, pointsB: 0 }),
  ];

  it("ne sépare pas, PASSE au critère suivant, et rend un classement total", () => {
    const r = rankPool(ids, bouts, OPTS);
    // Écarts : C +20, A +13, B -3.
    expect(r.standings.map((s) => s.registrationId)).toEqual(["C", "A", "B", "D"]);
    expect(r.podium).toEqual({ gold: "C", silver: "A", bronze: "B" });
  });

  it("essaie la confrontation directe UNE FOIS, échoue, et n'y revient pas", () => {
    const r = rankPool(ids, bouts, OPTS);
    // Deux entrées, pas trois, pas trente : la trace EST la preuve de
    // terminaison observable. Un critère rejoué sur le même groupe s'y verrait.
    expect(r.tieBreakApplied).toEqual([
      { criterion: "head-to-head", registrationIds: ["A", "B", "C"], separated: false },
      { criterion: "point-differential", registrationIds: ["A", "B", "C"], separated: true },
    ]);
  });

  it("s'explique en français, tentatives infructueuses comprises", () => {
    const r = rankPool(ids, bouts, OPTS);
    expect(explainTieBreaks(r.tieBreakApplied)).toEqual([
      "A, B, C : confrontation directe n'a pas séparé",
      "A, B, C : écart de points a séparé",
    ]);
  });
});

// ===================================================================
// Le tuple se REJOUE depuis le début sur un sous-ensemble réduit
// ===================================================================

describe("le départage sur un sous-ensemble réduit", () => {
  // Trois à une victoire, en cycle, à zéro point partout : seule la soumission
  // sépare A. Restent B et C, sur qui la confrontation directe — qui cyclait à
  // trois — tranche parfaitement à deux.
  const ids = ["A", "B", "C"];
  const bouts = [
    bout("A", "B", "A", { submission: true }),
    bout("B", "C", "B"),
    bout("C", "A", "C"),
  ];

  it("rejoue la confrontation directe sur le duo qui reste, et elle tranche", () => {
    const r = rankPool(ids, bouts, OPTS);
    expect(r.standings.map((s) => s.registrationId)).toEqual(["A", "B", "C"]);
    expect(r.tieBreakApplied).toEqual([
      { criterion: "head-to-head", registrationIds: ["A", "B", "C"], separated: false },
      { criterion: "point-differential", registrationIds: ["A", "B", "C"], separated: false },
      { criterion: "points-scored", registrationIds: ["A", "B", "C"], separated: false },
      { criterion: "submissions", registrationIds: ["A", "B", "C"], separated: true },
      { criterion: "head-to-head", registrationIds: ["B", "C"], separated: true },
    ]);
  });
});

// ===================================================================
// Les critères de queue de tuple
// ===================================================================

describe("les derniers critères du tuple", () => {
  it("classe devant celui qui a MOINS de pénalités", () => {
    const bouts = [bout("A", "B", null, { penaltiesA: 3, penaltiesB: 1 })];
    const r = rankPool(["A", "B"], bouts, OPTS);
    expect(r.standings.map((s) => [s.registrationId, s.penalties])).toEqual([
      ["B", 1],
      ["A", 3],
    ]);
    expect(r.tieBreakApplied.at(-1)).toEqual({
      criterion: "penalties",
      registrationIds: ["A", "B"],
      separated: true,
    });
  });

  it("garde l'ordre du tuple par défaut, écrit une fois et pas six", () => {
    expect(DEFAULT_TIE_BREAK_ORDER).toEqual([
      "head-to-head",
      "point-differential",
      "points-scored",
      "submissions",
      "penalties",
      "draw",
    ]);
  });

  it("respecte un ordre fourni par l'appelant, jusqu'à renverser le podium", () => {
    // Double forfait : personne n'a de victoire, le tuple s'ouvre donc tout de
    // suite. A mène 9 à 1 mais collectionne les pénalités. Deux ordres, deux
    // podiums opposés — c'est la seule preuve que l'ordre est LU.
    const ids = ["A", "B"];
    const bouts = [bout("A", "B", null, { pointsA: 9, pointsB: 1, penaltiesA: 5, penaltiesB: 0 })];
    expect(ordre(ids, bouts), "défaut : l'écart de points passe avant les pénalités").toEqual([
      "A",
      "B",
    ]);
    expect(
      ordre(ids, bouts, { ...OPTS, order: ["penalties", "point-differential"] }),
      "pénalités d'abord : le podium s'inverse",
    ).toEqual(["B", "A"]);
  });

  it("ne laisse pas le tuple s'ouvrir tant que les victoires séparent", () => {
    // Les victoires ne sont pas un départage : elles le précèdent. B gagne, A
    // mène aux points — et aucun critère du tuple n'est consulté.
    const r = rankPool(["A", "B"], [bout("A", "B", "B", { pointsA: 9, pointsB: 1 })], OPTS);
    expect(r.standings.map((s) => s.registrationId)).toEqual(["B", "A"]);
    expect(r.tieBreakApplied).toEqual([]);
  });
});

// ===================================================================
// LE TIRAGE AU SORT : déterministe, auditable, et jamais Math.random
// ===================================================================

describe("le tirage au sort", () => {
  /** Deux compétiteurs rigoureusement indiscernables : seul le tirage peut trancher. */
  const jumeaux = (categoryId: string) =>
    rankPool(["A", "B"], [bout("A", "B", null)], { ...OPTS, categoryId });

  it("est le dernier recours, et il est atteint", () => {
    const r = jumeaux("cat-1");
    expect(r.tieBreakApplied.map((t) => t.criterion)).toEqual([
      "head-to-head",
      "point-differential",
      "points-scored",
      "submissions",
      "penalties",
      "draw",
    ]);
    expect(r.tieBreakApplied.at(-1)?.separated).toBe(true);
    expect(r.standings.map((s) => s.rank)).toEqual([1, 2]);
  });

  it("rejoue à l'identique sur DOUZE catégories : une source non déterministe s'y voit", () => {
    // Douze tirages indépendants : la probabilité qu'un `Math.random()` rende
    // deux fois la même série est de 2^-12. Un test à un seul tirage serait
    // instable dans les deux sens.
    const cats = Array.from({ length: 12 }, (_, i) => `cat-${i}`);
    const passe1 = cats.map((c) => jumeaux(c).standings[0]?.registrationId);
    const passe2 = cats.map((c) => jumeaux(c).standings[0]?.registrationId);
    expect(passe1).toEqual(passe2);
  });

  it("dépend vraiment de la graine : douze catégories ne rendent pas toutes le même premier", () => {
    const cats = Array.from({ length: 12 }, (_, i) => `cat-${i}`);
    const premiers = new Set(cats.map((c) => jumeaux(c).standings[0]?.registrationId));
    expect(premiers.size, "un tirage constant n'est pas un tirage").toBe(2);
  });

  it("ne dépend PAS de l'ordre d'arrivée des lignes", () => {
    // La graine canonise l'ENSEMBLE des identifiants. Deux lectures de la base
    // qui rendraient les lignes dans un ordre différent doivent produire le
    // même 2e — sans quoi le podium dépendrait du plan d'exécution SQL.
    for (const c of ["cat-1", "cat-2", "cat-3", "cat-4"]) {
      const droit = rankPool(["A", "B"], [bout("A", "B", null)], { ...OPTS, categoryId: c });
      const inverse = rankPool(["B", "A"], [bout("B", "A", null)], { ...OPTS, categoryId: c });
      expect(inverse.standings.map((s) => s.registrationId)).toEqual(
        droit.standings.map((s) => s.registrationId),
      );
    }
  });

  it("est ajouté d'office si l'appelant l'a omis : un classement doit être TOTAL", () => {
    const r = rankPool(["A", "B"], [bout("A", "B", null)], {
      ...OPTS,
      order: ["point-differential"],
    });
    expect(r.tieBreakApplied.map((t) => t.criterion)).toEqual(["point-differential", "draw"]);
    expect(r.standings.map((s) => s.rank)).toEqual([1, 2]);
  });
});

// ===================================================================
// UNE POULE INCOMPLÈTE N'A PAS DE CLASSEMENT VALIDE
// ===================================================================

describe("la poule incomplète", () => {
  const ids = ["A", "B", "C"];
  const partielle = [bout("A", "B", "A"), bout("B", "C", "B")];

  it("refuse le podium, et dit ce qui manque", () => {
    const r = rankPool(ids, partielle, OPTS);
    expect(r.complete).toBe(false);
    expect(r.podium, "un podium ne se grave qu'une fois").toBeNull();
    expect(r.missingPairs).toEqual([["A", "C"]]);
  });

  it("rend tout de même un classement PROVISOIRE, pour l'écran opérateur", () => {
    const r = rankPool(ids, partielle, OPTS);
    expect(r.standings.map((s) => s.registrationId)).toHaveLength(3);
    expect(r.standings.map((s) => s.rank)).toEqual([1, 2, 3]);
  });

  it("bascule à complet dès le dernier combat, et le podium apparaît", () => {
    const r = rankPool(ids, [...partielle, bout("A", "C", "A")], OPTS);
    expect(r.complete).toBe(true);
    expect(r.missingPairs).toEqual([]);
    expect(r.podium).toEqual({ gold: "A", silver: "B", bronze: "C" });
  });

  it("compte une poule d'un seul inscrit comme complète, avec un podium tronqué", () => {
    const r = rankPool(["A"], [], OPTS);
    expect(r.complete).toBe(true);
    expect(r.podium).toEqual({ gold: "A", silver: null, bronze: null });
  });

  it("ne rend pas de bronze à deux inscrits", () => {
    const r = rankPool(["A", "B"], [bout("A", "B", "A")], OPTS);
    expect(r.podium).toEqual({ gold: "A", silver: "B", bronze: null });
  });
});

// ===================================================================
// Refuser une saisie incohérente plutôt que de la classer
// ===================================================================

describe("la validation des combats", () => {
  it("refuse un combat contre soi-même", () => {
    expect(() => rankPool(["A"], [bout("A", "A", "A")], OPTS)).toThrow(PoolRankingError);
  });

  it("refuse un combattant hors de la poule", () => {
    expect(() => rankPool(["A", "B"], [bout("A", "Z", "A")], OPTS)).toThrow(/hors de la poule/);
  });

  it("refuse un vainqueur qui n'a pas disputé le combat", () => {
    expect(() => rankPool(["A", "B", "C"], [bout("A", "B", "C")], OPTS)).toThrow(/n'a pas disputé/);
  });

  it("refuse une paire enregistrée deux fois", () => {
    expect(() => rankPool(["A", "B"], [bout("A", "B", "A"), bout("B", "A", "B")], OPTS)).toThrow(
      /deux fois/,
    );
  });

  it("refuse un compétiteur listé deux fois", () => {
    expect(() => rankPool(["A", "A"], [], OPTS)).toThrow(/listé deux fois/);
  });
});

import { describe, expect, it } from "vitest";
import { ALL_BELTS, BELT_RANK_ORDER, KIDS_BELTS } from "../src/belts";
import { AGE_GROUPS, isChildAgeGroup } from "../src/referential";
import {
  ceintureSuperieureALaCible,
  contributionDUnResultat,
  DERNIERE_SAISON_MASTERS_REGROUPES,
  ECHELLE_CEINTURES_ADULTE,
  ECHELLE_CEINTURES_ENFANT,
  evaluerUnResultat,
  GROUPES_MASTER_REGROUPES,
  GROUPES_MASTER_SEPARES,
  groupesMasterDeLaSaison,
  ordonnerPourTableau,
  partDAge,
  partDeCeinture,
  partDeSaison,
  scoreDePlacement,
  TRANCHES_ENFANTS_DE_PROFIL,
  type CibleDePlacement,
  type ResultatPourPlacement,
  type ScoreDePlacement,
} from "../src/score-de-placement";

const CIBLE: CibleDePlacement = {
  saisonCourante: "2026-27",
  discipline: "gi",
  gender: "male",
  tranche: "Adulte",
  belt: "black",
};

function resultat(p: Partial<ResultatPourPlacement> = {}): ResultatPourPlacement {
  return {
    resultId: "r1",
    licenseeId: "l1",
    competitionId: "c1",
    saisonSportive: "2026-27",
    discipline: "gi",
    gender: "male",
    tranche: "Adulte",
    belt: "black",
    isAbsolut: false,
    place: 1,
    niveau: "national",
    pointsCentiemes: 3600,
    ...p,
  };
}

function score(licenseeId: string, p: Partial<ScoreDePlacement> = {}): ScoreDePlacement {
  return {
    licenseeId,
    generalCentiemes: 0,
    absolutCentiemes: 0,
    directCentiemes: 0,
    nationalCentiemes: 0,
    majeureCentiemes: 0,
    ors: 0,
    argents: 0,
    bronzes: 0,
    contributions: [],
    ecartes: [],
    ...p,
  };
}

describe("parts de saison (guide §3)", () => {
  it("rend 100 / 50 / 25 % puis plus rien", () => {
    expect(partDeSaison("2026-27", "2026-27")).toBe(10000);
    expect(partDeSaison("2025-26", "2026-27")).toBe(5000);
    expect(partDeSaison("2024-25", "2026-27")).toBe(2500);
    expect(partDeSaison("2023-24", "2026-27")).toBe(0);
  });

  it("ignore une saison postérieure à la cible et un libellé invalide", () => {
    expect(partDeSaison("2027-28", "2026-27")).toBe(0);
    expect(partDeSaison("2026-28", "2026-27")).toBe(0);
    expect(partDeSaison(null, "2026-27")).toBe(0);
  });
});

describe("transferts d'âge (guide §4)", () => {
  it("reproduit le tableau des Masters du §4.2, saisons à Masters séparés", () => {
    expect(partDAge("Master 2", "Master 1")).toBe(5000);
    expect(partDAge("Master 3", "Master 1")).toBe(2500);
    expect(partDAge("Master 5+", "Master 1")).toBe(625);
    expect(partDAge("Master 1", "Master 3")).toBe(10000);
  });

  it("applique le §4.1", () => {
    expect(partDAge("Adulte", "Adulte")).toBe(10000);
    expect(partDAge("Adulte", "Master 4")).toBe(10000);
    expect(partDAge("Master 1", "Adulte")).toBe(0);
  });

  it("applique le §4.3 sans cascade", () => {
    expect(partDAge("Juvénile", "Adulte")).toBe(5000);
    expect(partDAge("U15", "Juvénile")).toBe(5000);
    expect(partDAge("U15", "Adulte")).toBe(0);
    expect(partDAge("U13", "Adulte")).toBe(0);
    expect(partDAge("Adulte", "Juvénile")).toBe(0);
  });
});

describe("Masters regroupés, BR3.7 option A", () => {
  it("fait couvrir par un Master regroupé chacune de ses tranches à 100 %", () => {
    expect(partDAge("Master 1/2", "Master 1")).toBe(10000);
    expect(partDAge("Master 1/2", "Master 2")).toBe(10000);
    expect(partDAge("Master 3/4", "Master 3")).toBe(10000);
    expect(partDAge("Master 3/4", "Master 4")).toBe(10000);
  });

  it("ne compte le groupe que comme un seul niveau quand il faut remonter", () => {
    expect(partDAge("Master 3/4", "Master 1")).toBe(5000);
    expect(partDAge("Master 3/4", "Master 2")).toBe(5000);
  });

  it("garde 100 % vers un Master plus âgé", () => {
    expect(partDAge("Master 1/2", "Master 3")).toBe(10000);
    expect(partDAge("Master 1/2", "Master 5+")).toBe(10000);
    expect(partDAge("Master 3/4", "Master 5+")).toBe(10000);
  });

  it("compte Master 5+ d'une saison regroupée comme un seul niveau au-dessus de 3/4", () => {
    expect(partDAge("Master 5+", "Master 3", GROUPES_MASTER_REGROUPES)).toBe(5000);
    expect(partDAge("Master 5+", "Master 4", GROUPES_MASTER_REGROUPES)).toBe(5000);
    expect(partDAge("Master 5+", "Master 1", GROUPES_MASTER_REGROUPES)).toBe(2500);
    expect(partDAge("Master 5+", "Master 2", GROUPES_MASTER_REGROUPES)).toBe(2500);
  });

  it("choisit l'échelle de la saison du résultat", () => {
    expect(groupesMasterDeLaSaison("2024-25")).toBe(GROUPES_MASTER_REGROUPES);
    expect(groupesMasterDeLaSaison(DERNIERE_SAISON_MASTERS_REGROUPES)).toBe(
      GROUPES_MASTER_REGROUPES,
    );
    expect(groupesMasterDeLaSaison("2026-27")).toBe(GROUPES_MASTER_SEPARES);
    expect(groupesMasterDeLaSaison(null)).toBe(GROUPES_MASTER_SEPARES);
  });

  it("applique l'échelle de la saison du résultat au calcul d'une contribution", () => {
    const vers: CibleDePlacement = { ...CIBLE, tranche: "Master 1" };
    const depuis2025 = contributionDUnResultat(
      resultat({ tranche: "Master 5+", saisonSportive: "2025-26" }),
      vers,
    );
    expect(depuis2025?.partAge).toBe(2500);
    expect(depuis2025?.contributionCentiemes).toBe(450);

    const depuis2026 = contributionDUnResultat(
      resultat({ tranche: "Master 5+", saisonSportive: "2026-27" }),
      vers,
    );
    expect(depuis2026?.partAge).toBe(625);
    expect(depuis2026?.contributionCentiemes).toBe(225);
  });
});

describe("transferts de ceinture (guide §5)", () => {
  it("rend 100 / 50 / 0 pour un tableau ceinture noire", () => {
    expect(partDeCeinture("black", "black")).toBe(10000);
    expect(partDeCeinture("brown", "black")).toBe(5000);
    expect(partDeCeinture("purple", "black")).toBe(0);
    expect(partDeCeinture("blue", "black")).toBe(0);
  });

  it("compte un grade au-dessus de la noire comme une noire", () => {
    expect(partDeCeinture("coral", "black", "Master 1")).toBe(10000);
    expect(partDeCeinture("red", "black", "Master 5+")).toBe(10000);
  });

  it("rend 50 % de la blanche vers la bleue, ce que l'échelle continue refusait", () => {
    expect(partDeCeinture("white", "blue", "Adulte")).toBe(5000);
    expect(partDeCeinture("white", "blue", "Juvénile")).toBe(5000);
    expect(partDeCeinture("blue", "purple")).toBe(5000);
    expect(partDeCeinture("purple", "brown")).toBe(5000);
    expect(partDeCeinture("white", "purple")).toBe(0);
  });

  it("écarte un résultat obtenu dans une ceinture plus haute que celle du tableau", () => {
    expect(ceintureSuperieureALaCible("black", "brown")).toBe(true);
    expect(partDeCeinture("black", "brown")).toBe(0);
    expect(ceintureSuperieureALaCible("brown", "black")).toBe(false);
    expect(ceintureSuperieureALaCible("black", "black")).toBe(false);
  });
});

describe("raccord des ceintures enfants, BR3.8 option A", () => {
  it("compte toute ceinture enfant comme une blanche vers un tableau Juvénile", () => {
    expect(partDeCeinture("green", "white", "Juvénile")).toBe(10000);
    expect(partDeCeinture("orange", "white", "Juvénile")).toBe(10000);
    expect(partDeCeinture("green", "blue", "Juvénile")).toBe(5000);
    expect(partDeCeinture("grey", "blue", "Juvénile")).toBe(5000);
    expect(partDeCeinture("green", "purple", "Juvénile")).toBe(0);
    expect(partDeCeinture("yellow", "purple", "Juvénile")).toBe(0);
  });

  it("garde l'échelle des enfants pour un tableau enfant", () => {
    expect(partDeCeinture("orange", "orange", "U15")).toBe(10000);
    expect(partDeCeinture("yellow", "orange", "U15")).toBe(5000);
    expect(partDeCeinture("white", "orange", "U15")).toBe(0);
    expect(ceintureSuperieureALaCible("green", "orange", "U15")).toBe(true);
  });

  it("cumule les 50 % du passage U15 vers Juvénile et les 50 % de la ceinture", () => {
    const c = contributionDUnResultat(
      resultat({ tranche: "U15", belt: "green", pointsCentiemes: 3600 }),
      { ...CIBLE, tranche: "Juvénile", belt: "blue" },
    );
    expect(c?.partAge).toBe(5000);
    expect(c?.partCeinture).toBe(5000);
    expect(c?.contributionCentiemes).toBe(900);
  });
});

describe("contribution d'un résultat (guide §5.1)", () => {
  it("National Adulte marron 36 vers Adulte noire vaut 18", () => {
    const c = contributionDUnResultat(resultat({ belt: "brown", pointsCentiemes: 3600 }), CIBLE);
    expect(c?.contributionCentiemes).toBe(1800);
  });

  it("National Juvénile bleue 36 vers Adulte violette vaut 9", () => {
    const c = contributionDUnResultat(
      resultat({ tranche: "Juvénile", belt: "blue", pointsCentiemes: 3600 }),
      { ...CIBLE, belt: "purple" },
    );
    expect(c?.contributionCentiemes).toBe(900);
  });

  it("le même résultat en saison N-1 vaut 4,5", () => {
    const c = contributionDUnResultat(
      resultat({
        tranche: "Juvénile",
        belt: "blue",
        pointsCentiemes: 3600,
        saisonSportive: "2025-26",
      }),
      { ...CIBLE, belt: "purple" },
    );
    expect(c?.contributionCentiemes).toBe(450);
  });

  it("écarte un résultat d'une autre discipline ou d'un autre sexe", () => {
    expect(contributionDUnResultat(resultat({ discipline: "nogi" }), CIBLE)).toBeNull();
    expect(contributionDUnResultat(resultat({ gender: "female" }), CIBLE)).toBeNull();
  });

  it("distingue une incompatibilité ordinaire d'un résultat à signaler", () => {
    expect(evaluerUnResultat(resultat({ belt: "purple" }), CIBLE)).toEqual({
      retenu: false,
      motif: null,
    });
    expect(evaluerUnResultat(resultat({ belt: "black" }), { ...CIBLE, belt: "brown" })).toEqual({
      retenu: false,
      motif: "ceinture_superieure",
    });
  });
});

describe("score de placement (guide §3.3)", () => {
  it("36 sur trois saisons donnent 63", () => {
    const s = scoreDePlacement(
      "l1",
      [
        resultat({ resultId: "a", saisonSportive: "2026-27" }),
        resultat({ resultId: "b", saisonSportive: "2025-26" }),
        resultat({ resultId: "c", saisonSportive: "2024-25" }),
      ],
      CIBLE,
    );
    expect(s.generalCentiemes).toBe(6300);
    expect(s.contributions.map((c) => c.contributionCentiemes)).toEqual([3600, 1800, 900]);
  });

  it("n'additionne pas l'Absolut au général, il en fait partie", () => {
    const s = scoreDePlacement(
      "l1",
      [
        resultat({ resultId: "a", pointsCentiemes: 3600 }),
        resultat({ resultId: "b", pointsCentiemes: 5400, isAbsolut: true }),
      ],
      CIBLE,
    );
    expect(s.generalCentiemes).toBe(9000);
    expect(s.absolutCentiemes).toBe(5400);
  });

  it("ne compte en direct que l'âge et la ceinture exacts du tableau", () => {
    const s = scoreDePlacement(
      "l1",
      [
        resultat({ resultId: "a", pointsCentiemes: 3600 }),
        resultat({ resultId: "b", belt: "brown", pointsCentiemes: 3600 }),
      ],
      CIBLE,
    );
    expect(s.generalCentiemes).toBe(5400);
    expect(s.directCentiemes).toBe(3600);
  });

  it("arrondit le score, pas chaque contribution (guide §3.2)", () => {
    const bronze = (resultId: string): ResultatPourPlacement =>
      resultat({
        resultId,
        belt: "brown",
        place: 3,
        niveau: "open",
        pointsCentiemes: 100,
        saisonSportive: "2024-25",
      });
    const s = scoreDePlacement("l1", [bronze("a"), bronze("b"), bronze("c")], CIBLE);
    expect(s.contributions.map((c) => c.contributionExacte)).toEqual([12.5, 12.5, 12.5]);
    expect(s.contributions.map((c) => c.contributionCentiemes)).toEqual([13, 13, 13]);
    expect(s.generalCentiemes).toBe(38);
  });

  it("relève les agrégats du §2.2 sur les résultats qui composent le score", () => {
    const s = scoreDePlacement(
      "l1",
      [
        resultat({ resultId: "a", niveau: "national", place: 1, pointsCentiemes: 3600 }),
        resultat({ resultId: "b", niveau: "majeure", place: 2, pointsCentiemes: 600 }),
        resultat({ resultId: "c", niveau: "open", place: 3, pointsCentiemes: 100 }),
      ],
      CIBLE,
    );
    expect(s.nationalCentiemes).toBe(3600);
    expect(s.majeureCentiemes).toBe(600);
    expect(s.ors).toBe(1);
    expect(s.argents).toBe(1);
    expect(s.bronzes).toBe(1);
  });

  it("ne compte pas comme médaille un résultat sans point (art. 3.4)", () => {
    const s = scoreDePlacement(
      "l1",
      [resultat({ resultId: "a", place: 1, pointsCentiemes: 0 })],
      CIBLE,
    );
    expect(s.ors).toBe(0);
    expect(s.generalCentiemes).toBe(0);
    expect(s.contributions).toHaveLength(1);
  });

  it("signale les résultats obtenus dans une ceinture plus haute que le tableau", () => {
    const s = scoreDePlacement(
      "l1",
      [
        resultat({ resultId: "a", belt: "black" }),
        resultat({ resultId: "b", belt: "blue" }),
        resultat({ resultId: "c", belt: "purple" }),
      ],
      { ...CIBLE, belt: "purple" },
    );
    expect(s.ecartes.map((e) => [e.resultat.resultId, e.motif])).toEqual([
      ["a", "ceinture_superieure"],
    ]);
    expect(s.contributions.map((c) => c.resultat.resultId)).toEqual(["b", "c"]);
  });
});

describe("ordre du tableau (guide §6.1)", () => {
  it("place A puis B puis C, exactement comme l'exemple du guide", () => {
    const rangs = ordonnerPourTableau(
      [
        score("C", { absolutCentiemes: 0, generalCentiemes: 10000 }),
        score("A", { absolutCentiemes: 2000, generalCentiemes: 6000 }),
        score("B", { absolutCentiemes: 2000, generalCentiemes: 4000 }),
      ],
      { absolut: true },
    );
    expect(rangs.map((r) => [r.score.licenseeId, r.rang])).toEqual([
      ["A", 1],
      ["B", 2],
      ["C", 3],
    ]);
  });

  it("départage un tableau de poids par le score direct", () => {
    const rangs = ordonnerPourTableau(
      [
        score("X", { generalCentiemes: 6000, directCentiemes: 1000 }),
        score("Y", { generalCentiemes: 6000, directCentiemes: 4000 }),
      ],
      { absolut: false },
    );
    expect(rangs.map((r) => r.score.licenseeId)).toEqual(["Y", "X"]);
    expect(rangs.map((r) => r.departage)).toEqual(["score", "score"]);
  });
});

describe("départage des ex aequo, BR3.4 option C", () => {
  it("donne un rang distinct à chaque athlète, y compris sans aucun point", () => {
    const rangs = ordonnerPourTableau([score("X"), score("Y"), score("Z")], {
      absolut: false,
      graine: "cat-1",
    });
    expect(rangs.map((r) => r.rang)).toEqual([1, 2, 3]);
    expect(new Set(rangs.map((r) => r.score.licenseeId))).toEqual(new Set(["X", "Y", "Z"]));
    expect(rangs.map((r) => r.departage)).toEqual(["score", "tirage", "tirage"]);
  });

  it("applique les critères du classement national avant tout tirage", () => {
    const rangs = ordonnerPourTableau(
      [
        score("sansRien", { generalCentiemes: 6000 }),
        score("national", { generalCentiemes: 6000, nationalCentiemes: 2000 }),
        score("majeure", { generalCentiemes: 6000, majeureCentiemes: 2000 }),
      ],
      { absolut: false, graine: "cat-1" },
    );
    expect(rangs.map((r) => r.score.licenseeId)).toEqual(["national", "majeure", "sansRien"]);
    expect(rangs.map((r) => r.departage)).toEqual(["score", "criteres", "criteres"]);
  });

  it("descend jusqu'aux médailles d'or, d'argent puis de bronze", () => {
    const base = { generalCentiemes: 6000, nationalCentiemes: 1000 };
    const rangs = ordonnerPourTableau(
      [
        score("bronze", { ...base, bronzes: 1 }),
        score("or", { ...base, ors: 1 }),
        score("argent", { ...base, argents: 1 }),
        score("rien", base),
      ],
      { absolut: false, graine: "cat-1" },
    );
    expect(rangs.map((r) => r.score.licenseeId)).toEqual(["or", "argent", "bronze", "rien"]);
  });

  it("applique la même échelle de départage à un absolut (AB7.6)", () => {
    const rangs = ordonnerPourTableau(
      [
        score("sansRien", { absolutCentiemes: 5400, generalCentiemes: 5400 }),
        score("national", {
          absolutCentiemes: 5400,
          generalCentiemes: 5400,
          nationalCentiemes: 5400,
        }),
      ],
      { absolut: true, graine: "abs-1" },
    );
    expect(rangs.map((r) => r.score.licenseeId)).toEqual(["national", "sansRien"]);
    expect(rangs[1]?.departage).toBe("criteres");
  });

  it("rejoue le même tirage à graine égale et ignore l'ordre de lecture", () => {
    const athletes = [score("X"), score("Y"), score("Z"), score("W")];
    const attendu = ordonnerPourTableau(athletes, { absolut: false, graine: "cat-7" }).map(
      (r) => r.score.licenseeId,
    );
    expect(
      ordonnerPourTableau(athletes, { absolut: false, graine: "cat-7" }).map(
        (r) => r.score.licenseeId,
      ),
    ).toEqual(attendu);
    expect(
      ordonnerPourTableau([...athletes].reverse(), { absolut: false, graine: "cat-7" }).map(
        (r) => r.score.licenseeId,
      ),
    ).toEqual(attendu);
  });

  it("change de tirage quand la graine du tableau change", () => {
    const athletes = [score("X"), score("Y"), score("Z"), score("W")];
    const a = ordonnerPourTableau(athletes, { absolut: false, graine: "cat-7" }).map(
      (r) => r.score.licenseeId,
    );
    const b = ordonnerPourTableau(athletes, { absolut: false, graine: "cat-8" }).map(
      (r) => r.score.licenseeId,
    );
    expect(a).not.toEqual(b);
  });
});

describe("les échelles de référence ne peuvent pas dériver en silence", () => {
  it("liste exactement les tranches enfants du référentiel", () => {
    expect([...TRANCHES_ENFANTS_DE_PROFIL]).toEqual(AGE_GROUPS.filter(isChildAgeGroup));
  });

  it("réutilise l'échelle enfant du référentiel des ceintures", () => {
    expect(ECHELLE_CEINTURES_ENFANT).toBe(KIDS_BELTS);
  });

  it("garde l'échelle adulte dans l'ordre du référentiel et couvre tous les grades", () => {
    const rangs = ECHELLE_CEINTURES_ADULTE.map((b) => BELT_RANK_ORDER.indexOf(b));
    expect(rangs).toEqual([...rangs].sort((x, y) => x - y));
    expect(rangs.some((r) => r < 0)).toBe(false);
    const couvertes = new Set([...ECHELLE_CEINTURES_ENFANT, ...ECHELLE_CEINTURES_ADULTE]);
    expect(ALL_BELTS.filter((b) => !couvertes.has(b))).toEqual([]);
  });
});

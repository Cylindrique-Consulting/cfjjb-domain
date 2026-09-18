import { describe, expect, it } from "vitest";
import { absolutSeedOrder, type AbsolutRegistration } from "../src/absolut-seeding";
import { ALL_BELTS, BELT_RANK_ORDER, KIDS_BELTS } from "../src/belts";
import { pointsDeResultat, type NiveauDeCompetition } from "../src/points";
import { fnv1a, mulberry32 } from "../src/prng";
import { AGE_GROUPS, isChildAgeGroup } from "../src/referential";
import {
  ceintureSuperieureALaCible,
  contributionDUnResultat,
  DEPARTAGES,
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
  placeDuJourDe,
  scoreDePlacement,
  TRANCHES_ENFANTS_DE_PROFIL,
  type CibleDePlacement,
  type Departage,
  type ParcoursDuJour,
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

const GRAINES = Array.from({ length: 40 }, (_, i) => `absolut-${i}`);

function pointsDUnPodium(place: 1 | 2 | 3, niveau: NiveauDeCompetition): number {
  return pointsDeResultat({ place, absolut: false, niveau, exclusion: null })?.points ?? 0;
}

function podiumDuJour(
  licenseeId: string,
  place: 1 | 2 | 3,
  niveau: NiveauDeCompetition = "open",
): ResultatPourPlacement {
  return resultat({
    resultId: `${licenseeId}-jour`,
    licenseeId,
    competitionId: "competition-du-jour",
    place,
    niveau,
    pointsCentiemes: pointsDUnPodium(place, niveau),
  });
}

function podiumDeLaSaison(
  licenseeId: string,
  place: 1 | 2 | 3,
  niveau: NiveauDeCompetition = "open",
): ResultatPourPlacement {
  return resultat({
    resultId: `${licenseeId}-saison`,
    licenseeId,
    competitionId: "open-de-la-saison",
    place,
    niveau,
    pointsCentiemes: pointsDUnPodium(place, niveau),
  });
}

function clesDeDepartage(s: ScoreDePlacement): number[] {
  return [
    s.absolutCentiemes,
    s.generalCentiemes,
    s.directCentiemes,
    s.nationalCentiemes,
    s.majeureCentiemes,
    s.ors,
    s.argents,
    s.bronzes,
  ];
}

function ordresObtenus(scores: readonly ScoreDePlacement[], absolut = true): Set<string> {
  const ordres = new Set<string>();
  for (const graine of GRAINES) {
    for (const lecture of [scores, [...scores].reverse()]) {
      const rangs = ordonnerPourTableau(lecture, { absolut, graine });
      ordres.add(rangs.map((r) => `${r.score.licenseeId}:${r.departage}`).join(" > "));
    }
  }
  return ordres;
}

describe("absolut : place du jour puis catégorie la plus lourde, AB7.6 option C", () => {
  it("l'exemple du questionnaire : deux champions du jour sans autre résultat, le plus lourd passe devant, sans tirage", () => {
    const leve = scoreDePlacement("champion-leve", [podiumDuJour("champion-leve", 1)], CIBLE, {
      sourcePlace: 1,
      sourceWeightClass: "Leve",
    });
    const pesado = scoreDePlacement(
      "champion-pesado",
      [podiumDuJour("champion-pesado", 1)],
      CIBLE,
      { sourcePlace: 1, sourceWeightClass: "Pesado" },
    );
    expect(clesDeDepartage(leve), "égalité parfaite de score et de critères nationaux").toEqual(
      clesDeDepartage(pesado),
    );
    expect([...ordresObtenus([leve, pesado])]).toEqual([
      "champion-pesado:score > champion-leve:jour",
    ]);
  });

  it("sans les données du jour, la même égalité tombe au tirage, comme en v0.24.0", () => {
    const leve = scoreDePlacement("champion-leve", [podiumDuJour("champion-leve", 1)], CIBLE);
    const pesado = scoreDePlacement("champion-pesado", [podiumDuJour("champion-pesado", 1)], CIBLE);
    expect("jour" in leve, "le score n'invente pas de données du jour").toBe(false);
    expect(ordresObtenus([leve, pesado])).toEqual(
      new Set([
        "champion-pesado:score > champion-leve:tirage",
        "champion-leve:score > champion-pesado:tirage",
      ]),
    );
  });

  it("un or du jour passe devant un argent du jour à égalité de critères, même plus léger", () => {
    const orGalo = scoreDePlacement(
      "or-galo",
      [podiumDuJour("or-galo", 1), podiumDeLaSaison("or-galo", 2)],
      CIBLE,
      { sourcePlace: 1, sourceWeightClass: "Galo" },
    );
    const argentPesadissimo = scoreDePlacement(
      "argent-pesadissimo",
      [podiumDuJour("argent-pesadissimo", 2), podiumDeLaSaison("argent-pesadissimo", 1)],
      CIBLE,
      { sourcePlace: 2, sourceWeightClass: "Pesadissimo" },
    );
    expect(clesDeDepartage(orGalo)).toEqual(clesDeDepartage(argentPesadissimo));
    expect(orGalo.ors).toBe(1);
    expect(orGalo.argents).toBe(1);
    expect([...ordresObtenus([argentPesadissimo, orGalo])]).toEqual([
      "or-galo:score > argent-pesadissimo:jour",
    ]);
  });

  it("une ceinture noire Adulte inscrite sans médaille passe après les médaillés, puis la plus lourde d'abord", () => {
    const bronzeGalo = scoreDePlacement("bronze-galo", [podiumDuJour("bronze-galo", 3)], CIBLE, {
      sourcePlace: 3,
      sourceWeightClass: "Galo",
    });
    const sansPodiumLourd = scoreDePlacement(
      "sans-podium-pesadissimo",
      [podiumDeLaSaison("sans-podium-pesadissimo", 3)],
      CIBLE,
      { sourcePlace: null, sourceWeightClass: "Pesadissimo" },
    );
    const sansPodiumInconnu = scoreDePlacement(
      "sans-podium-inconnu",
      [podiumDeLaSaison("sans-podium-inconnu", 3)],
      CIBLE,
      { sourcePlace: null, sourceWeightClass: null },
    );
    expect(clesDeDepartage(bronzeGalo)).toEqual(clesDeDepartage(sansPodiumLourd));
    expect(clesDeDepartage(bronzeGalo)).toEqual(clesDeDepartage(sansPodiumInconnu));
    expect([...ordresObtenus([sansPodiumInconnu, sansPodiumLourd, bronzeGalo])]).toEqual([
      "bronze-galo:score > sans-podium-pesadissimo:jour > sans-podium-inconnu:jour",
    ]);
  });

  it("des données du jour absentes valent une place absente et une catégorie inconnue", () => {
    const medaille = score("argent-du-jour", {
      jour: placeDuJourDe({ sourcePlace: 2, sourceWeightClass: "Galo" }),
    });
    const sansPodiumInconnu = score("sans-podium-inconnu", {
      jour: placeDuJourDe({ sourcePlace: null, sourceWeightClass: null }),
    });
    const sansDonnees = score("sans-donnees");
    expect(ordresObtenus([sansDonnees, sansPodiumInconnu, medaille])).toEqual(
      new Set([
        "argent-du-jour:score > sans-donnees:jour > sans-podium-inconnu:tirage",
        "argent-du-jour:score > sans-podium-inconnu:jour > sans-donnees:tirage",
      ]),
    );
  });

  it("une égalité complète, même place dans la même catégorie, finit au tirage reproductible", () => {
    const a = scoreDePlacement("bronze-medio-a", [podiumDuJour("bronze-medio-a", 3)], CIBLE, {
      sourcePlace: 3,
      sourceWeightClass: "Medio",
    });
    const b = scoreDePlacement("bronze-medio-b", [podiumDuJour("bronze-medio-b", 3)], CIBLE, {
      sourcePlace: 3,
      sourceWeightClass: "4",
    });
    expect(a.jour).toEqual(b.jour);

    const attendu = ordonnerPourTableau([a, b], { absolut: true, graine: "absolut-medio" });
    expect(attendu.map((r) => r.departage)).toEqual(["score", "tirage"]);
    expect(
      ordonnerPourTableau([b, a], { absolut: true, graine: "absolut-medio" }).map(
        (r) => r.score.licenseeId,
      ),
      "même graine, autre ordre de lecture : même tirage",
    ).toEqual(attendu.map((r) => r.score.licenseeId));
    expect(ordresObtenus([a, b]).size, "d'une graine à l'autre, les deux ordres sortent").toBe(2);
  });

  it("les critères du classement national passent avant la place du jour, le score avant tout", () => {
    const rangs = ordonnerPourTableau(
      [
        score("or-pesadissimo", {
          generalCentiemes: 3600,
          majeureCentiemes: 3600,
          jour: placeDuJourDe({ sourcePlace: 1, sourceWeightClass: "Pesadissimo" }),
        }),
        score("argent-galo-national", {
          generalCentiemes: 3600,
          nationalCentiemes: 3600,
          jour: placeDuJourDe({ sourcePlace: 2, sourceWeightClass: "Galo" }),
        }),
        score("bronze-absolut", {
          absolutCentiemes: 150,
          generalCentiemes: 150,
          jour: placeDuJourDe({ sourcePlace: 3, sourceWeightClass: "Galo" }),
        }),
      ],
      { absolut: true, graine: "absolut-1" },
    );
    expect(rangs.map((r) => [r.score.licenseeId, r.departage])).toEqual([
      ["bronze-absolut", "score"],
      ["argent-galo-national", "score"],
      ["or-pesadissimo", "criteres"],
    ]);
  });

  it("reprend l'ordre du plan de tirage de l'absolut, place source puis catégorie la plus lourde", () => {
    const inscriptions: AbsolutRegistration[] = [
      { registrationId: "leve-2", sourcePlace: 2, sourceWeightClass: "Leve" },
      { registrationId: "pesadissimo-1", sourcePlace: 1, sourceWeightClass: "Pesadissimo" },
      { registrationId: "sans-podium-medio", sourcePlace: null, sourceWeightClass: "Medio" },
      { registrationId: "medio-3", sourcePlace: 3, sourceWeightClass: "4" },
      { registrationId: "pesado-2", sourcePlace: 2, sourceWeightClass: "Pesado" },
      { registrationId: "galo-1", sourcePlace: 1, sourceWeightClass: "Galo" },
      { registrationId: "sans-podium-pena", sourcePlace: null, sourceWeightClass: "Pena" },
      { registrationId: "illisible-1", sourcePlace: 1, sourceWeightClass: "500" },
    ];
    const scores = inscriptions.map((i) => scoreDePlacement(i.registrationId, [], CIBLE, i));
    for (const graine of GRAINES) {
      expect(
        ordonnerPourTableau(scores, { absolut: true, graine }).map((r) => r.score.licenseeId),
      ).toEqual(absolutSeedOrder(inscriptions).map((i) => i.registrationId));
    }
  });

  it("juvéniles : la catégorie la plus lourde se lit sur l'échelle des poids, pas sur le nom de l'absolut", () => {
    const cible: CibleDePlacement = { ...CIBLE, tranche: "Juvénile", belt: "blue" };
    const champion = (id: string, sourceWeightClass: string) =>
      scoreDePlacement(id, [{ ...podiumDuJour(id, 1), tranche: "Juvénile", belt: "blue" }], cible, {
        sourcePlace: 1,
        sourceWeightClass,
      });
    expect([...ordresObtenus([champion("pluma", "Pluma"), champion("leve", "3")])]).toEqual([
      "leve:score > pluma:jour",
    ]);
    expect(
      placeDuJourDe({ sourcePlace: 1, sourceWeightClass: "Absolut Leve" }).sourceWeightRank,
      "le nom de l'absolut n'est pas une catégorie de poids : il vaut une catégorie inconnue",
    ).toBeNull();
  });

  it("catégories de poids : les données du jour ne changent rien, sur 500 populations tirées", () => {
    const aleatoire = mulberry32(fnv1a("non-regression-categories-de-poids"));
    const petit = () => Math.floor(aleatoire() * 3);
    const places = [1, 2, 3, null] as const;
    const poids = ["Galo", "Medio", "Pesadissimo", null] as const;
    for (let population = 0; population < 500; population++) {
      const effectif = 2 + Math.floor(aleatoire() * 7);
      const sans: ScoreDePlacement[] = [];
      const avec: ScoreDePlacement[] = [];
      for (let i = 0; i < effectif; i++) {
        const s = score(`l${i}`, {
          generalCentiemes: petit() * 900,
          directCentiemes: petit() * 900,
          nationalCentiemes: petit() * 3600,
          majeureCentiemes: petit() * 1800,
          ors: petit(),
          argents: petit(),
          bronzes: petit(),
        });
        sans.push(s);
        avec.push({
          ...s,
          jour: placeDuJourDe({
            sourcePlace: places[Math.floor(aleatoire() * places.length)] ?? null,
            sourceWeightClass: poids[Math.floor(aleatoire() * poids.length)] ?? null,
          }),
        });
      }
      const graine = `categorie-${population}`;
      const attendu = ordonnerPourTableau(sans, { absolut: false, graine }).map((r) => [
        r.score.licenseeId,
        r.rang,
        r.departage,
      ]);
      const obtenu = ordonnerPourTableau(avec, { absolut: false, graine }).map((r) => [
        r.score.licenseeId,
        r.rang,
        r.departage,
      ]);
      expect(obtenu).toEqual(attendu);
      expect(obtenu.some(([, , departage]) => departage === "jour")).toBe(false);
    }
  });

  it("l'étage du jour est rangé entre les critères et le tirage", () => {
    expect([...DEPARTAGES]).toEqual(["score", "criteres", "jour", "tirage"]);
  });
});

type EtapeDOrdre =
  | "absolutCentiemes"
  | "generalCentiemes"
  | "directCentiemes"
  | "nationalCentiemes"
  | "majeureCentiemes"
  | "ors"
  | "argents"
  | "bronzes"
  | "placeDuJour"
  | "categorieLaPlusLourde";

type Transition = {
  readonly etape: EtapeDOrdre;
  readonly departage: Departage;
  readonly titre: string;
};

const ORDRE_ABSOLUT: readonly Transition[] = [
  {
    etape: "absolutCentiemes",
    departage: "score",
    titre: "le score Absolut départage avant tout le reste",
  },
  {
    etape: "generalCentiemes",
    departage: "score",
    titre: "à score Absolut égal, le score général départage",
  },
  {
    etape: "directCentiemes",
    departage: "score",
    titre: "à score général égal, le score direct départage",
  },
  {
    etape: "nationalCentiemes",
    departage: "criteres",
    titre: "à scores égaux, les points de Championnat national départagent avant la place du jour",
  },
  {
    etape: "majeureCentiemes",
    departage: "criteres",
    titre: "à points nationaux égaux, les points de Majeures départagent avant la place du jour",
  },
  {
    etape: "ors",
    departage: "criteres",
    titre: "à points égaux, le nombre d'ors départage avant la place du jour",
  },
  {
    etape: "argents",
    departage: "criteres",
    titre: "à ors égaux, le nombre d'argents départage avant la place du jour",
  },
  {
    etape: "bronzes",
    departage: "criteres",
    titre: "à argents égaux, le nombre de bronzes départage avant la place du jour",
  },
  {
    etape: "placeDuJour",
    departage: "jour",
    titre: "à critères nationaux égaux, la place du jour départage avant la catégorie",
  },
  {
    etape: "categorieLaPlusLourde",
    departage: "jour",
    titre: "à place du jour égale, la catégorie la plus lourde départage avant le tirage",
  },
];

const ORDRE_CATEGORIE: readonly Transition[] = [
  {
    etape: "generalCentiemes",
    departage: "score",
    titre: "le score général départage avant tout le reste",
  },
  {
    etape: "directCentiemes",
    departage: "score",
    titre: "à score général égal, le score direct départage",
  },
  {
    etape: "nationalCentiemes",
    departage: "criteres",
    titre: "à scores égaux, les points de Championnat national départagent",
  },
  {
    etape: "majeureCentiemes",
    departage: "criteres",
    titre: "à points nationaux égaux, les points de Majeures départagent",
  },
  {
    etape: "ors",
    departage: "criteres",
    titre: "à points égaux, le nombre d'ors départage",
  },
  {
    etape: "argents",
    departage: "criteres",
    titre: "à ors égaux, le nombre d'argents départage",
  },
  {
    etape: "bronzes",
    departage: "criteres",
    titre: "à argents égaux, le nombre de bronzes départage avant le tirage",
  },
];

const ETAPES_ETRANGERES_A_UNE_CATEGORIE: readonly EtapeDOrdre[] = [
  "absolutCentiemes",
  "placeDuJour",
  "categorieLaPlusLourde",
];

const CLES_DU_DUEL = {
  absolutCentiemes: 1800,
  generalCentiemes: 20000,
  directCentiemes: 9000,
  nationalCentiemes: 3600,
  majeureCentiemes: 1800,
  ors: 1,
  argents: 1,
  bronzes: 1,
};

function scoreAvantage(licenseeId: string, etapes: readonly EtapeDOrdre[]): ScoreDePlacement {
  const cles = { ...CLES_DU_DUEL };
  let sourcePlace = 2;
  let sourceWeightClass = "Medio";
  for (const etape of etapes) {
    if (etape === "placeDuJour") sourcePlace = 1;
    else if (etape === "categorieLaPlusLourde") sourceWeightClass = "Pesadissimo";
    else cles[etape] += etape.endsWith("Centiemes") ? 150 : 1;
  }
  const parcours: ParcoursDuJour = { sourcePlace, sourceWeightClass };
  return score(licenseeId, { ...cles, jour: placeDuJourDe(parcours) });
}

function valeurDEtape(s: ScoreDePlacement, etape: EtapeDOrdre): number {
  if (etape === "placeDuJour") return -(s.jour?.sourcePlace ?? Number.POSITIVE_INFINITY);
  if (etape === "categorieLaPlusLourde")
    return s.jour?.sourceWeightRank ?? Number.NEGATIVE_INFINITY;
  return s[etape];
}

function avantages(
  devant: ScoreDePlacement,
  derriere: ScoreDePlacement,
  etapes: readonly EtapeDOrdre[],
): number[] {
  return etapes.map((etape) =>
    Math.sign(valeurDEtape(devant, etape) - valeurDEtape(derriere, etape)),
  );
}

function duel(
  ordre: readonly Transition[],
  visee: number,
  etrangeres: readonly EtapeDOrdre[] = [],
): { devant: ScoreDePlacement; derriere: ScoreDePlacement } {
  const etapes = ordre.map((t) => t.etape);
  return {
    devant: scoreAvantage("devant", [etapes[visee] as EtapeDOrdre]),
    derriere: scoreAvantage("derriere", [...etapes.slice(visee + 1), ...etrangeres]),
  };
}

describe("ordre de l'absolut : chaque étape départage seule, contre toutes celles qui la suivent", () => {
  const etapes = ORDRE_ABSOLUT.map((t) => t.etape);

  ORDRE_ABSOLUT.forEach((transition, visee) => {
    it(transition.titre, () => {
      const { devant, derriere } = duel(ORDRE_ABSOLUT, visee);
      expect(
        avantages(devant, derriere, etapes),
        "égalité avant l'étape visée, « devant » gagne l'étape, « derriere » gagne toutes les suivantes",
      ).toEqual(etapes.map((_, i) => (i < visee ? 0 : i === visee ? 1 : -1)));
      expect([...ordresObtenus([derriere, devant], true)]).toEqual([
        `devant:score > derriere:${transition.departage}`,
      ]);
    });
  });
});

describe("ordre d'une catégorie de poids : chaque étape départage seule, contre toutes celles qui la suivent", () => {
  const etapes = ORDRE_CATEGORIE.map((t) => t.etape);

  ORDRE_CATEGORIE.forEach((transition, visee) => {
    it(`${transition.titre}, sans égard au score Absolut ni aux données du jour`, () => {
      const { devant, derriere } = duel(ORDRE_CATEGORIE, visee, ETAPES_ETRANGERES_A_UNE_CATEGORIE);
      expect(
        avantages(devant, derriere, etapes),
        "égalité avant l'étape visée, « devant » gagne l'étape, « derriere » gagne toutes les suivantes",
      ).toEqual(etapes.map((_, i) => (i < visee ? 0 : i === visee ? 1 : -1)));
      expect(
        avantages(devant, derriere, ETAPES_ETRANGERES_A_UNE_CATEGORIE),
        "« derriere » a le meilleur score Absolut, la meilleure place du jour et la catégorie la plus lourde",
      ).toEqual([-1, -1, -1]);
      expect([...ordresObtenus([derriere, devant], false)]).toEqual([
        `devant:score > derriere:${transition.departage}`,
      ]);
    });
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

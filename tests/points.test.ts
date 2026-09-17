import { describe, expect, it } from "vitest";
import {
  bornesSaisonSportive,
  centiemesVersNombre,
  coefficientDuNiveau,
  estNiveauDeCompetition,
  exclusionDePoints,
  LIBELLES_NIVEAU,
  NIVEAUX_DE_COMPETITION,
  niveauDepuisCoefficientHerite,
  niveauEffectif,
  nombreVersCentiemes,
  ORDRE_DEPARTAGE_TRANCHES,
  PARAMETRES_DE_POINTS_PAR_DEFAUT,
  pointsDeResultat,
  pointsEquipeClub,
  produitEnCentiemes,
  saisonSportive,
  trancheDeProfil,
  type ParametresDePoints,
  type ResultatAPointer,
} from "../src/points";
import { AGE_GROUPS, isChildAgeCategory } from "../src/referential";

function points(r: Partial<ResultatAPointer>, params?: ParametresDePoints) {
  return pointsDeResultat(
    { place: 1, absolut: false, niveau: "open", exclusion: null, ...r },
    params ?? PARAMETRES_DE_POINTS_PAR_DEFAUT,
  );
}

describe("les quatre exemples du guide (§1.3)", () => {
  it("or de poids en Open = 9", () => {
    expect(points({ place: 1, niveau: "open" })).toEqual({
      valeurPodium: 900,
      coefficient: 100,
      points: 900,
    });
  });

  it("argent d'Absolut en Majeure = 9", () => {
    expect(points({ place: 2, absolut: true, niveau: "majeure" })?.points).toBe(900);
  });

  it("or de poids au Championnat national = 36", () => {
    expect(points({ place: 1, niveau: "national" })?.points).toBe(3600);
  });

  it("or d'Absolut au Championnat national = 54", () => {
    expect(points({ place: 1, absolut: true, niveau: "national" })?.points).toBe(5400);
  });
});

describe("les places et les niveaux", () => {
  it("argent de poids = 3, bronze = 1 ; deux bronzes d'un même tableau rapportent 1 chacun", () => {
    expect(points({ place: 2 })?.points).toBe(300);
    const bronzes = [points({ place: 3 }), points({ place: 3 })];
    expect(bronzes.map((b) => b?.points)).toEqual([100, 100]);
  });

  it("Absolut : 13,5 / 4,5 / 1,5 en Open", () => {
    expect([1, 2, 3].map((p) => points({ place: p as 1 | 2 | 3, absolut: true })?.points)).toEqual([
      1350, 450, 150,
    ]);
  });

  it("hors classement : valeur de podium conservée, coefficient 0, points 0", () => {
    expect(points({ place: 1, absolut: true, niveau: "hors_classement" })).toEqual({
      valeurPodium: 1350,
      coefficient: 0,
      points: 0,
    });
  });

  it("sans place : rien à calculer", () => {
    expect(points({ place: null })).toBeNull();
    expect(pointsEquipeClub(null, null)).toBeNull();
  });
});

describe("les exclusions (CFJJB 2024 art. 3.4 et 3.5)", () => {
  it("seul_inscrit : 0 en individuel ET en équipe, même au National", () => {
    expect(points({ place: 1, niveau: "national", exclusion: "seul_inscrit" })?.points).toBe(0);
    expect(pointsEquipeClub(1, "seul_inscrit")).toBe(0);
  });

  it("meme_equipe : points individuels acquis, 0 en équipe et en club", () => {
    expect(points({ place: 1, niveau: "majeure", exclusion: "meme_equipe" })?.points).toBe(1800);
    expect(pointsEquipeClub(1, "meme_equipe")).toBe(0);
  });

  it("équipe et club : 9 / 3 / 1 sans coefficient, absolut compris", () => {
    expect([1, 2, 3].map((p) => pointsEquipeClub(p as 1 | 2 | 3, null))).toEqual([900, 300, 100]);
  });

  it("exclusionDePoints : 0 et 1 inscrit", () => {
    expect(exclusionDePoints(0)).toBe("seul_inscrit");
    expect(exclusionDePoints(1, ["e1"])).toBe("seul_inscrit");
  });

  it("exclusionDePoints : 2 inscrits de la même équipe, d'équipes différentes, clé absente", () => {
    expect(exclusionDePoints(2, ["e1", "e1"])).toBe("meme_equipe");
    expect(exclusionDePoints(2, ["e1", "e2"])).toBeNull();
    expect(exclusionDePoints(2, ["e1", null])).toBeNull();
    expect(exclusionDePoints(2, [null, null])).toBeNull();
  });

  it("exclusionDePoints : 3 inscrits de la même équipe ne sont pas exclus", () => {
    expect(exclusionDePoints(3, ["e1", "e1", "e1"])).toBeNull();
  });
});

describe("l'arrondi à deux décimales, en centièmes entiers", () => {
  it("4,5 × 2 = 9 et 13,5 × 4 = 54", () => {
    expect(produitEnCentiemes(450, 200)).toBe(900);
    expect(produitEnCentiemes(1350, 400)).toBe(5400);
  });

  it("paramètres décimaux : 1,25 × 1,5 = 1,875 → 1,88 (au plus loin de zéro, comme round numeric)", () => {
    const params: ParametresDePoints = {
      poids: { or: 125, argent: 3, bronze: 1 },
      absolut: { or: 1, argent: 1, bronze: 1 },
      equipeClub: { or: 1, argent: 1, bronze: 1 },
      coefficients: { open: 150, majeure: 200, national: 400 },
    };
    expect(points({ place: 1, niveau: "open" }, params)?.points).toBe(188);
    expect(produitEnCentiemes(333, 333)).toBe(1109);
  });

  it("conversions : 13.5 ↔ 1350, 0.29 → 29, valeur non finie → null", () => {
    expect(nombreVersCentiemes(13.5)).toBe(1350);
    expect(nombreVersCentiemes("13.5")).toBe(1350);
    expect(nombreVersCentiemes(0.29)).toBe(29);
    expect(nombreVersCentiemes("abc")).toBeNull();
    expect(nombreVersCentiemes(null)).toBeNull();
    expect(centiemesVersNombre(1350)).toBe(13.5);
  });
});

describe("les niveaux de compétition (R3 du 16/09)", () => {
  it("dérivation du coefficient hérité : 0, négatif, absent → hors classement", () => {
    expect(niveauDepuisCoefficientHerite(0)).toBe("hors_classement");
    expect(niveauDepuisCoefficientHerite(-2)).toBe("hors_classement");
    expect(niveauDepuisCoefficientHerite(null)).toBe("hors_classement");
    expect(niveauDepuisCoefficientHerite(undefined)).toBe("hors_classement");
  });

  it("1, 2, 3 → Open ; 4 → Majeure ; 5 et 100 → Championnat national", () => {
    expect([1, 2, 3].map(niveauDepuisCoefficientHerite)).toEqual(["open", "open", "open"]);
    expect(niveauDepuisCoefficientHerite(4)).toBe("majeure");
    expect(niveauDepuisCoefficientHerite(5)).toBe("national");
    expect(niveauDepuisCoefficientHerite(100)).toBe("national");
  });

  it("un niveau explicite l'emporte sur le coefficient hérité", () => {
    expect(niveauEffectif("majeure", 5)).toBe("majeure");
    expect(niveauEffectif("hors_classement", 3)).toBe("hors_classement");
    expect(niveauEffectif(null, 4)).toBe("majeure");
    expect(niveauEffectif(undefined, 0)).toBe("hors_classement");
  });

  it("coefficients par défaut : ×1, ×2, ×4, hors classement ×0", () => {
    expect(NIVEAUX_DE_COMPETITION.map((n) => coefficientDuNiveau(n))).toEqual([100, 200, 400, 0]);
  });

  it("libellés et garde de type", () => {
    expect(LIBELLES_NIVEAU.national).toBe("Championnat national");
    expect(estNiveauDeCompetition("majeure")).toBe(true);
    expect(estNiveauDeCompetition("regional")).toBe(false);
    expect(estNiveauDeCompetition(null)).toBe(false);
  });
});

describe("la saison sportive (1er août au 31 juillet)", () => {
  it("bascule au 1er août", () => {
    expect(saisonSportive("2026-07-31")).toBe("2025-26");
    expect(saisonSportive("2026-08-01")).toBe("2026-27");
    expect(saisonSportive("2027-01-01")).toBe("2026-27");
    expect(saisonSportive("2099-12-31")).toBe("2099-00");
  });

  it("accepte un horodatage ISO ; refuse le reste", () => {
    expect(saisonSportive("2026-09-16T10:00:00Z")).toBe("2026-27");
    expect(saisonSportive("16/09/2026")).toBeNull();
    expect(saisonSportive("2026-13-01")).toBeNull();
    expect(saisonSportive(null)).toBeNull();
  });

  it("bornes d'une saison, et refus d'un label incohérent", () => {
    expect(bornesSaisonSportive("2026-27")).toEqual({ debut: "2026-08-01", fin: "2027-07-31" });
    expect(bornesSaisonSportive("2026-28")).toBeNull();
    expect(bornesSaisonSportive("2026-2027")).toBeNull();
  });
});

describe("la tranche d'un profil de classement", () => {
  it("un libellé du référentiel est rendu tel quel", () => {
    for (const g of AGE_GROUPS) expect(trancheDeProfil(g)).toBe(g);
  });

  it("codes ETL : adult, juvenil, u11 ; Masters regroupés tels que combattus", () => {
    expect(trancheDeProfil("adult")).toBe("Adulte");
    expect(trancheDeProfil("juvenil")).toBe("Juvénile");
    expect(trancheDeProfil("u11")).toBe("U11");
    expect(trancheDeProfil("master_1_2")).toBe("Master 1/2");
    expect(trancheDeProfil("master_3_4")).toBe("Master 3/4");
    expect(trancheDeProfil("master_5_plus")).toBe("Master 5+");
    expect(trancheDeProfil("MASTER_1_2")).toBe("Master 1/2");
  });

  it("idempotente : ses propres sorties se relisent à l'identique", () => {
    const sorties = [...AGE_GROUPS, "Master 1/2", "Master 3/4"];
    for (const t of sorties) expect(trancheDeProfil(trancheDeProfil(t))).toBe(t);
    expect(trancheDeProfil("master 1/2")).toBeNull();
  });

  it("codes refusés et libellé mal cassé → null", () => {
    for (const code of ["master", "master1", "master2", "child", "mirim", "infantil"]) {
      expect(trancheDeProfil(code), code).toBeNull();
    }
    expect(trancheDeProfil("adulte")).toBeNull();
    expect(trancheDeProfil("")).toBeNull();
    expect(trancheDeProfil(null)).toBeNull();
  });

  it("ordre de départage 3.3.2 : Adulte, Masters, Juvénile, U15… U7", () => {
    const ordre = Object.entries(ORDRE_DEPARTAGE_TRANCHES)
      .sort((a, b) => a[1] - b[1])
      .map(([t]) => t);
    expect(ordre).toEqual([
      "Adulte",
      "Master 1",
      "Master 1/2",
      "Master 2",
      "Master 3",
      "Master 3/4",
      "Master 4",
      "Master 5+",
      "Juvénile",
      "U15",
      "U13",
      "U11",
      "U9",
      "U7",
    ]);
    for (const g of AGE_GROUPS) expect(ORDRE_DEPARTAGE_TRANCHES[g]).toBeGreaterThan(0);
  });
});

describe("R2 du 16/09 : les jeunes marquent comme les adultes", () => {
  it("U7, U15 et Juvénile : mêmes points qu'un Adulte, à chaque place et niveau", () => {
    for (const tranche of ["U7", "U15", "Juvénile", "Adulte"] as const) {
      const profil = trancheDeProfil(tranche);
      expect(profil).toBe(tranche);
      expect(points({ place: 1, niveau: "national" })?.points).toBe(3600);
    }
    expect(isChildAgeCategory("U7")).toBe(true);
    expect(isChildAgeCategory("Juvénile")).toBe(true);
  });
});

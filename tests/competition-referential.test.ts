import { describe, expect, it } from "vitest";
import {
  AGE_GROUPS,
  ADULT_COMPETITION_BELTS,
  KIDS_COMPETITION_BELTS,
  buildCategoryFullname,
  buildCategoryShortname,
  computeAgeGroup,
  genderLabel,
  getFightDurationSeconds,
  getMaxWeightKg,
  isBeltAllowedForAgeGroup,
  isChildAgeGroup,
  listWeightClasses,
  nextAgeCategoryChange,
  willGetBlueBeltAtJuvenile,
} from "../src/referential";

describe("computeAgeGroup", () => {
  // Rule: age reached during the calendar year of the competition (année civile).
  // Bornes CFJJB : U7 <=7, U9 8-9, U11 10-11, U13 12-13, U15 14-15,
  // Juvénile 16-17, Adulte 18-29, M1 30-35, M2 36-40, M3 41-45, M4 46-50, M5+ 51+.
  // Chaque frontière est testée des deux côtés. Compétition en 2026 ⇒ âge =
  // 2026 - année de naissance.
  it("computes children groups from calendar-year age (each boundary)", () => {
    expect(computeAgeGroup("2020-06-15", "2026-06-10")).toBe("U7"); // 6
    expect(computeAgeGroup("2019-06-15", "2026-06-10")).toBe("U7"); // 7
    expect(computeAgeGroup("2018-06-15", "2026-06-10")).toBe("U9"); // 8
    expect(computeAgeGroup("2017-06-15", "2026-06-10")).toBe("U9"); // 9
    expect(computeAgeGroup("2016-06-15", "2026-06-10")).toBe("U11"); // 10
    expect(computeAgeGroup("2015-06-15", "2026-06-10")).toBe("U11"); // 11 (cas Haroun)
    expect(computeAgeGroup("2014-06-15", "2026-06-10")).toBe("U13"); // 12
    expect(computeAgeGroup("2013-06-15", "2026-06-10")).toBe("U13"); // 13
    expect(computeAgeGroup("2012-06-15", "2026-06-10")).toBe("U15"); // 14
    expect(computeAgeGroup("2011-06-15", "2026-06-10")).toBe("U15"); // 15
  });

  it("computes juvenile / adult / master boundaries (bornes CFJJB)", () => {
    // Juvénile ne commence qu'à 16 ans (année civile), en phase avec la bascule
    // ceinture bleue automatique (BELT_AGE_BOUNDS blue minAge 16).
    expect(computeAgeGroup("2010-06-15", "2026-06-10")).toBe("Juvénile"); // 16
    expect(computeAgeGroup("2009-06-15", "2026-06-10")).toBe("Juvénile"); // 17
    expect(computeAgeGroup("2008-06-15", "2026-06-10")).toBe("Adulte"); // 18
    expect(computeAgeGroup("1997-06-15", "2026-06-10")).toBe("Adulte"); // 29
    expect(computeAgeGroup("1996-06-15", "2026-06-10")).toBe("Master 1"); // 30
    expect(computeAgeGroup("1991-06-15", "2026-06-10")).toBe("Master 1"); // 35
    expect(computeAgeGroup("1990-06-15", "2026-06-10")).toBe("Master 2"); // 36
    expect(computeAgeGroup("1986-06-15", "2026-06-10")).toBe("Master 2"); // 40
    expect(computeAgeGroup("1985-06-15", "2026-06-10")).toBe("Master 3"); // 41
    expect(computeAgeGroup("1981-06-15", "2026-06-10")).toBe("Master 3"); // 45
    expect(computeAgeGroup("1980-06-15", "2026-06-10")).toBe("Master 4"); // 46
    expect(computeAgeGroup("1976-06-15", "2026-06-10")).toBe("Master 4"); // 50
    expect(computeAgeGroup("1975-06-15", "2026-06-10")).toBe("Master 5+"); // 51
  });

  it("uses the calendar year, not the exact birthday", () => {
    // Born November 2008, competition June 2026: turns 18 in 2026 → Adulte
    // even though still 17 on competition day.
    expect(computeAgeGroup("2008-11-30", "2026-06-10")).toBe("Adulte");
  });
});

describe("category fullnames (Jour J format)", () => {
  it("builds the exact Jour J adult format", () => {
    expect(
      buildCategoryFullname({
        belt: "blue",
        ageGroup: "Adulte",
        gender: "male",
        weightClass: "Pena",
      }),
    ).toBe("Bleue - Adulte - Homme - Pena");
  });

  it("builds the exact Jour J children format", () => {
    expect(
      buildCategoryFullname({
        belt: "grey",
        ageGroup: "U11",
        gender: "male",
        weightClass: "Pena",
      }),
    ).toBe("Grise - U11 - Garçon - Pena");
  });

  it("uses Femme / Fille for female competitors", () => {
    expect(genderLabel("female", "Adulte")).toBe("Femme");
    expect(genderLabel("female", "U13")).toBe("Fille");
    expect(
      buildCategoryFullname({
        belt: "brown",
        ageGroup: "Master 2",
        gender: "female",
        weightClass: "Leve",
      }),
    ).toBe("Marron - Master 2 - Femme - Leve");
  });

  it("builds shortnames", () => {
    expect(buildCategoryShortname({ ageGroup: "Adulte", weightClass: "Pena" })).toBe(
      "Adulte - Pena",
    );
  });
});

describe("weight classes", () => {
  it("adult female Gi has no Super Pesado but always Pesadissimo", () => {
    const classes = listWeightClasses("gi", "Adulte", "female");
    const names = classes.map((c) => c.name);
    expect(names).not.toContain("Super Pesado");
    expect(names).toContain("Pesadissimo");
    expect(classes.find((c) => c.name === "Pesadissimo")?.maxKg).toBeNull();
  });

  it("masters use the adult limits", () => {
    for (const m of ["Master 1", "Master 2", "Master 3", "Master 4", "Master 5+"] as const) {
      expect(getMaxWeightKg("gi", m, "male", "Pena")).toBe(
        getMaxWeightKg("gi", "Adulte", "male", "Pena"),
      );
    }
  });

  it("juveniles have their own limits", () => {
    expect(getMaxWeightKg("gi", "Juvénile", "male", "Pena")).toBe(64.0);
    expect(getMaxWeightKg("gi", "Adulte", "male", "Pena")).toBe(70.0);
  });

  it("children limits are per age group, NoGi differs from Gi", () => {
    expect(getMaxWeightKg("gi", "U11", "male", "Pena")).toBe(36.2);
    expect(getMaxWeightKg("nogi", "U11", "male", "Pena")).toBe(34.8);
    // Source data irregularity kept verbatim (NoGi children Leve U9).
    expect(getMaxWeightKg("nogi", "U9", "male", "Leve")).toBe(31.2);
  });
});

describe("fight durations", () => {
  it("matches the official duration table (seconds)", () => {
    expect(getFightDurationSeconds("white", "Adulte", "gi")).toBe(300);
    expect(getFightDurationSeconds("blue", "Adulte", "gi")).toBe(360);
    expect(getFightDurationSeconds("purple", "Adulte", "gi")).toBe(420);
    expect(getFightDurationSeconds("brown", "Adulte", "gi")).toBe(480);
    expect(getFightDurationSeconds("black", "Adulte", "gi")).toBe(600);
    // Master 1 & 2 share the old "Master 1/2" duration; Master 3 & 4 share "Master 3/4".
    expect(getFightDurationSeconds("purple", "Master 1", "gi")).toBe(360);
    expect(getFightDurationSeconds("purple", "Master 2", "gi")).toBe(360);
    expect(getFightDurationSeconds("purple", "Master 3", "gi")).toBe(300);
    expect(getFightDurationSeconds("purple", "Master 4", "gi")).toBe(300);
    expect(getFightDurationSeconds("black", "Master 1", "gi")).toBe(360);
    expect(getFightDurationSeconds("grey", "U9", "gi")).toBe(180);
    expect(getFightDurationSeconds("grey", "U11", "nogi")).toBe(240);
  });

  it("returns null for combinations that do not exist", () => {
    expect(getFightDurationSeconds("brown", "Juvénile", "gi")).toBeNull();
    expect(getFightDurationSeconds("black", "Juvénile", "gi")).toBeNull();
    expect(getFightDurationSeconds("white", "U7", "gi")).toBeNull();
    expect(getFightDurationSeconds("green", "U9", "gi")).toBeNull();
    expect(isBeltAllowedForAgeGroup("brown", "Juvénile", "gi")).toBe(false);
    expect(isBeltAllowedForAgeGroup("blue", "Adulte", "gi")).toBe(true);
  });
});

describe("misc referential", () => {
  it("classifies child age groups", () => {
    for (const g of AGE_GROUPS) {
      expect(isChildAgeGroup(g)).toBe(g.startsWith("U"));
    }
  });

  it("competition belts exclude coral/red and split kids belts", () => {
    expect(ADULT_COMPETITION_BELTS).not.toContain("coral");
    expect(ADULT_COMPETITION_BELTS).not.toContain("red");
    expect(KIDS_COMPETITION_BELTS).toContain("grey");
    expect(KIDS_COMPETITION_BELTS).not.toContain("blue");
  });
});

describe("nextAgeCategoryChange", () => {
  // Convention computeAgeGroup : âge = année de référence - année de naissance.
  it("U13 → U15 au prochain 1er janvier", () => {
    // Né 2014 : en 2026 âge 12 (U13), encore U13 en 2027 (âge 13) ; il passe
    // U15 au 1er janvier 2028 (âge 14).
    const res = nextAgeCategoryChange("2014-06-15", new Date("2026-06-10T00:00:00Z"));
    expect(res).toEqual({ nextGroup: "U15", changeDate: "2028-01-01" });
  });

  it("U15 → Juvénile au prochain 1er janvier", () => {
    // DEV-086 : né 2012, âge 14 en 2026, encore U15 en 2027 (âge 15) ; il ne
    // passe Juvénile qu'au 1er janvier 2028 (âge 16).
    const res = nextAgeCategoryChange("2012-06-15", new Date("2026-06-10T00:00:00Z"));
    expect(res).toEqual({ nextGroup: "Juvénile", changeDate: "2028-01-01" });
  });

  it("bascule un mineur né un 1er janvier le jour même (année civile)", () => {
    // DEV-086 : né le 1er janvier 2012, il a 16 ans (Juvénile) au 1er janvier
    // 2028 ; la recherche démarre à l'année suivant `on` et trouve bien 2028.
    const res = nextAgeCategoryChange("2012-01-01", new Date("2026-01-01T00:00:00Z"));
    expect(res).toEqual({ nextGroup: "Juvénile", changeDate: "2028-01-01" });
  });

  it("Juvénile → Adulte", () => {
    // Né 2009 : en 2026 âge 17 (Juvénile) ; au 1er janvier 2027 âge 18 (Adulte).
    const res = nextAgeCategoryChange("2009-06-15", new Date("2026-06-10T00:00:00Z"));
    expect(res).toEqual({ nextGroup: "Adulte", changeDate: "2027-01-01" });
  });

  it("Adulte → Master 1 (les passages adultes/masters sont affichés)", () => {
    // Né 1996 : en 2026 âge 30 (Master 1) déjà ; prendre un adulte : né 1997,
    // âge 29 (Adulte) en 2026 → Master 1 au 1er janvier 2027 (âge 30).
    const res = nextAgeCategoryChange("1997-06-15", new Date("2026-06-10T00:00:00Z"));
    expect(res).toEqual({ nextGroup: "Master 1", changeDate: "2027-01-01" });
  });

  it("Master 4 → Master 5+ au prochain 1er janvier", () => {
    // Né 1976 : en 2026 âge 50 (Master 4) ; au 1er janvier 2027 âge 51
    // (Master 5+). Cas frontière qui valide la borne haute de recherche (+52).
    const res = nextAgeCategoryChange("1976-06-15", new Date("2026-06-10T00:00:00Z"));
    expect(res).toEqual({ nextGroup: "Master 5+", changeDate: "2027-01-01" });
  });

  it("renvoie null pour la dernière catégorie ouverte (Master 5+)", () => {
    // Né 1975 : en 2026 âge 51 → Master 5+, plus aucune bascule.
    expect(nextAgeCategoryChange("1975-06-15", new Date("2026-06-10T00:00:00Z"))).toBeNull();
  });
});

describe("willGetBlueBeltAtJuvenile", () => {
  const onU15 = new Date("2026-06-10T00:00:00Z"); // né 2012 → U15, prochain Juvénile.

  it("vrai pour une couleur Kids dont la prochaine bascule est Juvénile", () => {
    for (const belt of ["grey", "yellow", "orange", "green"] as const) {
      expect(willGetBlueBeltAtJuvenile(belt, "2012-06-15", onU15)).toBe(true);
    }
  });

  it("faux pour la ceinture blanche (obtient le bleu par la progression normale)", () => {
    expect(willGetBlueBeltAtJuvenile("white", "2012-06-15", onU15)).toBe(false);
  });

  it("faux quand la prochaine bascule n'est pas Juvénile", () => {
    // Né 2014 → U13, prochain passage U15 (pas Juvénile).
    expect(willGetBlueBeltAtJuvenile("green", "2014-06-15", onU15)).toBe(false);
  });

  it("faux pour une ceinture non Kids (déjà bleue ou plus)", () => {
    expect(willGetBlueBeltAtJuvenile("blue", "2012-06-15", onU15)).toBe(false);
    expect(willGetBlueBeltAtJuvenile("purple", "2012-06-15", onU15)).toBe(false);
  });
});

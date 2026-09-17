import { describe, expect, it } from "vitest";
import {
  AGE_GROUPS,
  ADULT_COMPETITION_BELTS,
  KIDS_COMPETITION_BELTS,
  REGLEMENT_DE_REFERENCE,
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
  it("computes children groups from calendar-year age (each boundary)", () => {
    expect(computeAgeGroup("2020-06-15", "2026-06-10")).toBe("U7");
    expect(computeAgeGroup("2019-06-15", "2026-06-10")).toBe("U7");
    expect(computeAgeGroup("2018-06-15", "2026-06-10")).toBe("U9");
    expect(computeAgeGroup("2017-06-15", "2026-06-10")).toBe("U9");
    expect(computeAgeGroup("2016-06-15", "2026-06-10")).toBe("U11");
    expect(computeAgeGroup("2015-06-15", "2026-06-10")).toBe("U11");
    expect(computeAgeGroup("2014-06-15", "2026-06-10")).toBe("U13");
    expect(computeAgeGroup("2013-06-15", "2026-06-10")).toBe("U13");
    expect(computeAgeGroup("2012-06-15", "2026-06-10")).toBe("U15");
    expect(computeAgeGroup("2011-06-15", "2026-06-10")).toBe("U15");
  });

  it("computes juvenile / adult / master boundaries (bornes CFJJB)", () => {
    expect(computeAgeGroup("2010-06-15", "2026-06-10")).toBe("Juvénile");
    expect(computeAgeGroup("2009-06-15", "2026-06-10")).toBe("Juvénile");
    expect(computeAgeGroup("2008-06-15", "2026-06-10")).toBe("Adulte");
    expect(computeAgeGroup("1997-06-15", "2026-06-10")).toBe("Adulte");
    expect(computeAgeGroup("1996-06-15", "2026-06-10")).toBe("Master 1");
    expect(computeAgeGroup("1991-06-15", "2026-06-10")).toBe("Master 1");
    expect(computeAgeGroup("1990-06-15", "2026-06-10")).toBe("Master 2");
    expect(computeAgeGroup("1986-06-15", "2026-06-10")).toBe("Master 2");
    expect(computeAgeGroup("1985-06-15", "2026-06-10")).toBe("Master 3");
    expect(computeAgeGroup("1981-06-15", "2026-06-10")).toBe("Master 3");
    expect(computeAgeGroup("1980-06-15", "2026-06-10")).toBe("Master 4");
    expect(computeAgeGroup("1976-06-15", "2026-06-10")).toBe("Master 4");
    expect(computeAgeGroup("1975-06-15", "2026-06-10")).toBe("Master 5+");
  });

  it("uses the calendar year, not the exact birthday", () => {
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
    expect(getFightDurationSeconds("purple", "Master 1", "gi")).toBe(360);
    expect(getFightDurationSeconds("purple", "Master 2", "gi")).toBe(300);
    expect(getFightDurationSeconds("purple", "Master 3", "gi")).toBe(300);
    expect(getFightDurationSeconds("purple", "Master 4", "gi")).toBe(300);
    expect(getFightDurationSeconds("black", "Master 1", "gi")).toBe(360);
    expect(getFightDurationSeconds("grey", "U9", "gi")).toBe(180);
    expect(getFightDurationSeconds("grey", "U11", "nogi")).toBe(240);
  });

  it("tient la table IBJJF 6.1 complète, U7 = 3 min, en Gi comme en No-Gi", () => {
    const minutesAdultes: Record<string, (number | null)[]> = {
      white: [5, 5, 5, 5, 5, 5, 5],
      blue: [5, 6, 5, 5, 5, 5, 5],
      purple: [5, 7, 6, 5, 5, 5, 5],
      brown: [null, 8, 6, 5, 5, 5, 5],
      black: [null, 10, 6, 5, 5, 5, 5],
    };
    const tranchesAdultes = [
      "Juvénile",
      "Adulte",
      "Master 1",
      "Master 2",
      "Master 3",
      "Master 4",
      "Master 5+",
    ] as const;
    const minutesEnfants: Record<string, (number | null)[]> = {
      white: [null, null, null, null, 4],
      grey: [3, 3, 4, 4, 4],
      yellow: [3, 3, 4, 4, 4],
      orange: [null, null, 4, 4, 4],
      green: [null, null, null, 4, 4],
    };
    const tranchesEnfants = ["U7", "U9", "U11", "U13", "U15"] as const;

    for (const discipline of ["gi", "nogi"] as const) {
      for (const [ceinture, ligne] of Object.entries(minutesAdultes)) {
        tranchesAdultes.forEach((tranche, i) => {
          const attendu = ligne[i] === null ? null : ligne[i]! * 60;
          expect(
            getFightDurationSeconds(ceinture as "white", tranche, discipline),
            `${ceinture} ${tranche} ${discipline}`,
          ).toBe(attendu);
        });
      }
      for (const [ceinture, ligne] of Object.entries(minutesEnfants)) {
        tranchesEnfants.forEach((tranche, i) => {
          const attendu = ligne[i] === null ? null : ligne[i]! * 60;
          expect(
            getFightDurationSeconds(ceinture as "white", tranche, discipline),
            `${ceinture} ${tranche} ${discipline}`,
          ).toBe(attendu);
        });
      }
    }
  });

  it("Master 2 violette, marron et noire = 5 min ; Master 1 reste à 6 min (seul écart 6.1)", () => {
    for (const ceinture of ["purple", "brown", "black"] as const) {
      expect(getFightDurationSeconds(ceinture, "Master 2", "gi")).toBe(300);
      expect(getFightDurationSeconds(ceinture, "Master 2", "nogi")).toBe(300);
      expect(getFightDurationSeconds(ceinture, "Master 1", "gi")).toBe(360);
    }
    expect(getFightDurationSeconds("grey", "U7", "gi")).toBe(180);
    expect(getFightDurationSeconds("yellow", "U7", "gi")).toBe(180);
  });

  it("documente la version du règlement appliquée", () => {
    expect(REGLEMENT_DE_REFERENCE.version).toBe("6.1");
    expect(REGLEMENT_DE_REFERENCE.date).toBe("2024-06");
    expect(REGLEMENT_DE_REFERENCE.note).toContain("6.2");
    expect(REGLEMENT_DE_REFERENCE.note).toContain("U7");
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
  it("U13 → U15 au prochain 1er janvier", () => {
    const res = nextAgeCategoryChange("2014-06-15", new Date("2026-06-10T00:00:00Z"));
    expect(res).toEqual({ nextGroup: "U15", changeDate: "2028-01-01" });
  });

  it("U15 → Juvénile au prochain 1er janvier", () => {
    const res = nextAgeCategoryChange("2012-06-15", new Date("2026-06-10T00:00:00Z"));
    expect(res).toEqual({ nextGroup: "Juvénile", changeDate: "2028-01-01" });
  });

  it("bascule un mineur né un 1er janvier le jour même (année civile)", () => {
    const res = nextAgeCategoryChange("2012-01-01", new Date("2026-01-01T00:00:00Z"));
    expect(res).toEqual({ nextGroup: "Juvénile", changeDate: "2028-01-01" });
  });

  it("Juvénile → Adulte", () => {
    const res = nextAgeCategoryChange("2009-06-15", new Date("2026-06-10T00:00:00Z"));
    expect(res).toEqual({ nextGroup: "Adulte", changeDate: "2027-01-01" });
  });

  it("Adulte → Master 1 (les passages adultes/masters sont affichés)", () => {
    const res = nextAgeCategoryChange("1997-06-15", new Date("2026-06-10T00:00:00Z"));
    expect(res).toEqual({ nextGroup: "Master 1", changeDate: "2027-01-01" });
  });

  it("Master 4 → Master 5+ au prochain 1er janvier", () => {
    const res = nextAgeCategoryChange("1976-06-15", new Date("2026-06-10T00:00:00Z"));
    expect(res).toEqual({ nextGroup: "Master 5+", changeDate: "2027-01-01" });
  });

  it("renvoie null pour la dernière catégorie ouverte (Master 5+)", () => {
    expect(nextAgeCategoryChange("1975-06-15", new Date("2026-06-10T00:00:00Z"))).toBeNull();
  });
});

describe("willGetBlueBeltAtJuvenile", () => {
  const onU15 = new Date("2026-06-10T00:00:00Z");

  it("vrai pour une couleur Kids dont la prochaine bascule est Juvénile", () => {
    for (const belt of ["grey", "yellow", "orange", "green"] as const) {
      expect(willGetBlueBeltAtJuvenile(belt, "2012-06-15", onU15)).toBe(true);
    }
  });

  it("faux pour la ceinture blanche (obtient le bleu par la progression normale)", () => {
    expect(willGetBlueBeltAtJuvenile("white", "2012-06-15", onU15)).toBe(false);
  });

  it("faux quand la prochaine bascule n'est pas Juvénile", () => {
    expect(willGetBlueBeltAtJuvenile("green", "2014-06-15", onU15)).toBe(false);
  });

  it("faux pour une ceinture non Kids (déjà bleue ou plus)", () => {
    expect(willGetBlueBeltAtJuvenile("blue", "2012-06-15", onU15)).toBe(false);
    expect(willGetBlueBeltAtJuvenile("purple", "2012-06-15", onU15)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  CODES_AGE_NON_TRADUISIBLES,
  estCoherentEnfant,
  limiteRefusMessage,
  resolveAgeGroup,
  resolveWeightClass,
  resolveWeightLimit,
} from "../src/db-vocabulary";
import {
  AGE_GROUPS,
  getFightDurationSeconds,
  getMaxWeightKg,
  WEIGHT_CLASSES,
} from "../src/referential";

const CODES_PROD = [
  "adult",
  "master_1_2",
  "master",
  "master_3_4",
  "juvenil",
  "u11",
  "u15",
  "u13",
  "u9",
  "master_5_plus",
  "infantil",
  "mirim",
  "u7",
  "master2",
  "infantiljuvenil",
  "child",
  "premirim",
  "master1",
] as const;

describe("la conversion est TOTALE sur les codes de production", () => {
  it("chaque code rend soit un AgeGroup valide, soit null — jamais autre chose", () => {
    for (const code of CODES_PROD) {
      const r = resolveAgeGroup(code);
      if (r === null) continue;
      expect(
        (AGE_GROUPS as readonly string[]).includes(r),
        `« ${code} » rend « ${r} », qui n'appartient pas à AGE_GROUPS`,
      ).toBe(true);
    }
  });

  it("les dix codes vivants sont traduits", () => {
    expect(resolveAgeGroup("adult")).toBe("Adulte");
    expect(resolveAgeGroup("juvenil")).toBe("Juvénile");
    expect(resolveAgeGroup("u7")).toBe("U7");
    expect(resolveAgeGroup("u15")).toBe("U15");
    expect(resolveAgeGroup("master_1_2")).toBe("Master 1");
    expect(resolveAgeGroup("master_3_4")).toBe("Master 3");
    expect(resolveAgeGroup("master_5_plus")).toBe("Master 5+");
  });

  it("les codes ambigus et éteints rendent null, SCIEMMENT", () => {
    for (const code of CODES_AGE_NON_TRADUISIBLES) {
      expect(resolveAgeGroup(code), code).toBeNull();
    }
  });

  it("un libellé du vocabulaire NEUF est rendu tel quel", () => {
    for (const g of AGE_GROUPS) expect(resolveAgeGroup(g), g).toBe(g);
    for (const w of WEIGHT_CLASSES) expect(resolveWeightClass(w), w).toBe(w);
  });
});

describe("l'indice de poids et ses aberrations", () => {
  it("traduit l'indice 0-based", () => {
    expect(resolveWeightClass("0")).toBe("Galo");
    expect(resolveWeightClass("3")).toBe("Leve");
    expect(resolveWeightClass("8")).toBe("Pesadissimo");
  });

  it("refuse les valeurs aberrantes mesurées en production", () => {
    for (const v of ["9", "36", "500", "-30", "-62", "inconnu", ""]) {
      expect(resolveWeightClass(v), v).toBeNull();
    }
  });
});

describe("LE DÉFAUT D'ORIGINE : un enfant pesé au barème adulte", () => {
  it("aucun code enfant n'est classé adulte, et réciproquement", () => {
    for (const code of CODES_PROD) {
      const r = resolveAgeGroup(code);
      if (r === null) continue;
      expect(estCoherentEnfant(code, r), `${code} → ${r}`).toBe(true);
    }
  });

  it("la limite d'un U11 n'est PAS celle d'un adulte", () => {
    const enfant = resolveWeightLimit({
      discipline: "gi",
      storedAgeGroup: "u11",
      gender: "male",
      storedWeightClass: "2",
    });
    const adulte = resolveWeightLimit({
      discipline: "gi",
      storedAgeGroup: "adult",
      gender: "male",
      storedWeightClass: "2",
    });
    expect(enfant.ok && adulte.ok).toBe(true);
    if (enfant.ok && adulte.ok) {
      expect(enfant.maxKg).not.toBe(adulte.maxKg);
      expect(enfant.maxKg!).toBeLessThan(adulte.maxKg!);
    }
  });

  it("le passage brut par getMaxWeightKg LÈVE, et c'est ce qu'on remplace", () => {
    expect(() => getMaxWeightKg("gi", "Adulte", "male", "3" as never)).toThrow();
    expect(
      resolveWeightLimit({
        discipline: "gi",
        storedAgeGroup: "adult",
        gender: "male",
        storedWeightClass: "3",
      }).ok,
    ).toBe(true);
  });
});

describe("les refus sont motivés et affichables", () => {
  it("chaque motif a un message qui ne montre aucun code", () => {
    for (const r of [
      "age_inconnu",
      "classe_inconnue",
      "genre_manquant",
      "combinaison_absente",
    ] as const) {
      const m = limiteRefusMessage(r);
      expect(m.length).toBeGreaterThan(20);
      expect(m).not.toContain("_");
    }
  });

  it("un genre manquant refuse au lieu de supposer", () => {
    const r = resolveWeightLimit({
      discipline: "gi",
      storedAgeGroup: "adult",
      gender: null,
      storedWeightClass: "3",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.raison).toBe("genre_manquant");
  });

  it("« sans limite » est un SUCCÈS, pas un refus", () => {
    const r = resolveWeightLimit({
      discipline: "gi",
      storedAgeGroup: "adult",
      gender: "male",
      storedWeightClass: "8",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.maxKg).toBeNull();
  });

  it("un code inconnu refuse avec le bon motif", () => {
    for (const [code, raison] of [
      ["mirim", "age_inconnu"],
      ["adult", "classe_inconnue"],
    ] as const) {
      const r = resolveWeightLimit({
        discipline: "gi",
        storedAgeGroup: code,
        gender: "male",
        storedWeightClass: raison === "classe_inconnue" ? "500" : "3",
      });
      expect(r.ok, `${code}/${raison}`).toBe(false);
      if (!r.ok) expect(r.raison).toBe(raison);
    }
  });
});

describe("POURQUOI LA CONVERSION DOIT ÊTRE FINE : les durées de combat", () => {
  it("un master ne combat pas la durée d'un adulte", () => {
    const adulte = getFightDurationSeconds("black", "Adulte", "gi");
    const m1 = getFightDurationSeconds("black", resolveAgeGroup("master_1_2")!, "gi");
    const m3 = getFightDurationSeconds("black", resolveAgeGroup("master_3_4")!, "gi");
    expect(adulte).not.toBeNull();
    expect(m1).not.toBeNull();
    expect(m1).not.toBe(adulte);
    expect(m3).not.toBe(adulte);
  });

  it("chaque code vivant désigne une tranche RÉELLE des tables de durée", () => {
    const CEINTURES = [
      "white",
      "grey",
      "yellow",
      "orange",
      "green",
      "blue",
      "purple",
      "brown",
      "black",
    ] as const;
    for (const code of [
      "adult",
      "juvenil",
      "u7",
      "u9",
      "u11",
      "u13",
      "u15",
      "master_1_2",
      "master_3_4",
      "master_5_plus",
    ] as const) {
      const g = resolveAgeGroup(code);
      expect(g, code).not.toBeNull();
      const durees = CEINTURES.map((b) => getFightDurationSeconds(b, g!, "gi")).filter(
        (d): d is number => d !== null,
      );
      expect(
        durees.length,
        `${code} → ${g} : aucune ceinture ne donne de durée, la tranche n'existe pas dans les tables`,
      ).toBeGreaterThan(0);
    }
  });
});

describe("ce que la MESURE a réfuté, et qui doit rester réfuté", () => {
  it("`master2` n'est PAS « Master 2 » — il porte 41 à 66 ans", () => {
    expect(resolveAgeGroup("master2")).toBeNull();
  });

  it("`master1` non plus, même si sa population tiendrait", () => {
    expect(resolveAgeGroup("master1")).toBeNull();
  });

  it("la BANDE convertie est exacte, pas seulement le côté enfant/adulte", () => {
    const attendu: ReadonlyArray<readonly [string, string]> = [
      ["u7", "U7"],
      ["u9", "U9"],
      ["u11", "U11"],
      ["u13", "U13"],
      ["u15", "U15"],
    ];
    for (const [code, bande] of attendu) {
      expect(resolveAgeGroup(code), code).toBe(bande);
    }
    const limites = attendu.map(([code]) =>
      resolveWeightLimit({
        discipline: "gi",
        storedAgeGroup: code,
        gender: null,
        storedWeightClass: "2",
      }),
    );
    const kgs = limites.map((l) => (l.ok ? l.maxKg : null));
    expect(new Set(kgs).size, `limites: ${JSON.stringify(kgs)}`).toBe(5);
  });

  it("un enfant n'a PAS besoin de genre pour avoir une limite", () => {
    const r = resolveWeightLimit({
      discipline: "gi",
      storedAgeGroup: "u11",
      gender: null,
      storedWeightClass: "2",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.maxKg).not.toBeNull();
  });

  it("« sans limite » n'est PAS « cette classe n'existe pas pour vous »", () => {
    const femmeSuperPesado = resolveWeightLimit({
      discipline: "gi",
      storedAgeGroup: "adult",
      gender: "female",
      storedWeightClass: "7",
    });
    expect(femmeSuperPesado.ok).toBe(false);
    if (!femmeSuperPesado.ok) expect(femmeSuperPesado.raison).toBe("classe_absente_pour_ce_groupe");

    const ouverte = resolveWeightLimit({
      discipline: "gi",
      storedAgeGroup: "adult",
      gender: "female",
      storedWeightClass: "8",
    });
    expect(ouverte.ok).toBe(true);
    if (ouverte.ok) expect(ouverte.maxKg).toBeNull();
  });
});

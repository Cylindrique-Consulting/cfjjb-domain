import { describe, expect, it } from "vitest";
import { AGE_GROUPS } from "../src/referential";
import {
  ageGroupsInPools,
  DEFAULT_FORMAT_BY_AGE_GROUP,
  drawFormatFromBracketMode,
  formatForAgeGroup,
  type FormatByAgeGroup,
} from "../src/competition-format";

// ===================================================================
// LA DÉCISION PRODUIT, GELÉE
//
// Le moteur de poules existe, il est testé, et AUCUN format par défaut ne
// l'active. Ces trois tests sont le verrou : une seule tranche basculée par
// mégarde change le format de vraies compétitions, et rien d'autre ne le
// signalerait avant le jour J.
// ===================================================================

describe("la table de formats par défaut", () => {
  it("n'active la poule pour AUCUNE tranche d'âge", () => {
    expect(ageGroupsInPools()).toEqual([]);
  });

  it("rend single_elim pour les douze tranches, nommément", () => {
    const parTranche = AGE_GROUPS.map((g) => [g, formatForAgeGroup(g)] as const);
    expect(parTranche).toEqual([
      ["U7", "single_elim"],
      ["U9", "single_elim"],
      ["U11", "single_elim"],
      ["U13", "single_elim"],
      ["U15", "single_elim"],
      ["Juvénile", "single_elim"],
      ["Adulte", "single_elim"],
      ["Master 1", "single_elim"],
      ["Master 2", "single_elim"],
      ["Master 3", "single_elim"],
      ["Master 4", "single_elim"],
      ["Master 5+", "single_elim"],
    ]);
  });

  it("couvre exactement les tranches du référentiel, sans trou ni surplus", () => {
    expect(Object.keys(DEFAULT_FORMAT_BY_AGE_GROUP).sort()).toEqual([...AGE_GROUPS].sort());
  });
});

describe("la table de formats fournie par l'appelant", () => {
  it("se lit : une tranche basculée bascule, et elle seule", () => {
    const table: FormatByAgeGroup = { ...DEFAULT_FORMAT_BY_AGE_GROUP, U11: "pools" };
    expect(formatForAgeGroup("U11", table)).toBe("pools");
    expect(formatForAgeGroup("Adulte", table)).toBe("single_elim");
    expect(ageGroupsInPools(table)).toEqual(["U11"]);
  });

  it("retombe sur single_elim quand une tranche manque, jamais sur le format neuf", () => {
    // Une table partielle ne doit pas basculer une catégorie en poule par
    // omission : le défaut de sécurité est le format d'aujourd'hui.
    expect(formatForAgeGroup("Adulte", { U11: "pools" })).toBe("single_elim");
  });
});

// ===================================================================
// LE VOCABULAIRE DE LA COLONNE
// ===================================================================

describe("drawFormatFromBracketMode", () => {
  it("démêle le format des deux valeurs qui portent aussi le mode de 3e place", () => {
    expect(drawFormatFromBracketMode("single_elim_no_third")).toBe("single_elim");
    expect(drawFormatFromBracketMode("single_elim_with_third")).toBe("single_elim");
  });

  it("reconnaît la seule valeur qui demande une poule", () => {
    expect(drawFormatFromBracketMode("pools")).toBe("pools");
  });

  it("rend null plutôt que d'approximer une valeur inconnue", () => {
    // « Je ne sais pas » est une réponse. Approximer en élimination directe est
    // exactement le repli muet qui a laissé `bracket_mode` illisible deux mois.
    expect(drawFormatFromBracketMode("round_robin")).toBeNull();
    expect(drawFormatFromBracketMode("")).toBeNull();
    expect(drawFormatFromBracketMode(null)).toBeNull();
    expect(drawFormatFromBracketMode(undefined)).toBeNull();
  });
});

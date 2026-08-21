import { describe, expect, it } from "vitest";
import { generateBracket, type BracketEntry } from "../src/bracket-generator";
import { generateCategoryDraw, resolveDrawFormat } from "../src/category-draw";
import { generatePool, poolFightCount } from "../src/pool-generator";

function entries(n: number): BracketEntry[] {
  return Array.from({ length: n }, (_, i) => ({ registrationId: `r${i + 1}`, clubId: null }));
}

// ===================================================================
// L'AIGUILLAGE
// ===================================================================

describe("generateCategoryDraw", () => {
  it("rend exactement le tableau d'avant ce lot quand le format est l'élimination directe", () => {
    // Non-régression au bit près : le moteur de poules ne doit RIEN changer aux
    // compétitions d'aujourd'hui, qui sont toutes en élimination directe.
    const draw = generateCategoryDraw(entries(11), "graine", {
      format: "single_elim",
      thirdPlaceMode: "pool3",
    });
    if (draw.appliedFormat !== "single_elim") throw new Error("élimination attendue");
    expect(draw.bracket).toEqual(
      generateBracket(entries(11), "graine", { thirdPlaceMode: "pool3" }),
    );
    expect(draw.fallback, "aucun repli : la clé doit être ABSENTE").toBeUndefined();
    expect(draw.requestedFormat).toBe("single_elim");
  });

  it("rend une poule quand le format est la poule et que la taille le permet", () => {
    const draw = generateCategoryDraw(entries(6), "graine", {
      format: "pools",
      thirdPlaceMode: "pool3",
    });
    if (draw.appliedFormat !== "pools") throw new Error("poule attendue");
    expect(draw.pool).toEqual(generatePool(entries(6), "graine", { maxSize: 6 }));
    expect(draw.requestedFormat).toBe("pools");
  });

  it("ne consulte jamais le mode de 3e place en poule", () => {
    const avec = generateCategoryDraw(entries(5), "g", {
      format: "pools",
      thirdPlaceMode: "pool3",
    });
    const sans = generateCategoryDraw(entries(5), "g", {
      format: "pools",
      thirdPlaceMode: "shared_bronze",
    });
    expect(avec).toEqual(sans);
  });
});

// ===================================================================
// LE PLAFOND, et son compte-rendu
// ===================================================================

describe("le repli d'une poule trop grosse", () => {
  it("bascule en élimination directe au-delà du plafond", () => {
    const draw = generateCategoryDraw(entries(7), "graine", {
      format: "pools",
      thirdPlaceMode: "pool3",
    });
    expect(draw.appliedFormat).toBe("single_elim");
  });

  it("RAPPORTE le repli, avec les deux volumes qui le justifient", () => {
    const draw = generateCategoryDraw(entries(16), "graine", {
      format: "pools",
      thirdPlaceMode: "pool3",
    });
    if (draw.appliedFormat !== "single_elim") throw new Error("repli attendu");
    expect(draw.fallback).toEqual({
      code: "pool-too-large",
      requestedFormat: "pools",
      appliedFormat: "single_elim",
      competitorCount: 16,
      maxPoolSize: 6,
      poolFightCount: 120,
      bracketFightCount: 15,
    });
    // Le chiffre qui motive la règle : huit fois la journée de tatami.
    expect(poolFightCount(16) / 15).toBe(8);
  });

  it("garde trace du format DEMANDÉ, pour que le repli soit lisible en aval", () => {
    const draw = generateCategoryDraw(entries(9), "graine", {
      format: "pools",
      thirdPlaceMode: "pool3",
    });
    expect(draw.requestedFormat).toBe("pools");
    expect(draw.appliedFormat).toBe("single_elim");
  });

  it("produit un vrai tableau, et non un refus : la compétition n'est jamais bloquée", () => {
    const draw = generateCategoryDraw(entries(24), "graine", {
      format: "pools",
      thirdPlaceMode: "shared_bronze",
    });
    if (draw.appliedFormat !== "single_elim") throw new Error("repli attendu");
    expect(draw.bracket.kind).toBe("bracket");
  });

  it("obéit à un plafond relevé par l'appelant", () => {
    const draw = generateCategoryDraw(entries(8), "graine", {
      format: "pools",
      thirdPlaceMode: "pool3",
      maxPoolSize: 8,
    });
    expect(draw.appliedFormat).toBe("pools");
    if (draw.appliedFormat !== "pools") throw new Error("poule attendue");
    if (draw.pool.kind !== "pool") throw new Error("poule attendue");
    expect(draw.pool.fights).toHaveLength(28);
  });
});

describe("resolveDrawFormat", () => {
  it("n'a rien à décider hors du format poule", () => {
    expect(resolveDrawFormat("single_elim", 200)).toEqual({ applied: "single_elim" });
  });

  it("accepte le plafond exact et refuse le suivant", () => {
    expect(resolveDrawFormat("pools", 6).applied).toBe("pools");
    expect(resolveDrawFormat("pools", 7).applied).toBe("single_elim");
    expect(resolveDrawFormat("pools", 7).fallback?.code).toBe("pool-too-large");
  });

  it("ne replie pas une catégorie d'un ou zéro inscrit : il n'y a pas de tirage", () => {
    expect(resolveDrawFormat("pools", 0)).toEqual({ applied: "pools" });
    expect(resolveDrawFormat("pools", 1)).toEqual({ applied: "pools" });
  });
});

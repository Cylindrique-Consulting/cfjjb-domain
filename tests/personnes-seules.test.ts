import { describe, expect, it } from "vitest";
import {
  MARQUE_PERSONNE_SEULE,
  ecartAvecLaReference,
  estPersonneSeule,
  referencesDesPersonnesSeules,
  type CategoriePourPersonneSeule,
} from "../src/personnes-seules";

const cat = (
  id: string,
  partiel: Partial<CategoriePourPersonneSeule> = {},
): CategoriePourPersonneSeule => ({
  id,
  discipline: "gi",
  ageGroup: "Adulte",
  gender: "male",
  belt: "blue",
  weightClass: "Leve",
  seulInscrit: false,
  aDesCombats: true,
  ...partiel,
});

const seule = (id: string, partiel: Partial<CategoriePourPersonneSeule> = {}) =>
  cat(id, { seulInscrit: true, aDesCombats: false, ...partiel });

const reference = (categories: CategoriePourPersonneSeule[], id: string) =>
  referencesDesPersonnesSeules(categories).get(id) ?? null;

describe("la catégorie de référence d'une personne seule", () => {
  it("prend le poids le plus proche, même âge, même ceinture, même genre", () => {
    const categories = [
      seule("medio", { weightClass: "Medio" }),
      cat("galo", { weightClass: "Galo" }),
      cat("pesado", { weightClass: "Pesado" }),
      cat("leve", { weightClass: "Leve" }),
    ];
    expect(reference(categories, "medio")).toBe("leve");
  });

  it("à écart de poids égal, prend la catégorie plus lourde, la suivante dans l'ordre", () => {
    const categories = [
      seule("leve", { weightClass: "Leve" }),
      cat("pena", { weightClass: "Pena" }),
      cat("medio", { weightClass: "Medio" }),
    ];
    expect(reference(categories, "leve")).toBe("medio");
  });

  it("prend la plus légère quand la personne seule est la plus lourde", () => {
    const categories = [
      seule("pesadissimo", { weightClass: "Pesadissimo" }),
      cat("pena", { weightClass: "Pena" }),
      cat("super", { weightClass: "Super Pesado" }),
    ];
    expect(reference(categories, "pesadissimo")).toBe("super");
  });

  it("préfère son genre, même si le poids est plus loin", () => {
    const categories = [
      seule("f-leve", { gender: "female", weightClass: "Leve" }),
      cat("h-leve", { gender: "male", weightClass: "Leve" }),
      cat("f-pesado", { gender: "female", weightClass: "Pesado" }),
    ];
    expect(reference(categories, "f-leve")).toBe("f-pesado");
  });

  it("à défaut de son genre, prend l'autre genre du même âge et de la même ceinture", () => {
    const categories = [
      seule("f-marron", { gender: "female", belt: "brown" }),
      cat("f-violette", { gender: "female", belt: "purple" }),
      cat("h-marron", { gender: "male", belt: "brown", weightClass: "Pesado" }),
    ];
    expect(reference(categories, "f-marron")).toBe("h-marron");
  });

  it("à défaut de même âge et même ceinture, prend la ceinture la plus proche du même âge", () => {
    const categories = [
      seule("noire", { belt: "black" }),
      cat("violette", { belt: "purple" }),
      cat("marron", { belt: "brown" }),
      cat("master-noire", { ageGroup: "Master 1", belt: "black" }),
    ];
    expect(reference(categories, "noire")).toBe("marron");
  });

  it("à défaut de toute catégorie de sa tranche, prend la tranche la plus proche", () => {
    const categories = [
      seule("m5", { ageGroup: "Master 5+", belt: "black" }),
      cat("adulte", { ageGroup: "Adulte", belt: "black" }),
      cat("m4", { ageGroup: "Master 4", belt: "black" }),
    ];
    expect(reference(categories, "m5")).toBe("m4");
  });

  it("reste dans sa discipline quand la compétition en mêle deux", () => {
    const categories = [
      seule("gi", { discipline: "gi", weightClass: "Leve" }),
      cat("nogi-leve", { discipline: "nogi", weightClass: "Leve" }),
      cat("gi-pesado", { discipline: "gi", weightClass: "Pesado" }),
    ];
    expect(reference(categories, "gi")).toBe("gi-pesado");
  });

  it("n'utilise ni un absolut, ni une autre personne seule, ni une catégorie sans combat", () => {
    const categories = [
      seule("leve", { weightClass: "Leve" }),
      seule("medio", { weightClass: "Medio" }),
      cat("absolut", { weightClass: "Absolut" }),
      cat("pena-sans-combat", { weightClass: "Pena", aDesCombats: false }),
      cat("pesadissimo", { weightClass: "Pesadissimo" }),
    ];
    const references = referencesDesPersonnesSeules(categories);
    expect(references.get("leve")).toBe("pesadissimo");
    expect(references.get("medio")).toBe("pesadissimo");
  });

  it("ne donne aucune référence à un absolut à un seul inscrit : il est annulé, pas convoqué", () => {
    const categories = [
      seule("absolut-leve", { ageGroup: "Juvénile", weightClass: "Absolut Leve" }),
      cat("juvenile-leve", { ageGroup: "Juvénile", weightClass: "Leve" }),
    ];
    expect(estPersonneSeule(categories[0]!)).toBe(false);
    expect(referencesDesPersonnesSeules(categories).has("absolut-leve")).toBe(false);
  });

  it("laisse sans référence une personne seule qu'aucune catégorie ne peut accueillir", () => {
    const categories = [seule("a"), seule("b", { weightClass: "Pesado" })];
    expect(referencesDesPersonnesSeules(categories).size).toBe(0);
  });

  it("lit le vocabulaire de la base (tranche et poids écrits autrement)", () => {
    const categories = [
      seule("medio", { ageGroup: "adulte", weightClass: "Médio" }),
      cat("meio", { ageGroup: "Adulte", weightClass: "Meio Pesado" }),
      cat("galo", { ageGroup: "Adulte", weightClass: "Galo" }),
    ];
    expect(reference(categories, "medio")).toBe("meio");
  });

  it("ne dépend pas de l'ordre des catégories", () => {
    const categories = [
      seule("f-leve", { gender: "female" }),
      cat("h-leve", { gender: "male" }),
      cat("h-medio", { gender: "male", weightClass: "Medio" }),
      cat("f-violette", { gender: "female", belt: "purple" }),
      seule("h-pena", { weightClass: "Pena" }),
    ];
    const attendu = referencesDesPersonnesSeules(categories);
    expect(Object.fromEntries(attendu)).toEqual({ "f-leve": "h-leve", "h-pena": "h-leve" });
    expect(Object.fromEntries(referencesDesPersonnesSeules([...categories].reverse()))).toEqual(
      Object.fromEntries(attendu),
    );
  });

  it("compare dans l'ordre : discipline, âge, ceinture, genre, poids", () => {
    const s = seule("s");
    expect(ecartAvecLaReference(s, cat("x"))).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(ecartAvecLaReference(s, cat("x", { weightClass: "Pena" }))).toEqual([
      0, 0, 0, 0, 1, 0, 0, 1,
    ]);
    expect(ecartAvecLaReference(s, cat("x", { gender: "female" }))).toEqual([
      0, 0, 0, 1, 0, 0, 0, 0,
    ]);
  });

  it("marque la personne seule d'un astérisque, comme le planning de l'IBJJF", () => {
    expect(MARQUE_PERSONNE_SEULE).toBe("*");
  });
});

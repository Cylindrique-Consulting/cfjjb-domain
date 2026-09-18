import { describe, expect, it } from "vitest";
import {
  comparerCategoriesSportives,
  estCategorieAbsolut,
  groupeDAbsolut,
  rangSportifDeCategorie,
  rangsDePlanning,
  trierCategoriesSportives,
} from "../src/ordre-sportif";

type Cat = {
  id: string;
  ageGroup: string;
  gender: "male" | "female";
  belt: string;
  weightClass: string;
  discipline?: "gi" | "nogi";
};

const cat = (id: string, partiel: Partial<Cat> = {}): Cat => ({
  id,
  ageGroup: "Adulte",
  gender: "male",
  belt: "white",
  weightClass: "Pena",
  ...partiel,
});

describe("l'ordre sportif des catégories", () => {
  it("classe par tranche d'âge, des enfants aux masters", () => {
    const ordre = trierCategoriesSportives([
      cat("master2", { ageGroup: "Master 2" }),
      cat("adulte", { ageGroup: "Adulte" }),
      cat("u9", { ageGroup: "U9" }),
      cat("juvenile", { ageGroup: "Juvénile" }),
    ]).map((c) => c.id);
    expect(ordre).toEqual(["u9", "juvenile", "adulte", "master2"]);
  });

  it("classe les femmes avant les hommes, à tranche égale", () => {
    const ordre = trierCategoriesSportives([
      cat("homme", { gender: "male" }),
      cat("femme", { gender: "female" }),
    ]).map((c) => c.id);
    expect(ordre).toEqual(["femme", "homme"]);
  });

  it("classe les ceintures de la blanche à la noire", () => {
    const ordre = trierCategoriesSportives([
      cat("noire", { belt: "black" }),
      cat("blanche", { belt: "white" }),
      cat("violette", { belt: "purple" }),
      cat("bleue", { belt: "blue" }),
    ]).map((c) => c.id);
    expect(ordre).toEqual(["blanche", "bleue", "violette", "noire"]);
  });

  it("classe les poids du plus léger au plus lourd", () => {
    const ordre = trierCategoriesSportives([
      cat("pesado", { weightClass: "Pesado" }),
      cat("galo", { weightClass: "Galo" }),
      cat("medio", { weightClass: "Medio" }),
    ]).map((c) => c.id);
    expect(ordre).toEqual(["galo", "medio", "pesado"]);
  });

  it("place l'absolut après les catégories de poids de sa tranche", () => {
    const ordre = trierCategoriesSportives([
      cat("absolut", { weightClass: "Absolut" }),
      cat("pesadissimo", { weightClass: "Pesadissimo" }),
      cat("galo", { weightClass: "Galo" }),
    ]).map((c) => c.id);
    expect(ordre).toEqual(["galo", "pesadissimo", "absolut"]);
  });

  it("classe Absolut Leve avant Absolut Pesado chez les juvéniles", () => {
    const ordre = trierCategoriesSportives([
      cat("pesado", { ageGroup: "Juvénile", belt: "blue", weightClass: "Absolut Pesado" }),
      cat("leve", { ageGroup: "Juvénile", belt: "blue", weightClass: "Absolut Leve" }),
      cat("poids", { ageGroup: "Juvénile", belt: "blue", weightClass: "Leve" }),
    ]).map((c) => c.id);
    expect(ordre).toEqual(["poids", "leve", "pesado"]);
  });

  it("ne comporte aucun critère de discipline : deux jumelles restent dans l'ordre d'entrée", () => {
    const gi = cat("gi", { discipline: "gi" });
    const nogi = cat("nogi", { discipline: "nogi" });
    expect(comparerCategoriesSportives(gi, nogi)).toBe(0);
    expect(trierCategoriesSportives([nogi, gi]).map((c) => c.id)).toEqual(["nogi", "gi"]);
  });

  it("classe l'âge avant le genre, et le genre avant la ceinture", () => {
    const ordre = trierCategoriesSportives([
      cat("adulte-homme-blanche", { ageGroup: "Adulte", gender: "male", belt: "white" }),
      cat("adulte-femme-noire", { ageGroup: "Adulte", gender: "female", belt: "black" }),
      cat("u15-homme-noire", { ageGroup: "U15", gender: "male", belt: "grey" }),
    ]).map((c) => c.id);
    expect(ordre).toEqual(["u15-homme-noire", "adulte-femme-noire", "adulte-homme-blanche"]);
  });

  it("accepte les codes de la base, pas seulement les libellés", () => {
    expect(rangSportifDeCategorie({ ageGroup: "adult" })[0]).toBe(
      rangSportifDeCategorie({ ageGroup: "Adulte" })[0],
    );
    expect(rangSportifDeCategorie({ ageGroup: "u11" })[0]).toBe(
      rangSportifDeCategorie({ ageGroup: "U11" })[0],
    );
  });

  it("renvoie une valeur inconnue en fin de liste plutôt que de casser", () => {
    const ordre = trierCategoriesSportives([
      cat("inconnue", { ageGroup: "Tranche fantôme" }),
      cat("u7", { ageGroup: "U7" }),
    ]).map((c) => c.id);
    expect(ordre).toEqual(["u7", "inconnue"]);
  });

  it("reconnaît les libellés d'absolut", () => {
    expect(estCategorieAbsolut("Absolut")).toBe(true);
    expect(estCategorieAbsolut("absolut leve")).toBe(true);
    expect(estCategorieAbsolut("Pena")).toBe(false);
    expect(estCategorieAbsolut(null)).toBe(false);
    expect(groupeDAbsolut("Absolut Leve")).toBe("Leve");
    expect(groupeDAbsolut("Absolut Pesado")).toBe("Pesado");
    expect(groupeDAbsolut("Absolut")).toBeNull();
    expect(groupeDAbsolut("Leve")).toBeNull();
  });

  it("numérote les rangs de planning de 0 à n-1, sans trou", () => {
    const rangs = rangsDePlanning([
      cat("c3", { weightClass: "Pesado" }),
      cat("c1", { weightClass: "Galo" }),
      cat("c2", { weightClass: "Pena" }),
    ]);
    expect([...rangs.entries()].sort()).toEqual([
      ["c1", 0],
      ["c2", 1],
      ["c3", 2],
    ]);
  });

  it("ne mélange jamais deux catégories réellement distinctes", () => {
    const toutes = [
      cat("a", { ageGroup: "U7", gender: "female", belt: "white", weightClass: "Galo" }),
      cat("b", { ageGroup: "U7", gender: "female", belt: "white", weightClass: "Pluma" }),
      cat("c", { ageGroup: "U7", gender: "female", belt: "grey", weightClass: "Galo" }),
      cat("d", { ageGroup: "U7", gender: "male", belt: "white", weightClass: "Galo" }),
      cat("e", { ageGroup: "U9", gender: "female", belt: "white", weightClass: "Galo" }),
    ];
    for (const gauche of toutes) {
      for (const droite of toutes) {
        if (gauche.id === droite.id) continue;
        expect(comparerCategoriesSportives(gauche, droite)).not.toBe(0);
      }
    }
  });
});

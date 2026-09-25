import { describe, expect, it } from "vitest";
import {
  cleDeDepart,
  comparerPourLeDepart,
  rangTatamiPrioritaire,
  trierPourLeDepart,
  vagueDeCeinture,
  type CategoriePourPriorite,
} from "../src/priorite-de-planning";

const categorie = (
  id: string,
  partiel: Partial<CategoriePourPriorite> = {},
): CategoriePourPriorite => ({
  id,
  discipline: "gi",
  ageGroup: "Adulte",
  belt: "blue",
  weightClass: "Leve",
  dureePrevueSecondes: 3600,
  ...partiel,
});

const ids = (categories: readonly CategoriePourPriorite[]) =>
  trierPourLeDepart(categories).map((c) => c.id);

describe("la vague de ceinture (ORD.1 A)", () => {
  it("fait partir les bleues et les noires, puis les violettes et les marrons, puis les blanches", () => {
    expect(vagueDeCeinture("blue")).toBe(0);
    expect(vagueDeCeinture("black")).toBe(0);
    expect(vagueDeCeinture("purple")).toBe(1);
    expect(vagueDeCeinture("brown")).toBe(1);
    expect(vagueDeCeinture("white")).toBe(2);
  });

  it("range corail et rouge avec les noires, et les ceintures Kids dans la première vague", () => {
    for (const belt of ["coral", "red", "grey", "yellow", "orange", "green"]) {
      expect(vagueDeCeinture(belt), belt).toBe(0);
    }
  });

  it("lit le code de la base sans casse ni espaces, et renvoie une ceinture inconnue avec les blanches", () => {
    expect(vagueDeCeinture(" Blue ")).toBe(0);
    expect(vagueDeCeinture("PURPLE")).toBe(1);
    expect(vagueDeCeinture("")).toBe(2);
    expect(vagueDeCeinture("bleue")).toBe(2);
  });
});

describe("la liste du §8 : qui prend les meilleurs tatamis (ORD.1 A, ORD.4 A)", () => {
  it("suit la liste du client, de la noire adulte (1) aux Kids (12)", () => {
    const liste: [string, string, number][] = [
      ["Adulte", "black", 1],
      ["Adulte", "brown", 2],
      ["Adulte", "purple", 3],
      ["Adulte", "blue", 4],
      ["Master 1", "black", 5],
      ["Master 3", "brown", 6],
      ["Master 5+", "purple", 7],
      ["Master 2", "blue", 8],
      ["Adulte", "white", 9],
      ["Master 4", "white", 10],
      ["Juvénile", "blue", 11],
      ["Juvénile", "white", 11],
      ["U7", "grey", 12],
      ["U11", "white", 12],
      ["U15", "green", 12],
    ];
    for (const [ageGroup, belt, rang] of liste) {
      expect(rangTatamiPrioritaire({ ageGroup, belt }), `${ageGroup} ${belt}`).toBe(rang);
    }
  });

  it("traite corail et rouge comme la noire", () => {
    expect(rangTatamiPrioritaire({ ageGroup: "Master 5+", belt: "coral" })).toBe(5);
    expect(rangTatamiPrioritaire({ ageGroup: "Master 5+", belt: "red" })).toBe(5);
  });

  it("lit les codes d'âge de la base", () => {
    expect(rangTatamiPrioritaire({ ageGroup: "adult", belt: "black" })).toBe(1);
    expect(rangTatamiPrioritaire({ ageGroup: "master_3_4", belt: "black" })).toBe(5);
    expect(rangTatamiPrioritaire({ ageGroup: "juvenil", belt: "purple" })).toBe(11);
    expect(rangTatamiPrioritaire({ ageGroup: "u9", belt: "grey" })).toBe(12);
  });

  it("met une tranche d'âge ou une ceinture inconnue après les Kids", () => {
    expect(rangTatamiPrioritaire({ ageGroup: "master", belt: "black" })).toBe(13);
    expect(rangTatamiPrioritaire({ ageGroup: "Adulte", belt: "grey" })).toBe(13);
    expect(rangTatamiPrioritaire({ ageGroup: "", belt: "" })).toBe(13);
  });
});

describe("la clé de départ", () => {
  it("compose ses sept rangs dans l'ordre du contrat", () => {
    expect(
      cleDeDepart(
        categorie("a", { belt: "black", weightClass: "Pena", dureePrevueSecondes: 1800 }),
      ),
    ).toEqual([1, 0, 1, 0, 0, -1800, 2]);
    expect(
      cleDeDepart(
        categorie("k", {
          discipline: "nogi",
          ageGroup: "U11",
          belt: "yellow",
          weightClass: "Galo",
          dureePrevueSecondes: 600,
        }),
      ),
    ).toEqual([0, 1, 2, 0, 1, -600, 0]);
    expect(
      cleDeDepart(
        categorie("j", {
          ageGroup: "Juvénile",
          belt: "white",
          weightClass: "Pesadissimo",
          dureePrevueSecondes: 0,
        }),
      ),
    ).toEqual([1, 0, 0, 2, 1, 0, 8]);
  });

  it("lit la classe de poids stockée en index, et range un poids inconnu après le plus lourd", () => {
    expect(cleDeDepart(categorie("i", { weightClass: "3" }))[6]).toBe(3);
    expect(cleDeDepart(categorie("abs", { weightClass: "Absolut Leve" }))[6]).toBe(9);
  });

  it("ne tient pas compte du sexe", () => {
    const homme = { ...categorie("h"), gender: "male" };
    const femme = { ...categorie("f"), gender: "female" };
    expect(cleDeDepart(homme)).toEqual(cleDeDepart(femme));
    expect(ids([homme, femme])).toEqual(["f", "h"]);
  });

  it("compte une durée prévue illisible comme nulle", () => {
    expect(cleDeDepart(categorie("n", { dureePrevueSecondes: Number.NaN }))[5]).toBe(0);
  });
});

describe("l'ordre de départ", () => {
  it("fait partir les Kids en premier, Kids Gi puis Kids No-Gi, puis le Gi, puis le No-Gi (JRS.4 A, SEP.4 A)", () => {
    expect(
      ids([
        categorie("nogi-adulte-noire", { discipline: "nogi", belt: "black" }),
        categorie("gi-adulte-blanche", { belt: "white" }),
        categorie("kids-nogi", { discipline: "nogi", ageGroup: "U9", belt: "grey" }),
        categorie("gi-adulte-noire", { belt: "black" }),
        categorie("kids-gi", { ageGroup: "U13", belt: "green" }),
      ]),
    ).toEqual([
      "kids-gi",
      "kids-nogi",
      "gi-adulte-noire",
      "gi-adulte-blanche",
      "nogi-adulte-noire",
    ]);
  });

  it("chez les Kids, les plus jeunes d'abord ; la taille ne départage qu'à âge égal, la ceinture jamais (ORD.6 B)", () => {
    expect(
      ids([
        categorie("u15-longue", { ageGroup: "U15", belt: "green", dureePrevueSecondes: 7200 }),
        categorie("u7", { ageGroup: "U7", belt: "grey", dureePrevueSecondes: 600 }),
        categorie("u11-courte", { ageGroup: "U11", belt: "yellow", dureePrevueSecondes: 600 }),
        categorie("u11-longue-blanche", {
          ageGroup: "U11",
          belt: "white",
          dureePrevueSecondes: 1800,
        }),
      ]),
    ).toEqual(["u7", "u11-longue-blanche", "u11-courte", "u15-longue"]);
  });

  it("place les juvéniles en début de programme, avant les adultes et les Masters (ORD.5 C)", () => {
    expect(
      ids([
        categorie("adulte-noire", { belt: "black" }),
        categorie("master-bleue", { ageGroup: "Master 2" }),
        categorie("juvenile-blanche", { ageGroup: "Juvénile", belt: "white" }),
      ]),
    ).toEqual(["juvenile-blanche", "adulte-noire", "master-bleue"]);
  });

  it("fait partir chaque vague de ceinture, Masters compris, avant la suivante (ORD.1 A, ORD.4 A)", () => {
    expect(
      ids([
        categorie("adulte-blanche", { belt: "white", dureePrevueSecondes: 9000 }),
        categorie("master-blanche", { ageGroup: "Master 1", belt: "white" }),
        categorie("adulte-marron", { belt: "brown", dureePrevueSecondes: 8000 }),
        categorie("master-violette", { ageGroup: "Master 3", belt: "purple" }),
        categorie("master-bleue", { ageGroup: "Master 1", dureePrevueSecondes: 5000 }),
        categorie("adulte-bleue", { dureePrevueSecondes: 4000 }),
        categorie("master-noire", {
          ageGroup: "Master 2",
          belt: "black",
          dureePrevueSecondes: 600,
        }),
        categorie("adulte-noire", { belt: "black", dureePrevueSecondes: 300 }),
      ]),
    ).toEqual([
      "adulte-noire",
      "master-bleue",
      "adulte-bleue",
      "master-noire",
      "adulte-marron",
      "master-violette",
      "adulte-blanche",
      "master-blanche",
    ]);
  });

  it("à priorité égale, fait partir la catégorie de plus longue durée prévue (ORD.7 B)", () => {
    expect(
      ids([
        categorie("courte", { dureePrevueSecondes: 1200 }),
        categorie("longue", { dureePrevueSecondes: 5400 }),
        categorie("moyenne", { dureePrevueSecondes: 3000 }),
      ]),
    ).toEqual(["longue", "moyenne", "courte"]);
  });

  it("à durée égale, va du plus léger au plus lourd, hommes et femmes mêlés (ORD.11 B)", () => {
    const avecLeSexe = [
      { ...categorie("h-pesado", { weightClass: "Pesado" }), gender: "male" },
      { ...categorie("f-galo", { weightClass: "Galo" }), gender: "female" },
      { ...categorie("h-galo", { weightClass: "Galo" }), gender: "male" },
      { ...categorie("f-medio", { weightClass: "Medio" }), gender: "female" },
    ];
    expect(ids(avecLeSexe)).toEqual(["f-galo", "h-galo", "f-medio", "h-pesado"]);
  });

  it("départage par identifiant, rend une copie et garde les champs de l'appelant", () => {
    const entree = [
      { ...categorie("b"), libelle: "B" },
      { ...categorie("a"), libelle: "A" },
    ];
    const triees = trierPourLeDepart(entree);
    expect(triees.map((c) => c.libelle)).toEqual(["A", "B"]);
    expect(entree.map((c) => c.id)).toEqual(["b", "a"]);
    expect(triees).not.toBe(entree);
  });

  it("compare comme il trie, et rend le même ordre quel que soit l'ordre reçu", () => {
    const categories = [
      categorie("k", { ageGroup: "U9", belt: "grey" }),
      categorie("n", { belt: "black" }),
      categorie("b", { belt: "white" }),
      categorie("v", { belt: "purple", discipline: "nogi" }),
      categorie("j", { ageGroup: "Juvénile" }),
    ];
    const attendu = ids(categories);
    expect([...categories].sort(comparerPourLeDepart).map((c) => c.id)).toEqual(attendu);
    expect(ids([...categories].reverse())).toEqual(attendu);
    expect(comparerPourLeDepart(categorie("x"), categorie("x"))).toBe(0);
  });
});

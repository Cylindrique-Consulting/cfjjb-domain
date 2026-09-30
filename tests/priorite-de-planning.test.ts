import { describe, expect, it } from "vitest";
import {
  GROUPE_DE_DEPART_INCONNU,
  cleDeDepart,
  comparerPourLeDepart,
  groupeDeDepart,
  rangTatamiPrioritaire,
  trierPourLeDepart,
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

describe("les groupes de départ (décision du client du 30/09/2026)", () => {
  it("range les huit groupes dans l'ordre de la décision", () => {
    const liste: [string, string, number][] = [
      ["Adulte", "white", 0],
      ["Adulte", "blue", 1],
      ["Juvénile", "blue", 2],
      ["Adulte", "purple", 3],
      ["Adulte", "brown", 3],
      ["Adulte", "black", 3],
      ["Master 1", "purple", 4],
      ["Master 3", "brown", 4],
      ["Master 5+", "black", 4],
      ["Master 2", "blue", 5],
      ["Juvénile", "white", 6],
      ["Master 1", "white", 7],
      ["Master 4", "white", 7],
    ];
    for (const [ageGroup, belt, groupe] of liste) {
      expect(groupeDeDepart({ ageGroup, belt }), `${ageGroup} ${belt}`).toBe(groupe);
    }
  });

  it("range corail et rouge avec les noires, et une ceinture de couleur Kids avec les bleues", () => {
    expect(groupeDeDepart({ ageGroup: "Adulte", belt: "coral" })).toBe(3);
    expect(groupeDeDepart({ ageGroup: "Master 5+", belt: "red" })).toBe(4);
    expect(groupeDeDepart({ ageGroup: "Juvénile", belt: "green" })).toBe(2);
    expect(groupeDeDepart({ ageGroup: "Juvénile", belt: "purple" })).toBe(2);
  });

  it("lit les codes de la base, sans casse ni espaces", () => {
    expect(groupeDeDepart({ ageGroup: "adult", belt: " White " })).toBe(0);
    expect(groupeDeDepart({ ageGroup: "juvenil", belt: "BLUE" })).toBe(2);
    expect(groupeDeDepart({ ageGroup: "master_3_4", belt: "white" })).toBe(7);
  });

  it("met une tranche d'âge ou une ceinture inconnue après les huit groupes", () => {
    expect(GROUPE_DE_DEPART_INCONNU).toBe(8);
    expect(groupeDeDepart({ ageGroup: "", belt: "white" })).toBe(GROUPE_DE_DEPART_INCONNU);
    expect(groupeDeDepart({ ageGroup: "Adulte", belt: "bleue" })).toBe(GROUPE_DE_DEPART_INCONNU);
    expect(groupeDeDepart({ ageGroup: "Juvénile", belt: "" })).toBe(GROUPE_DE_DEPART_INCONNU);
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
  it("compose ses cinq rangs dans l'ordre du contrat", () => {
    expect(
      cleDeDepart(
        categorie("a", { belt: "black", weightClass: "Pena", dureePrevueSecondes: 1800 }),
      ),
    ).toEqual([1, 0, 3, -1800, 2]);
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
    ).toEqual([0, 1, 2, -600, 0]);
    expect(
      cleDeDepart(
        categorie("j", {
          ageGroup: "Juvénile",
          belt: "white",
          weightClass: "Pesadissimo",
          dureePrevueSecondes: 0,
        }),
      ),
    ).toEqual([1, 0, 6, 0, 8]);
  });

  it("lit la classe de poids stockée en index, et range un poids inconnu après le plus lourd", () => {
    expect(cleDeDepart(categorie("i", { weightClass: "3" }))[4]).toBe(3);
    expect(cleDeDepart(categorie("abs", { weightClass: "Absolut Leve" }))[4]).toBe(9);
  });

  it("ne tient pas compte du sexe", () => {
    const homme = { ...categorie("h"), gender: "male" };
    const femme = { ...categorie("f"), gender: "female" };
    expect(cleDeDepart(homme)).toEqual(cleDeDepart(femme));
    expect(ids([homme, femme])).toEqual(["f", "h"]);
  });

  it("compte une durée prévue illisible comme nulle", () => {
    expect(cleDeDepart(categorie("n", { dureePrevueSecondes: Number.NaN }))[3]).toBe(0);
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
      "gi-adulte-blanche",
      "gi-adulte-noire",
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

  it("fait partir les huit groupes dans l'ordre de la décision, quelle que soit leur durée", () => {
    expect(
      ids([
        categorie("master-blanche", {
          ageGroup: "Master 1",
          belt: "white",
          dureePrevueSecondes: 9000,
        }),
        categorie("juvenile-blanche", {
          ageGroup: "Juvénile",
          belt: "white",
          dureePrevueSecondes: 8500,
        }),
        categorie("master-bleue", { ageGroup: "Master 2", dureePrevueSecondes: 8000 }),
        categorie("master-violette", {
          ageGroup: "Master 3",
          belt: "purple",
          dureePrevueSecondes: 7500,
        }),
        categorie("adulte-noire", { belt: "black", dureePrevueSecondes: 7000 }),
        categorie("juvenile-bleue", { ageGroup: "Juvénile", dureePrevueSecondes: 6500 }),
        categorie("adulte-bleue", { dureePrevueSecondes: 6000 }),
        categorie("adulte-blanche", { belt: "white", dureePrevueSecondes: 300 }),
      ]),
    ).toEqual([
      "adulte-blanche",
      "adulte-bleue",
      "juvenile-bleue",
      "adulte-noire",
      "master-violette",
      "master-bleue",
      "juvenile-blanche",
      "master-blanche",
    ]);
  });

  it("ne place plus les juvéniles en tête : les bleues juvéniles après les bleues adultes, les blanches juvéniles après les bleues Masters", () => {
    expect(
      ids([
        categorie("juvenile-blanche", { ageGroup: "Juvénile", belt: "white" }),
        categorie("master-bleue", { ageGroup: "Master 2" }),
        categorie("juvenile-bleue", { ageGroup: "Juvénile" }),
        categorie("adulte-bleue"),
      ]),
    ).toEqual(["adulte-bleue", "juvenile-bleue", "master-bleue", "juvenile-blanche"]);
  });

  it("mêle violettes, marrons et noires dans leur groupe, la plus longue d'abord (ORD.7 B)", () => {
    expect(
      ids([
        categorie("noire-courte", { belt: "black", dureePrevueSecondes: 1200 }),
        categorie("violette-moyenne", { belt: "purple", dureePrevueSecondes: 2400 }),
        categorie("marron-longue", { belt: "brown", dureePrevueSecondes: 3600 }),
        categorie("master-noire-longue", {
          ageGroup: "Master 1",
          belt: "black",
          dureePrevueSecondes: 9000,
        }),
      ]),
    ).toEqual(["marron-longue", "violette-moyenne", "noire-courte", "master-noire-longue"]);
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

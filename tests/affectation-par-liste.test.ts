import { describe, expect, it } from "vitest";
import {
  affecterParListe,
  type AffectationParListe,
  type CategorieAAffecterParListe,
  type TatamiParListe,
} from "../src/affectation-par-liste";
import { rangsDeQualiteParDefaut } from "../src/hierarchie-tatamis";

const categorie = (
  id: string,
  partiel: Partial<CategorieAAffecterParListe> = {},
): CategorieAAffecterParListe => {
  const dureePrevueSecondes = partiel.dureePrevueSecondes ?? 3600;
  return {
    id,
    discipline: "gi",
    ageGroup: "Adulte",
    belt: "blue",
    weightClass: "Leve",
    dureePrevueSecondes,
    chargeSecondes: dureePrevueSecondes,
    parties: 1,
    ...partiel,
  };
};

const salle = (nombre: number, libres: Readonly<Record<number, number>> = {}): TatamiParListe[] => {
  const numeros = Array.from({ length: nombre }, (_, index) => index + 1);
  const qualite = rangsDeQualiteParDefaut(numeros);
  return numeros.map((numero) => ({
    id: `t${numero}`,
    numero,
    rangQualite: qualite.get(numero) ?? 99,
    ...(libres[numero] === undefined ? {} : { libreDesSecondes: libres[numero] }),
  }));
};

const lire = (affectations: Map<string, AffectationParListe>) =>
  Object.fromEntries(
    [...affectations.values()].map((a) => [
      a.categorieId,
      `${a.tatamiIds.join("+")} ${a.debutSecondes}-${a.finSecondes} #${a.rangDePlanning}`,
    ]),
  );

describe("l'affectation par liste (ORD.1 A, ORD.8 A)", () => {
  it("à 9 h, donne les meilleurs tatamis aux noires adultes et les autres aux bleues, puis chaque tatami libéré prend la suivante", () => {
    const affectations = affecterParListe(
      [
        categorie("bleue-d", { dureePrevueSecondes: 1800 }),
        categorie("blanche", { belt: "white", dureePrevueSecondes: 5000 }),
        categorie("noire-b", { belt: "black", dureePrevueSecondes: 2400 }),
        categorie("bleue-a", { dureePrevueSecondes: 3600 }),
        categorie("violette", { belt: "purple", dureePrevueSecondes: 4000 }),
        categorie("bleue-c", { dureePrevueSecondes: 2400 }),
        categorie("noire-a", { belt: "black", dureePrevueSecondes: 3000 }),
        categorie("bleue-b", { dureePrevueSecondes: 3000 }),
      ],
      salle(6),
    );
    expect(lire(affectations)).toEqual({
      "noire-a": "t1 0-3000 #0",
      "noire-b": "t6 0-2400 #1",
      "bleue-a": "t2 0-3600 #2",
      "bleue-b": "t5 0-3000 #3",
      "bleue-c": "t3 0-2400 #4",
      "bleue-d": "t4 0-1800 #5",
      violette: "t4 1800-5800 #6",
      blanche: "t6 2400-7400 #7",
    });
  });

  it("donne à une bleue le meilleur tatami qu'aucune noire ne prend", () => {
    const affectations = affecterParListe(
      [
        categorie("noire", { belt: "black" }),
        categorie("bleue-1", { dureePrevueSecondes: 3500 }),
        categorie("bleue-2", { dureePrevueSecondes: 3400 }),
      ],
      salle(4),
    );
    expect(affectations.get("noire")?.tatamiIds).toEqual(["t1"]);
    expect(affectations.get("bleue-1")?.tatamiIds).toEqual(["t4"]);
    expect(affectations.get("bleue-2")?.tatamiIds).toEqual(["t2"]);
  });

  it("fait partir les Masters au moment de leur ceinture, mais laisse les meilleurs tatamis aux adultes (ORD.4 A)", () => {
    const affectations = affecterParListe(
      [
        categorie("adulte-bleue", { dureePrevueSecondes: 1000 }),
        categorie("master-noire", {
          ageGroup: "Master 1",
          belt: "black",
          dureePrevueSecondes: 4000,
        }),
      ],
      [
        { id: "central", numero: 2, rangQualite: 2 },
        { id: "bord", numero: 1, rangQualite: 1 },
      ],
    );
    expect(lire(affectations)).toEqual({
      "master-noire": "central 0-4000 #0",
      "adulte-bleue": "bord 0-1000 #1",
    });
  });

  it("fait attendre une catégorie répartie que ses tatamis soient libres, et partage sa charge entre eux", () => {
    const affectations = affecterParListe(
      [
        categorie("bleue", { chargeSecondes: 4800, parties: 4 }),
        categorie("noire", { belt: "black", chargeSecondes: 1200 }),
      ],
      salle(4),
    );
    expect(lire(affectations)).toEqual({
      noire: "t1 0-1200 #0",
      bleue: "t1+t2+t3+t4 1200-2400 #1",
    });
  });

  it("ne double jamais la file : une catégorie qui tiendrait sur un tatami libre attend son tour (ORD.8 A)", () => {
    const affectations = affecterParListe(
      [
        categorie("petite", { dureePrevueSecondes: 600, chargeSecondes: 600 }),
        categorie("grande", { dureePrevueSecondes: 5000, chargeSecondes: 2000, parties: 2 }),
        categorie("noire", { belt: "black", chargeSecondes: 2000, parties: 2 }),
      ],
      salle(3),
    );
    expect(lire(affectations)).toEqual({
      noire: "t1+t3 0-1000 #0",
      grande: "t1+t2 1000-2000 #1",
      petite: "t3 1000-1600 #2",
    });
  });

  it("forme un lot des catégories de tête qui tiennent ensemble dans les tatamis libres", () => {
    const affectations = affecterParListe(
      [
        categorie("noire", { belt: "black", chargeSecondes: 2000, parties: 2 }),
        categorie("bleue-1", { dureePrevueSecondes: 4000 }),
        categorie("bleue-2", { dureePrevueSecondes: 3000, parties: 2, chargeSecondes: 3000 }),
      ],
      salle(4),
    );
    expect(lire(affectations)).toEqual({
      noire: "t1+t4 0-1000 #0",
      "bleue-1": "t2 0-4000 #1",
      "bleue-2": "t1+t3 1000-2500 #2",
    });
  });

  it("part de l'heure à laquelle chaque tatami se libère", () => {
    const affectations = affecterParListe(
      [categorie("premiere", { dureePrevueSecondes: 5000 }), categorie("seconde")],
      salle(2, { 1: 600, 2: 0 }),
    );
    expect(lire(affectations)).toEqual({
      premiere: "t2 0-5000 #0",
      seconde: "t1 600-4200 #1",
    });
  });

  it("plafonne les parties au nombre de tatamis, et compte une valeur illisible pour une", () => {
    const affectations = affecterParListe(
      [
        categorie("huit", { chargeSecondes: 1600, parties: 8, dureePrevueSecondes: 9000 }),
        categorie("zero", { chargeSecondes: 500, parties: 0 }),
        categorie("nan", { chargeSecondes: 400, parties: Number.NaN }),
      ],
      salle(2),
    );
    expect(lire(affectations)).toEqual({
      huit: "t1+t2 0-800 #0",
      nan: "t1 800-1200 #1",
      zero: "t2 800-1300 #2",
    });
  });

  it("rend la même affectation quel que soit l'ordre des catégories et des tatamis reçus", () => {
    const categories = [
      categorie("kids", { ageGroup: "U11", belt: "grey", dureePrevueSecondes: 900 }),
      categorie("noire", { belt: "black", parties: 2, chargeSecondes: 3000 }),
      categorie("bleue", { dureePrevueSecondes: 2500 }),
      categorie("marron", { belt: "brown", dureePrevueSecondes: 2000 }),
      categorie("blanche", { belt: "white", parties: 3, chargeSecondes: 6000 }),
      categorie("juvenile", { ageGroup: "Juvénile", dureePrevueSecondes: 1500 }),
    ];
    const tatamis = salle(5);
    const attendu = lire(affecterParListe(categories, tatamis));
    expect(lire(affecterParListe([...categories].reverse(), [...tatamis].reverse()))).toEqual(
      attendu,
    );
    expect(Object.keys(attendu)).toHaveLength(6);
  });

  it("n'occupe jamais un tatami deux fois au même instant, et fait partir la file dans l'ordre", () => {
    const categories = Array.from({ length: 40 }, (_, index) =>
      categorie(`c${index}`, {
        belt: ["black", "blue", "purple", "brown", "white"][index % 5] ?? "blue",
        ageGroup: ["Adulte", "Master 1", "Juvénile", "U13"][index % 4] ?? "Adulte",
        dureePrevueSecondes: 600 + ((index * 379) % 3000),
        chargeSecondes: 600 + ((index * 379) % 3000),
        parties: [1, 1, 2, 3, 1, 4][index % 6] ?? 1,
      }),
    );
    const affectations = affecterParListe(categories, salle(6));
    expect(affectations.size).toBe(40);
    const creneaux = new Map<string, [number, number][]>();
    for (const affectation of affectations.values()) {
      for (const tatamiId of affectation.tatamiIds) {
        const liste = creneaux.get(tatamiId) ?? [];
        liste.push([affectation.debutSecondes, affectation.finSecondes]);
        creneaux.set(tatamiId, liste);
      }
    }
    for (const [tatamiId, liste] of creneaux) {
      liste.sort((a, b) => a[0] - b[0]);
      for (let index = 1; index < liste.length; index += 1) {
        expect(liste[index]?.[0] ?? 0, tatamiId).toBeGreaterThanOrEqual(liste[index - 1]?.[1] ?? 0);
      }
    }
    const dansLaFile = [...affectations.values()].sort(
      (a, b) => a.rangDePlanning - b.rangDePlanning,
    );
    expect(dansLaFile.map((a) => a.rangDePlanning)).toEqual(
      Array.from({ length: 40 }, (_, index) => index),
    );
    for (let index = 1; index < dansLaFile.length; index += 1) {
      const precedente = dansLaFile[index - 1];
      const suivante = dansLaFile[index];
      if (precedente === undefined || suivante === undefined) continue;
      expect(
        suivante.debutSecondes,
        `${suivante.categorieId} ne part pas avant ${precedente.categorieId}`,
      ).toBeGreaterThanOrEqual(precedente.debutSecondes);
    }
  });

  it("refuse une compétition sans tatami", () => {
    expect(() => affecterParListe([categorie("c")], [])).toThrow(/au moins un tatami/);
  });

  it("rend une affectation vide sans catégorie", () => {
    expect(affecterParListe([], salle(3)).size).toBe(0);
  });
});

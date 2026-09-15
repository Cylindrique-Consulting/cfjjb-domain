import { describe, expect, it } from "vitest";
import { generateBracket, type BracketEntry, type GeneratedFight } from "../src/bracket-generator";
import { divisionMaxDuTableau, nomDuTour } from "../src/round-names";

// ===================================================================
// LA NOMENCLATURE DES TOURS (CI4, TR2) — réponses du client du 15/09/2026.
//
// T16.1 A : T1, T2… comptés depuis le premier tour réellement disputé, QF, DF,
// F en abrégé ; forme longue sur les écrans d'un seul combat, les arbres et les
// feuilles. TR2.1 A : « Repêchage » ne sort sur aucun écran.
// ===================================================================

function entrees(n: number): BracketEntry[] {
  return Array.from({ length: n }, (_, i) => ({ registrationId: `r${i + 1}`, clubId: null }));
}

function tirage(n: number): GeneratedFight[] {
  const res = generateBracket(entrees(n), `graine-${n}`, { thirdPlaceMode: "pool3" });
  if (res.kind !== "bracket") throw new Error(`n=${n} ne produit pas de tableau`);
  return res.fights;
}

/** Les tours ordinaires d'un tableau, du premier à la finale, en forme courte. */
function toursCourts(profondeur: number): string[] {
  const out: string[] = [];
  for (let d = profondeur; d >= 1; d--) {
    out.push(nomDuTour({ division: d, divisionMax: profondeur, type: "BraketFight" }).court);
  }
  return out;
}

describe("la forme courte, comptée depuis le premier tour du tableau", () => {
  it("tableau de 128 (test du client) : T1, T2, T3, T4, QF, DF, F", () => {
    expect(toursCourts(7)).toEqual(["T1", "T2", "T3", "T4", "QF", "DF", "F"]);
  });

  it("16 : T1, QF, DF, F ; 8 : QF, DF, F ; 4 : DF, F ; 2 : F", () => {
    expect(toursCourts(5)).toEqual(["T1", "T2", "QF", "DF", "F"]);
    expect(toursCourts(4)).toEqual(["T1", "QF", "DF", "F"]);
    expect(toursCourts(3)).toEqual(["QF", "DF", "F"]);
    expect(toursCourts(2)).toEqual(["DF", "F"]);
    expect(toursCourts(1)).toEqual(["F"]);
  });

  it("sur de VRAIS tirages : la division maximale vient de toutes les lignes, byes compris", () => {
    const attendus: Record<number, string[]> = {
      2: ["F"],
      4: ["DF", "F"],
      8: ["QF", "DF", "F"],
      16: ["T1", "QF", "DF", "F"],
      32: ["T1", "T2", "QF", "DF", "F"],
    };
    for (const [n, tours] of Object.entries(attendus)) {
      const fights = tirage(Number(n)).filter((f) => f.type === "BraketFight");
      const max = divisionMaxDuTableau(fights);
      const vus = [...new Set(fights.map((f) => f.division))]
        .sort((a, b) => b - a)
        .map((d) => nomDuTour({ division: d, divisionMax: max, type: "BraketFight" }).court);
      expect(vus, `n=${n}`).toEqual(tours);
    }
  });
});

describe("la forme longue et l'en-tête de colonne", () => {
  it("Tour 1, Quart de finale, Demi-finale, Finale", () => {
    const long = (division: number) => nomDuTour({ division, divisionMax: 4 }).long;
    expect([4, 3, 2, 1].map(long)).toEqual(["Tour 1", "Quart de finale", "Demi-finale", "Finale"]);
  });

  it("colonnes : Tour 1, Quarts de finale, Demi-finales, Finale", () => {
    const colonne = (division: number) => nomDuTour({ division, divisionMax: 4 }).colonne;
    expect([4, 3, 2, 1].map(colonne)).toEqual([
      "Tour 1",
      "Quarts de finale",
      "Demi-finales",
      "Finale",
    ]);
  });

  it("le combat pour la 3e place se reconnaît à son TYPE, pas à sa division", () => {
    expect(nomDuTour({ division: 2, divisionMax: 3, type: "BraketFightPool3" })).toEqual({
      court: "3e",
      long: "Combat pour la 3e place",
      colonne: "Combat pour la 3e place",
    });
  });

  it("un type absent ou inconnu est un combat ordinaire", () => {
    expect(nomDuTour({ division: 2, divisionMax: 2 }).court).toBe("DF");
    expect(nomDuTour({ division: 2, divisionMax: 2, type: null }).court).toBe("DF");
    expect(nomDuTour({ division: 1, divisionMax: 2, type: "Inconnu" }).long).toBe("Finale");
  });

  it("division 0 (poule, décision interne) : P / Poule", () => {
    expect(nomDuTour({ division: 0, divisionMax: 0 })).toEqual({
      court: "P",
      long: "Poule",
      colonne: "Poule",
    });
  });

  it("une division maximale incohérente ne rend jamais un numéro nul ou négatif", () => {
    expect(nomDuTour({ division: 5, divisionMax: 2 }).court).toBe("T1");
  });

  it("rend des copies : retoucher un résultat ne corrompt pas le suivant", () => {
    const premier = nomDuTour({ division: 1, divisionMax: 1 });
    premier.court = "X";
    expect(nomDuTour({ division: 1, divisionMax: 1 }).court).toBe("F");
  });
});

describe("le tableau de trois : deux demi-finales, aucun « Repêchage »", () => {
  function troisInscrits(repechageALIndex: 0 | 1): GeneratedFight[] {
    // Le générateur pose le repêchage à l'index 0 ; rien ne le GARANTIT, donc
    // les deux placements sont éprouvés.
    return tirage(3).map((f) =>
      f.division === 2
        ? {
            ...f,
            indexInDivision:
              f.type === "BraketFightRepechage3" ? repechageALIndex : 1 - repechageALIndex,
          }
        : f,
    );
  }

  for (const index of [0, 1] as const) {
    it(`repêchage à l'index ${index} : 1re DF et 2e DF sont « DF / Demi-finale »`, () => {
      const fights = troisInscrits(index);
      const max = divisionMaxDuTableau(fights);
      const demie = fights.find((f) => f.type === "BraketFight" && f.division === 2)!;
      const repechage = fights.find((f) => f.type === "BraketFightRepechage3")!;
      for (const f of [demie, repechage]) {
        expect(nomDuTour({ division: f.division, divisionMax: max, type: f.type })).toEqual({
          court: "DF",
          long: "Demi-finale",
          colonne: "Demi-finales",
        });
      }
      const finale = fights.find((f) => f.division === 1)!;
      expect(nomDuTour({ division: 1, divisionMax: max, type: finale.type }).court).toBe("F");
    });
  }

  it("aucun libellé rendu ne contient « Repêchage », de 2 à 64 inscrits", () => {
    for (let n = 2; n <= 64; n++) {
      const fights = tirage(n);
      const max = divisionMaxDuTableau(fights);
      for (const f of fights) {
        const nom = nomDuTour({ division: f.division, divisionMax: max, type: f.type });
        for (const forme of [nom.court, nom.long, nom.colonne]) {
          expect(forme, `n=${n} ${f.division}.${f.indexInDivision}`).not.toMatch(/rep[êe]chage/i);
          expect(forme).not.toBe("");
        }
      }
    }
  });
});

describe("divisionMaxDuTableau", () => {
  it("vaut ceil(log2 n) sur un vrai tirage, byes compris, pour n = 2..64", () => {
    for (let n = 2; n <= 64; n++) {
      expect(divisionMaxDuTableau(tirage(n)), `n=${n}`).toBe(Math.ceil(Math.log2(n)));
    }
  });

  it("une FENÊTRE tronquée donne un numéro faux : la profondeur se lit sur tout le tableau", () => {
    // Le contrat que les lectures SQL doivent tenir : à 32 inscrits, une file de
    // check-in qui ne montre plus le premier tour ferait lire « T1 » là où le
    // combat est un « T2 ». D'où la division maximale servie par la base.
    const fights = tirage(32);
    const division4 = { division: 4, type: "BraketFight" };
    expect(nomDuTour({ ...division4, divisionMax: divisionMaxDuTableau(fights) }).court).toBe("T2");
    const fenetre = fights.filter((f) => f.division <= 4);
    expect(nomDuTour({ ...division4, divisionMax: divisionMaxDuTableau(fenetre) }).court).toBe(
      "T1",
    );
  });

  it("un tableau vide rend 0", () => {
    expect(divisionMaxDuTableau([])).toBe(0);
  });
});

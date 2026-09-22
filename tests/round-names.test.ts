import { describe, expect, it } from "vitest";
import { generateBracket, type BracketEntry, type GeneratedFight } from "../src/bracket-generator";
import {
  comparerDansLeTour,
  comparerHorsGrille,
  divisionMaxDuTableau,
  estHorsGrille,
  nomDuTour,
} from "../src/round-names";

function entrees(n: number): BracketEntry[] {
  return Array.from({ length: n }, (_, i) => ({ registrationId: `r${i + 1}`, clubId: null }));
}

function tirage(n: number): GeneratedFight[] {
  const res = generateBracket(entrees(n), `graine-${n}`, { thirdPlaceMode: "pool3" });
  if (res.kind !== "bracket") throw new Error(`n=${n} ne produit pas de tableau`);
  return res.fights;
}

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

describe("l'ordre des combats dans une colonne", () => {
  it("range la 2e demi-finale d'un tableau de trois APRÈS la 1re, malgré son index", () => {
    // Ce que produit le générateur à trois inscrits : la 2e demi-finale occupe
    // la case du bye et reçoit l'index 0, la 1re reçoit l'index 1.
    const colonne = [
      { id: "2e", type: "BraketFightRepechage3", index: 0 },
      { id: "1re", type: "BraketFight", index: 1 },
    ];
    const range = [...colonne].sort(comparerDansLeTour((c) => c.index));
    expect(range.map((c) => c.id)).toEqual(["1re", "2e"]);
  });

  it("laisse l'index départager deux combats de même type", () => {
    const colonne = [
      { id: "b", type: "BraketFight", index: 1 },
      { id: "a", type: "BraketFight", index: 0 },
      { id: "c", type: "BraketFight", index: 2 },
    ];
    const range = [...colonne].sort(comparerDansLeTour((c) => c.index));
    expect(range.map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("ne bouscule pas un tableau ordinaire, qui n'a pas de 2e demi-finale", () => {
    const demies = tirage(4)
      .filter((f) => f.division === 2)
      .map((f, i) => ({ type: f.type, index: i }));
    const range = [...demies].sort(comparerDansLeTour((c) => c.index));
    expect(range.map((c) => c.index)).toEqual(demies.map((c) => c.index));
  });
});

describe("les combats d'arbitrage portent leur propre nom (ticket du 22/09/2026)", () => {
  const NOUVELLE_FINALE = {
    court: "NF",
    long: "Nouvelle finale",
    colonne: "Nouvelle finale",
  };
  const NOUVELLE_DEMIE = {
    court: "NDF",
    long: "Nouvelle demi-finale",
    colonne: "Nouvelles demi-finales",
  };

  it("division 1 au-delà de l'index 0 : une NOUVELLE FINALE", () => {
    for (const indexInDivision of [1, 2]) {
      expect(
        nomDuTour({ division: 1, divisionMax: 3, type: "BraketFight", indexInDivision }),
      ).toEqual(NOUVELLE_FINALE);
    }
  });

  it("division 2 au-delà de l'index 1 : une NOUVELLE DEMI-FINALE, une par côté", () => {
    for (const indexInDivision of [2, 3]) {
      expect(
        nomDuTour({ division: 2, divisionMax: 3, type: "BraketFight", indexInDivision }),
      ).toEqual(NOUVELLE_DEMIE);
    }
  });

  it("les combats DE LA GRILLE gardent leur nom, aux mêmes divisions", () => {
    expect(
      nomDuTour({ division: 1, divisionMax: 3, type: "BraketFight", indexInDivision: 0 }).long,
    ).toBe("Finale");
    for (const indexInDivision of [0, 1]) {
      expect(
        nomDuTour({ division: 2, divisionMax: 3, type: "BraketFight", indexInDivision }).long,
      ).toBe("Demi-finale");
    }
  });

  it("SANS INDEX, le nom est celui d'avant : un appelant qui ne le passe pas ne change pas", () => {
    expect(nomDuTour({ division: 1, divisionMax: 3, type: "BraketFight" }).long).toBe("Finale");
    expect(nomDuTour({ division: 2, divisionMax: 3, type: "BraketFight" }).long).toBe(
      "Demi-finale",
    );
    expect(
      nomDuTour({ division: 1, divisionMax: 3, type: "BraketFight", indexInDivision: null }).long,
    ).toBe("Finale");
  });

  it("le TYPE compte : ni la 3e place ni la 2e demi-finale d'un tableau de trois", () => {
    expect(
      nomDuTour({
        division: 2,
        divisionMax: 2,
        type: "BraketFightPool3",
        indexInDivision: 2,
      }).long,
    ).toBe("Combat pour la 3e place");
    expect(
      nomDuTour({
        division: 2,
        divisionMax: 2,
        type: "BraketFightRepechage3",
        indexInDivision: 2,
      }).long,
    ).toBe("Demi-finale");
  });

  it("sur de VRAIS tirages de 2 à 64, aucun combat de la grille ne devient « Nouvelle… »", () => {
    for (let n = 2; n <= 64; n++) {
      const fights = tirage(n);
      const max = divisionMaxDuTableau(fights);
      for (const f of fights) {
        const nom = nomDuTour({
          division: f.division,
          divisionMax: max,
          type: f.type,
          indexInDivision: f.indexInDivision,
        });
        expect(estHorsGrille(f), `n=${n} ${f.division}.${f.indexInDivision}`).toBe(false);
        expect(nom.long, `n=${n} ${f.division}.${f.indexInDivision}`).not.toMatch(/^Nouvelle/);
      }
    }
  });

  it("rend des copies, comme les autres tours", () => {
    const premier = nomDuTour({
      division: 1,
      divisionMax: 2,
      type: "BraketFight",
      indexInDivision: 1,
    });
    premier.long = "X";
    expect(
      nomDuTour({ division: 1, divisionMax: 2, type: "BraketFight", indexInDivision: 1 }).long,
    ).toBe("Nouvelle finale");
  });
});

describe("l'ordre des combats d'arbitrage", () => {
  it("les nouvelles demi-finales avant la nouvelle finale, quel que soit l'ordre lu", () => {
    // Ce que le client a vu le 22/09/2026 : la lecture rend 18, 20, 19.
    const lus = [
      { numero: 18, division: 2, index: 2 },
      { numero: 20, division: 1, index: 1 },
      { numero: 19, division: 2, index: 3 },
    ];
    const range = [...lus].sort(comparerHorsGrille((c) => c.index));
    expect(range.map((c) => c.numero)).toEqual([18, 19, 20]);
  });

  it("un seul combat, ou aucun, ne bouge pas", () => {
    const vide: { division: number; index: number }[] = [];
    expect(vide.sort(comparerHorsGrille((c) => c.index))).toEqual([]);
    const seul = [{ division: 1, index: 1 }];
    expect([...seul].sort(comparerHorsGrille((c) => c.index))).toEqual(seul);
  });

  it("une demi-finale SEULE peut porter l'index 3 sans qu'il existe d'index 2", () => {
    // Mesuré par le noyau depuis v0.32.0 : la boucle ne pousse une demie que du
    // côté qui a DEUX perdants de quart. Un rang affiché ne se déduit donc jamais
    // de l'index brut, mais de la place dans cette liste.
    const lus = [
      { id: "nf", division: 1, index: 1 },
      { id: "ndf", division: 2, index: 3 },
    ];
    expect([...lus].sort(comparerHorsGrille((c) => c.index)).map((c) => c.id)).toEqual([
      "ndf",
      "nf",
    ]);
  });

  it("les SIX permutations de trois combats rendent la même suite", () => {
    const combats = [
      { id: "ndf1", division: 2, index: 2 },
      { id: "ndf2", division: 2, index: 3 },
      { id: "nf", division: 1, index: 1 },
    ];
    const permutations = [
      [0, 1, 2],
      [0, 2, 1],
      [1, 0, 2],
      [1, 2, 0],
      [2, 0, 1],
      [2, 1, 0],
    ];
    for (const ordre of permutations) {
      const lus = ordre.map((i) => combats[i]!);
      expect(
        lus.sort(comparerHorsGrille((c) => c.index)).map((c) => c.id),
        `permutation ${ordre.join("")}`,
      ).toEqual(["ndf1", "ndf2", "nf"]);
    }
  });

  it("le tri est TOTAL : deux lectures d'ordre différent rendent la même suite", () => {
    const combats = [
      { id: "ndf1", division: 2, index: 2 },
      { id: "ndf2", division: 2, index: 3 },
      { id: "nf", division: 1, index: 1 },
    ];
    const attendu = ["ndf1", "ndf2", "nf"];
    expect([...combats].sort(comparerHorsGrille((c) => c.index)).map((c) => c.id)).toEqual(attendu);
    expect(
      [...combats]
        .reverse()
        .sort(comparerHorsGrille((c) => c.index))
        .map((c) => c.id),
    ).toEqual(attendu);
  });
});

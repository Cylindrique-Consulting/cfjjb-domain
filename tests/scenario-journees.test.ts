import { describe, expect, it } from "vitest";
import { repartirParScenario, type CategoriePourJournee } from "../src/scenario-journees";

const categorie = (
  id: string,
  discipline: "gi" | "nogi",
  ageGroup: string,
  belt: string,
): CategoriePourJournee => ({ id, discipline, ageGroup, belt });

const MIXTE: CategoriePourJournee[] = [
  categorie("gi-adulte-bleue", "gi", "Adulte", "blue"),
  categorie("gi-adulte-noire", "gi", "Adulte", "black"),
  categorie("gi-juvenile-violette", "gi", "Juvénile", "purple"),
  categorie("gi-master-marron", "gi", "Master 2", "brown"),
  categorie("gi-master-corail", "gi", "Master 5+", "coral"),
  categorie("gi-adulte-blanche", "gi", "Adulte", "white"),
  categorie("gi-juvenile-blanche", "gi", "Juvénile", "white"),
  categorie("gi-master-blanche", "gi", "Master 4", "white"),
  categorie("gi-kids", "gi", "U11", "grey"),
  categorie("nogi-kids", "nogi", "U9", "white"),
  categorie("nogi-adulte-noire", "nogi", "Adulte", "black"),
  categorie("nogi-adulte-blanche", "nogi", "Adulte", "white"),
];

const parJournee = (journees: Map<string, number>) => {
  const jours: Record<number, string[]> = {};
  for (const [id, jour] of journees) (jours[jour] ??= []).push(id);
  for (const liste of Object.values(jours)) liste.sort();
  return jours;
};

describe("la répartition des catégories entre les journées", () => {
  it("met tout le premier jour quand la compétition dure moins de deux jours", () => {
    for (const nbJours of [1, 0, -1, Number.NaN]) {
      const journees = repartirParScenario(MIXTE, nbJours);
      expect(
        [...journees.values()].every((jour) => jour === 0),
        `${nbJours} jour(s)`,
      ).toBe(true);
      expect(journees.size).toBe(MIXTE.length);
    }
  });

  it("propose le scénario IBJJF par défaut : couleurs Gi le samedi ; Kids, blanches Gi puis No-Gi le dimanche (JRS.8 B, JRS.2 A)", () => {
    const attendu = {
      0: [
        "gi-adulte-bleue",
        "gi-adulte-noire",
        "gi-juvenile-violette",
        "gi-master-corail",
        "gi-master-marron",
      ],
      1: [
        "gi-adulte-blanche",
        "gi-juvenile-blanche",
        "gi-kids",
        "gi-master-blanche",
        "nogi-adulte-blanche",
        "nogi-adulte-noire",
        "nogi-kids",
      ],
    };
    expect(parJournee(repartirParScenario(MIXTE, 2))).toEqual(attendu);
    expect(parJournee(repartirParScenario(MIXTE, 2, "ibjjf"))).toEqual(attendu);
  });

  it("sans Gi de couleur, garde la règle des ceintures : couleurs le samedi, blanches et Kids le dimanche", () => {
    expect(
      parJournee(
        repartirParScenario(
          [
            categorie("nogi-bleue", "nogi", "Adulte", "blue"),
            categorie("nogi-master-noire", "nogi", "Master 1", "black"),
            categorie("nogi-juvenile-blanche", "nogi", "Juvénile", "white"),
            categorie("nogi-blanche", "nogi", "Adulte", "white"),
          ],
          2,
        ),
      ),
    ).toEqual({
      0: ["nogi-bleue", "nogi-master-noire"],
      1: ["nogi-blanche", "nogi-juvenile-blanche"],
    });
    expect(
      parJournee(
        repartirParScenario(
          [
            categorie("nogi-violette", "nogi", "Adulte", "purple"),
            categorie("kids-nogi", "nogi", "U13", "green"),
            categorie("gi-blanche", "gi", "Adulte", "white"),
          ],
          2,
        ),
      ),
    ).toEqual({ 0: ["nogi-violette"], 1: ["gi-blanche", "kids-nogi"] });
  });

  it("garde entière le premier jour une compétition sans ceinture de couleur hors Kids", () => {
    const kidsSeuls = [
      categorie("u7", "gi", "U7", "grey"),
      categorie("u15-blanche", "gi", "U15", "white"),
      categorie("u11-nogi", "nogi", "U11", "yellow"),
    ];
    expect(parJournee(repartirParScenario(kidsSeuls, 2))).toEqual({
      0: ["u11-nogi", "u15-blanche", "u7"],
    });
    const blanchesSeules = [
      categorie("adulte-blanche", "gi", "Adulte", "white"),
      categorie("kids", "gi", "U9", "grey"),
    ];
    expect(parJournee(repartirParScenario(blanchesSeules, 2))).toEqual({
      0: ["adulte-blanche", "kids"],
    });
  });

  it("scénario « gi-samedi » : tout le Gi hors Kids le samedi, blanches comprises ; Kids et No-Gi le dimanche", () => {
    expect(parJournee(repartirParScenario(MIXTE, 2, "gi-samedi"))).toEqual({
      0: [
        "gi-adulte-blanche",
        "gi-adulte-bleue",
        "gi-adulte-noire",
        "gi-juvenile-blanche",
        "gi-juvenile-violette",
        "gi-master-blanche",
        "gi-master-corail",
        "gi-master-marron",
      ],
      1: ["gi-kids", "nogi-adulte-blanche", "nogi-adulte-noire", "nogi-kids"],
    });
  });

  it("n'utilise que les deux premières journées d'une compétition plus longue", () => {
    const journees = repartirParScenario(MIXTE, 3);
    expect(new Set(journees.values())).toEqual(new Set([0, 1]));
  });

  it("lit les codes d'âge et de ceinture de la base", () => {
    expect(
      parJournee(
        repartirParScenario(
          [
            categorie("adulte", "gi", "adult", " Blue "),
            categorie("master", "gi", "master_1_2", "BROWN"),
            categorie("juvenile", "gi", "juvenil", "white"),
            categorie("kids", "gi", "u9", "grey"),
          ],
          2,
        ),
      ),
    ).toEqual({ 0: ["adulte", "master"], 1: ["juvenile", "kids"] });
  });

  it("ne reporte rien d'une journée pleine vers l'autre (JRS.7 A)", () => {
    const samediPlein = Array.from({ length: 300 }, (_, index) =>
      categorie(
        `gi-${index}`,
        "gi",
        "Adulte",
        ["blue", "purple", "brown", "black"][index % 4] ?? "blue",
      ),
    );
    const journees = repartirParScenario(
      [...samediPlein, categorie("nogi", "nogi", "Adulte", "blue")],
      2,
    );
    expect(samediPlein.every((c) => journees.get(c.id) === 0)).toBe(true);
    expect(journees.get("nogi")).toBe(1);
  });
});

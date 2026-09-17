import { describe, expect, it } from "vitest";
import { generateBracket, type BracketEntry, type GeneratedFight } from "../src/bracket-generator";
import { fightsPerCompetitor } from "../src/capacity";
import {
  categoryRunningOrder,
  computeTatamiSchedule,
  fightTimeKey,
  type SchedulableCategory,
} from "../src/planning-generator";

function entries(n: number): BracketEntry[] {
  return Array.from({ length: n }, (_, i) => ({ registrationId: `r${i + 1}`, clubId: null }));
}

function tirage(n: number, seed = "graine"): GeneratedFight[] {
  const result = generateBracket(entries(n), seed, { thirdPlaceMode: "pool3" });
  if (result.kind !== "bracket") throw new Error(`arbre attendu pour n=${n}`);
  return result.fights;
}

const DEBUT = Date.UTC(2026, 8, 12, 9, 0, 0);
const DUREE = 240;
const ESPACEMENT = 60;
const CRENEAU = (DUREE + ESPACEMENT) * 1000;

function horaires(fights: GeneratedFight[]): SchedulableCategory[] {
  return [{ id: "cat", fightTimeSeconds: DUREE, fights }];
}

describe("l'ordre de passage d'une catégorie à trois inscrits", () => {
  it("rend les TROIS combats : le repêchage n'est plus perdu en route", () => {
    const fights = tirage(3);
    expect(fights.filter((f) => !f.isBye)).toHaveLength(3);
    expect(categoryRunningOrder(fights)).toHaveLength(3);
  });

  it("range le repêchage ENTRE l'ouverture et la finale", () => {
    expect(
      categoryRunningOrder(tirage(3)).map((f) => `${f.division}.${f.indexInDivision}`),
    ).toEqual(["2.1", "2.0", "1.0"]);
  });

  it("le range APRÈS la demie alors qu'il porte un index PLUS PETIT qu'elle", () => {
    const fights = tirage(3);
    const repechage = fights.find((f) => f.type === "BraketFightRepechage3");
    const demie = fights.find((f) => f.type === "BraketFight" && f.division === 2);
    expect(repechage?.indexInDivision).toBe(0);
    expect(demie?.indexInDivision).toBe(1);

    const ordre = categoryRunningOrder(fights);
    expect(ordre.indexOf(demie as GeneratedFight)).toBeLessThan(
      ordre.indexOf(repechage as GeneratedFight),
    );
  });

  it("range la 1re DF avant la 2e par TYPE, même quand la 2e porte l'index 1", () => {
    const inverse = tirage(3).map((f) =>
      f.division === 2 ? { ...f, indexInDivision: f.type === "BraketFightRepechage3" ? 1 : 0 } : f,
    );
    expect(categoryRunningOrder(inverse).map((f) => `${f.division}.${f.type}`)).toEqual([
      "2.BraketFight",
      "2.BraketFightRepechage3",
      "1.BraketFight",
    ]);
  });

  it("ne touche à rien quand il n'y a pas de repêchage", () => {
    expect(categoryRunningOrder(tirage(8)).map((f) => `${f.division}:${f.type}`)).toEqual([
      "3:BraketFight",
      "3:BraketFight",
      "3:BraketFight",
      "3:BraketFight",
      "2:BraketFight",
      "2:BraketFight",
      "2:BraketFightPool3",
      "1:BraketFight",
    ]);
  });
});

describe("les horaires d'une catégorie à trois inscrits", () => {
  it("donne TROIS horaires strictement croissants", () => {
    const fights = tirage(3);
    const { fightTimes } = computeTatamiSchedule(horaires(fights), DEBUT, ESPACEMENT);

    const heures = fights.map((f) => fightTimes.get(fightTimeKey("cat", f)));
    expect(
      heures.every((h) => h !== undefined),
      "un combat réel sans horaire",
    ).toBe(true);

    const parOrdre = categoryRunningOrder(fights).map(
      (f) => fightTimes.get(fightTimeKey("cat", f)) as number,
    );
    expect(parOrdre).toEqual([DEBUT, DEBUT + CRENEAU, DEBUT + 2 * CRENEAU]);
  });

  it("la finale n'est plus programmée À LA PLACE du repêchage", () => {
    const fights = tirage(3);
    const { fightTimes } = computeTatamiSchedule(horaires(fights), DEBUT, ESPACEMENT);
    const heure = (f: GeneratedFight) => fightTimes.get(fightTimeKey("cat", f)) as number;

    const repechage = fights.find((f) => f.type === "BraketFightRepechage3") as GeneratedFight;
    const finale = fights.find((f) => f.division === 1) as GeneratedFight;

    expect(heure(repechage)).toBe(DEBUT + CRENEAU);
    expect(heure(finale)).toBe(DEBUT + 2 * CRENEAU);
  });

  it("consomme bien TROIS créneaux de tapis, pas deux", () => {
    const { endsAt, categoryStarts } = computeTatamiSchedule(
      [
        { id: "cat", fightTimeSeconds: DUREE, fights: tirage(3) },
        { id: "suivante", fightTimeSeconds: DUREE, fights: tirage(2) },
      ],
      DEBUT,
      ESPACEMENT,
    );
    expect(categoryStarts.get("suivante")).toBe(DEBUT + 3 * CRENEAU);
    expect(endsAt).toBe(DEBUT + 4 * CRENEAU);
  });

  it("AUCUN combat réel ne sort sans horaire, de deux à huit inscrits", () => {
    for (let n = 2; n <= 8; n++) {
      const fights = tirage(n);
      const { fightTimes } = computeTatamiSchedule(horaires(fights), DEBUT, ESPACEMENT);
      const orphelins = fights.filter(
        (f) => !f.isBye && fightTimes.get(fightTimeKey("cat", f)) === undefined,
      );
      expect(
        orphelins.map((f) => `${f.division}.${f.indexInDivision}:${f.type}`),
        `n=${n}`,
      ).toEqual([]);
    }
  });
});

describe("le coût en tapis d'une catégorie à trois inscrits", () => {
  it("l'estimateur de capacité compte ce que le tirage produit VRAIMENT", () => {
    for (const n of [2, 3, 4, 5, 6, 7, 8]) {
      const reels = tirage(n).filter((f) => !f.isBye).length;
      expect(
        fightsPerCompetitor({ competitorsPerCategory: n, format: "single_elim" }),
        `n=${n}`,
      ).toBeCloseTo(reels / n, 10);
    }
  });
});

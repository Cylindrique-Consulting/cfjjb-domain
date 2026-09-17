import { describe, expect, it } from "vitest";
import {
  BracketEditError,
  generateBracket,
  readLeafOccupants,
  swapBracketLeafSlots,
  type BracketEntry,
  type GeneratedFight,
} from "../src/bracket-generator";
import { computeMedalNeed, type CategoryForMedals } from "../src/medals";
import {
  categoryRunningOrder,
  computeTatamiSchedule,
  fightTimeKey,
} from "../src/planning-generator";
import { generatePool } from "../src/pool-generator";

function entries(n: number): BracketEntry[] {
  return Array.from({ length: n }, (_, i) => ({ registrationId: `r${i + 1}`, clubId: null }));
}

function poolFights(n: number): GeneratedFight[] {
  const pool = generatePool(entries(n), "graine", { maxSize: 16 });
  if (pool.kind !== "pool") throw new Error("poule attendue");
  return pool.fights;
}

describe("le besoin en médailles d'une poule", () => {
  const poule = (n: number): CategoryForMedals => ({
    competitorCount: n,
    singleCompetitor: false,
    format: "pools",
  });

  it("ne rend JAMAIS deux bronzes, même en shared_bronze", () => {
    expect(computeMedalNeed([poule(6)], { thirdPlaceMode: "shared_bronze" })).toEqual({
      gold: 1,
      silver: 1,
      bronze: 1,
      total: 3,
    });
  });

  it("rend le même décompte quel que soit le mode de 3e place : il est SANS OBJET", () => {
    for (const n of [2, 3, 4, 5, 6]) {
      expect(computeMedalNeed([poule(n)], { thirdPlaceMode: "pool3" }), `n=${n}`).toEqual(
        computeMedalNeed([poule(n)], { thirdPlaceMode: "shared_bronze" }),
      );
    }
  });

  it("donne un bronze dès qu'il y a un troisième classé, et aucun en dessous", () => {
    const bronzes = [1, 2, 3, 4, 5, 6].map(
      (n) => computeMedalNeed([poule(n)], { thirdPlaceMode: "shared_bronze" }).bronze,
    );
    expect(bronzes).toEqual([0, 0, 1, 1, 1, 1]);
  });

  it("laisse l'élimination directe rigoureusement inchangée", () => {
    const cats = [1, 2, 3, 4, 8].map((n) => ({ competitorCount: n, singleCompetitor: false }));
    expect(computeMedalNeed(cats, { thirdPlaceMode: "shared_bronze" })).toEqual({
      gold: 5,
      silver: 4,
      bronze: 1 + 2 + 2,
      total: 14,
    });
    expect(computeMedalNeed(cats, { thirdPlaceMode: "pool3" })).toEqual({
      gold: 5,
      silver: 4,
      bronze: 1 + 1 + 1,
      total: 12,
    });
  });

  it("traite `format: single_elim` comme l'absence de format", () => {
    const sans = { competitorCount: 8, singleCompetitor: false };
    const avec: CategoryForMedals = { ...sans, format: "single_elim" };
    expect(computeMedalNeed([avec], { thirdPlaceMode: "shared_bronze" })).toEqual(
      computeMedalNeed([sans], { thirdPlaceMode: "shared_bronze" }),
    );
  });

  it("compte une compétition mixte poule + élimination sans les confondre", () => {
    const need = computeMedalNeed([poule(6), { competitorCount: 8, singleCompetitor: false }], {
      thirdPlaceMode: "shared_bronze",
    });
    expect(need).toEqual({ gold: 2, silver: 2, bronze: 3, total: 7 });
  });
});

describe("l'ordre de passage d'une catégorie en poule", () => {
  it("SANS le format, les combats de poule disparaissent purement et simplement", () => {
    const fights = poolFights(6);
    expect(fights).toHaveLength(15);
    expect(categoryRunningOrder(fights), "15 combats entrent, zéro sort").toEqual([]);
  });

  it("AVEC le format, ils sortent tous, dans l'ordre de passage", () => {
    const fights = poolFights(6);
    const ordre = categoryRunningOrder(fights, { format: "pools" });
    expect(ordre).toHaveLength(15);
    expect(ordre.map((f) => f.indexInDivision)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
    ]);
  });

  it("ne trie pas la poule autrement : la passe d'ajustement du repos serait détruite", () => {
    const fights = poolFights(7);
    const melange = [...fights].reverse();
    expect(
      categoryRunningOrder(melange, { format: "pools" }).map((f) => f.indexInDivision),
    ).toEqual(fights.map((f) => f.indexInDivision));
  });

  it("laisse l'ordre d'un arbre rigoureusement inchangé", () => {
    const result = generateBracket(entries(8), "graine", { thirdPlaceMode: "pool3" });
    if (result.kind !== "bracket") throw new Error("bracket attendu");
    expect(categoryRunningOrder(result.fights, { format: "single_elim" })).toEqual(
      categoryRunningOrder(result.fights),
    );
    expect(categoryRunningOrder(result.fights).map((f) => `${f.division}:${f.type}`)).toEqual([
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

describe("les horaires d'une catégorie en poule", () => {
  const debut = Date.UTC(2026, 8, 12, 9, 0, 0);

  it("donnent une heure à CHAQUE combat de poule", () => {
    const fights = poolFights(5);
    const schedule = computeTatamiSchedule(
      [{ id: "cat", fightTimeSeconds: 300, fights, format: "pools" }],
      debut,
      60,
    );
    expect(schedule.fightTimes.size).toBe(10);
    for (const f of fights) {
      expect(
        schedule.fightTimes.get(fightTimeKey("cat", f)),
        `combat ${f.indexInDivision} sans heure`,
      ).toBeTypeOf("number");
    }
    expect(schedule.categoryStarts.get("cat")).toBe(debut);
  });

  it("sans le format, la poule entière serait invisible sur la zone d'appel", () => {
    const schedule = computeTatamiSchedule(
      [{ id: "cat", fightTimeSeconds: 300, fights: poolFights(5) }],
      debut,
      60,
    );
    expect(schedule.fightTimes.size).toBe(0);
    expect(schedule.categoryStarts.has("cat")).toBe(false);
    expect(schedule.endsAt).toBe(debut);
  });
});

describe("la permutation des feuilles du premier tour", () => {
  it("REFUSE une poule, sur la seule forme des combats", () => {
    const fights = poolFights(6);
    expect(() => swapBracketLeafSlots(fights, 0, 1)).toThrow(BracketEditError);
    expect(() => swapBracketLeafSlots(fights, 0, 1)).toThrow(/Format poule/);
  });

  it("REFUSE une poule annoncée par l'appelant, avant même de regarder les combats", () => {
    const result = generateBracket(entries(8), "graine", { thirdPlaceMode: "pool3" });
    if (result.kind !== "bracket") throw new Error("bracket attendu");
    expect(() => swapBracketLeafSlots(result.fights, 0, 1, { format: "pools" })).toThrow(
      BracketEditError,
    );
  });

  it("refuse aussi la LECTURE des feuilles d'une poule", () => {
    expect(() => readLeafOccupants(poolFights(6))).toThrow(BracketEditError);
  });

  it("chiffre la taille d'arbre absurde que le refus évite", () => {
    const fights = poolFights(6);
    const deepest = Math.max(...fights.map((f) => f.division));
    const tailleCalculee = fights.filter((f) => f.division === deepest).length * 2;
    expect(deepest, "toute la poule est à la division 0").toBe(0);
    expect(tailleCalculee, "2 × 15 combats, et 30 n'est pas une puissance de deux").toBe(30);
  });

  it("laisse une permutation d'arbre parfaitement fonctionnelle", () => {
    const result = generateBracket(entries(6), "graine", { thirdPlaceMode: "pool3" });
    if (result.kind !== "bracket") throw new Error("bracket attendu");
    const avant = readLeafOccupants(result.fights);
    const apres = readLeafOccupants(swapBracketLeafSlots(result.fights, 0, 2));
    expect(apres[0]).toBe(avant[2]);
    expect(apres[2]).toBe(avant[0]);
  });
});

import { describe, expect, it } from "vitest";
import { computeMedalNeed, computeMedalSummary } from "../src/medals";
import type { CategoryForMedals } from "../src/medals";

const POOL3: { thirdPlaceMode: "pool3" } = { thirdPlaceMode: "pool3" };
const SHARED: { thirdPlaceMode: "shared_bronze" } = { thirdPlaceMode: "shared_bronze" };

function cat(competitorCount: number, singleCompetitor = false): CategoryForMedals {
  return { competitorCount, singleCompetitor };
}

describe("computeMedalNeed — 0 competitor", () => {
  it("retourne 0 médaille pour une catégorie vide", () => {
    expect(computeMedalNeed([cat(0)], POOL3)).toEqual({ gold: 0, silver: 0, bronze: 0, total: 0 });
    expect(computeMedalNeed([cat(0)], SHARED)).toEqual({ gold: 0, silver: 0, bronze: 0, total: 0 });
  });
});

describe("computeMedalNeed — 1 competitor (or automatique)", () => {
  it("competitorCount=1 → or uniquement", () => {
    expect(computeMedalNeed([cat(1)], POOL3)).toEqual({ gold: 1, silver: 0, bronze: 0, total: 1 });
  });
  it("singleCompetitor=true → or uniquement (même avec un count > 1)", () => {
    expect(computeMedalNeed([cat(2, true)], POOL3)).toEqual({
      gold: 1,
      silver: 0,
      bronze: 0,
      total: 1,
    });
  });
});

describe("computeMedalNeed — 2 competitors → or + argent, jamais de bronze", () => {
  it("pool3", () => {
    expect(computeMedalNeed([cat(2)], POOL3)).toEqual({ gold: 1, silver: 1, bronze: 0, total: 2 });
  });
  it("shared_bronze", () => {
    expect(computeMedalNeed([cat(2)], SHARED)).toEqual({ gold: 1, silver: 1, bronze: 0, total: 2 });
  });
});

describe("computeMedalNeed — pool3 (miroir du générateur : Pool3 seulement pour n≥4)", () => {
  it("n=3 → bronze=0 (aucun fight Pool3 généré)", () => {
    expect(computeMedalNeed([cat(3)], POOL3)).toEqual({
      gold: 1,
      silver: 1,
      bronze: 0,
      total: 2,
    });
  });
  it("n=4 → bronze=1", () => {
    expect(computeMedalNeed([cat(4)], POOL3)).toEqual({
      gold: 1,
      silver: 1,
      bronze: 1,
      total: 3,
    });
  });
  it("n=8 → bronze=1", () => {
    expect(computeMedalNeed([cat(8)], POOL3)).toMatchObject({ bronze: 1 });
  });
});

describe("computeMedalNeed — shared_bronze (les perdants de demi partagent le bronze)", () => {
  it("n=3 → bronze=1 (un seul perdant de demi-finale)", () => {
    expect(computeMedalNeed([cat(3)], SHARED)).toEqual({
      gold: 1,
      silver: 1,
      bronze: 1,
      total: 3,
    });
  });
  it("n=4 → bronze=2 (deux perdants de demi-finale)", () => {
    expect(computeMedalNeed([cat(4)], SHARED)).toEqual({
      gold: 1,
      silver: 1,
      bronze: 2,
      total: 4,
    });
  });
  it("n=8 → bronze=2", () => {
    expect(computeMedalNeed([cat(8)], SHARED)).toMatchObject({ bronze: 2 });
  });
});

describe("computeMedalNeed — agrégation multi-catégories", () => {
  it("somme correctement plusieurs catégories (pool3)", () => {
    const need = computeMedalNeed(
      [
        cat(4), // pool3 → 3 médailles (1+1+1)
        cat(3), // → 2 médailles (1+1)
        cat(1), // → 1 médaille (or)
      ],
      POOL3,
    );
    expect(need).toEqual({ gold: 3, silver: 2, bronze: 1, total: 6 });
  });

  it("somme correctement plusieurs catégories (shared_bronze)", () => {
    const need = computeMedalNeed(
      [
        cat(4), // shared_bronze → 4 médailles (1+1+2)
        cat(3), // → 3 médailles (1+1+1)
      ],
      SHARED,
    );
    expect(need).toEqual({ gold: 2, silver: 2, bronze: 3, total: 7 });
  });

  it("catégorie vide n'ajoute rien", () => {
    const withEmpty = computeMedalNeed([cat(4), cat(0)], POOL3);
    const withoutEmpty = computeMedalNeed([cat(4)], POOL3);
    expect(withEmpty).toEqual(withoutEmpty);
  });
});

describe("computeMedalSummary — remaining borné à 0", () => {
  it("distributed > need → remaining=0, pas négatif", () => {
    const summary = computeMedalSummary([cat(2)], POOL3, 99);
    // need.total = 2, distributed=99 → remaining=0
    expect(summary.remaining).toBe(0);
    expect(summary.distributed).toBe(99);
    expect(summary.need.total).toBe(2);
  });

  it("distributed = need → remaining=0", () => {
    const summary = computeMedalSummary([cat(4)], POOL3, 3);
    expect(summary.remaining).toBe(0);
  });

  it("distributed < need → remaining > 0", () => {
    const summary = computeMedalSummary([cat(4)], POOL3, 1);
    expect(summary.remaining).toBe(2); // need=3, distributed=1
  });
});

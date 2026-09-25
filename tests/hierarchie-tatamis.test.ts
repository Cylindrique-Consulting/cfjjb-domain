import { describe, expect, it } from "vitest";
import { rangsDeQualiteParDefaut } from "../src/hierarchie-tatamis";

const rangs = (numeros: readonly number[]) => Object.fromEntries(rangsDeQualiteParDefaut(numeros));

describe("la hiérarchie des tatamis par défaut (ORD.2 A)", () => {
  it("sur 8 tatamis : 1 et 8 les meilleurs, 4 et 5 les moins bons", () => {
    expect(rangs([1, 2, 3, 4, 5, 6, 7, 8])).toEqual({
      1: 1,
      2: 2,
      3: 3,
      4: 4,
      5: 4,
      6: 3,
      7: 2,
      8: 1,
    });
  });

  it("sur 6 tatamis, par paires depuis les deux bouts de la salle", () => {
    expect(rangs([1, 2, 3, 4, 5, 6])).toEqual({ 1: 1, 2: 2, 3: 3, 4: 3, 5: 2, 6: 1 });
  });

  it("avec un nombre impair, laisse le tatami central seul au dernier rang", () => {
    expect(rangs([1, 2, 3, 4, 5, 6, 7])).toEqual({ 1: 1, 2: 2, 3: 3, 4: 4, 5: 3, 6: 2, 7: 1 });
    expect(rangs([1, 2, 3])).toEqual({ 1: 1, 2: 2, 3: 1 });
  });

  it("donne le meilleur rang à un ou deux tatamis", () => {
    expect(rangs([4])).toEqual({ 4: 1 });
    expect(rangs([1, 2])).toEqual({ 1: 1, 2: 1 });
    expect(rangsDeQualiteParDefaut([]).size).toBe(0);
  });

  it("trie les numéros reçus, ignore les doublons et suit les positions, pas les valeurs", () => {
    expect(rangs([8, 1, 5, 5, 3])).toEqual({ 1: 1, 3: 2, 5: 2, 8: 1 });
    expect(rangs([16, 11, 12, 13, 14, 15])).toEqual({
      11: 1,
      12: 2,
      13: 3,
      14: 3,
      15: 2,
      16: 1,
    });
  });
});

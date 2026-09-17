import { describe, expect, it } from "vitest";
import {
  MAX_PAR_ENTITE,
  separationTenue,
  verifierSeparationDEquipe,
} from "../src/separation-equipe";
import type { BracketEntry, GeneratedFight } from "../src/bracket-generator";

const combat = (
  indexInDivision: number,
  slotA: string | null,
  slotB: string | null,
  isBye = false,
): GeneratedFight => ({
  division: 1,
  indexInDivision,
  type: "BraketFight",
  slotA,
  slotB,
  isBye,
});

const inscrit = (
  registrationId: string,
  teamId: string | null,
  clubId: string | null = "k1",
): BracketEntry => ({
  registrationId,
  clubId,
  teamId,
});

describe("verifierSeparationDEquipe", () => {
  it("ne voit rien quand les équipes sont séparées", () => {
    const v = verifierSeparationDEquipe(
      [combat(0, "r1", "r2"), combat(1, "r3", "r4")],
      [inscrit("r1", "A"), inscrit("r2", "B"), inscrit("r3", "A"), inscrit("r4", "B")],
    );

    expect(v.rencontres).toEqual([]);
    expect(separationTenue(v)).toBe(true);
  });

  it("NOMME la rencontre interne, son combat et son entité", () => {
    const v = verifierSeparationDEquipe(
      [combat(0, "r1", "r2")],
      [inscrit("r1", "A"), inscrit("r2", "A")],
    );

    expect(v.rencontres).toEqual([
      {
        division: 1,
        indexInDivision: 0,
        entiteId: "A",
        registrationA: "r1",
        registrationB: "r2",
      },
    ]);
    expect(separationTenue(v)).toBe(false);
  });

  it("retombe sur le CLUB quand aucune sous-équipe n'est posée", () => {
    const v = verifierSeparationDEquipe(
      [combat(0, "r1", "r2")],
      [inscrit("r1", null, "k9"), inscrit("r2", null, "k9")],
    );

    expect(v.rencontres[0]?.entiteId).toBe("k9");
  });

  it("ignore les byes et les emplacements vides, sans les compter pour des rencontres", () => {
    const v = verifierSeparationDEquipe(
      [combat(0, "r1", null), combat(1, "r2", "r3", true), combat(2, null, null)],
      [inscrit("r1", "A"), inscrit("r2", "A"), inscrit("r3", "A")],
    );

    expect(v.rencontres).toEqual([]);
  });

  it("ne rattache pas un combattant SANS club ni équipe", () => {
    const v = verifierSeparationDEquipe(
      [combat(0, "r1", "r2")],
      [inscrit("r1", null, null), inscrit("r2", null, null)],
    );

    expect(v.rencontres).toEqual([]);
    expect(v.surchargees).toEqual([]);
  });

  it("DISTINGUE « le tirage a mal fait » de « la règle ne pouvait pas être tenue »", () => {
    const v = verifierSeparationDEquipe(
      [combat(0, "r1", "r4"), combat(1, "r2", "r3")],
      [inscrit("r1", "A"), inscrit("r2", "A"), inscrit("r3", "A"), inscrit("r4", "B")],
    );

    expect(v.surchargees).toEqual([{ entiteId: "A", effectif: 3 }]);
    expect(v.rencontres).toHaveLength(1);
  });

  it("ne signale pas une entité qui tient dans la borne", () => {
    const v = verifierSeparationDEquipe(
      [combat(0, "r1", "r3")],
      [inscrit("r1", "A"), inscrit("r2", "A"), inscrit("r3", "B")],
    );

    expect(MAX_PAR_ENTITE).toBe(2);
    expect(v.surchargees).toEqual([]);
  });

  it("rend un ordre STABLE : deux appels identiques rendent la même liste", () => {
    const entries = [
      inscrit("r1", "B"),
      inscrit("r2", "B"),
      inscrit("r3", "B"),
      inscrit("r4", "A"),
      inscrit("r5", "A"),
      inscrit("r6", "A"),
      inscrit("r7", "A"),
    ];
    const un = verifierSeparationDEquipe([], entries);
    const deux = verifierSeparationDEquipe([], [...entries].reverse());

    expect(un.surchargees).toEqual([
      { entiteId: "A", effectif: 4 },
      { entiteId: "B", effectif: 3 },
    ]);
    expect(deux.surchargees).toEqual(un.surchargees);
  });
});

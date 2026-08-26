import { describe, expect, it } from "vitest";
import {
  MAX_PAR_ENTITE,
  separationTenue,
  verifierSeparationDEquipe,
} from "../src/separation-equipe";
import type { BracketEntry, GeneratedFight } from "../src/bracket-generator";

/**
 * LA SÉPARATION D'ÉQUIPE SE CONSTATE, elle ne se souhaite pas (CYL-517).
 *
 * Le placement du noyau est une réparation PONDÉRÉE : il minimise les
 * rencontres sans jamais refuser un tableau. Ce module dit ce qui se trouve
 * RÉELLEMENT sur le tableau tiré — et la nuance décide d'un geste : un club qui
 * découvre au bord du tapis que ses deux combattants s'affrontent au premier
 * tour n'a plus aucun recours.
 */

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
    // C'est le régime normal d'un club sans équipe : la règle s'applique quand
    // même, au niveau du club, comme partout ailleurs dans le produit.
    const v = verifierSeparationDEquipe(
      [combat(0, "r1", "r2")],
      [inscrit("r1", null, "k9"), inscrit("r2", null, "k9")],
    );

    expect(v.rencontres[0]?.entiteId).toBe("k9");
  });

  it("ignore les byes et les emplacements vides, sans les compter pour des rencontres", () => {
    // Aux tours suivants, les emplacements sont vides au tirage : y chercher une
    // rencontre reviendrait à prédire des résultats.
    const v = verifierSeparationDEquipe(
      [combat(0, "r1", null), combat(1, "r2", "r3", true), combat(2, null, null)],
      [inscrit("r1", "A"), inscrit("r2", "A"), inscrit("r3", "A")],
    );

    expect(v.rencontres).toEqual([]);
  });

  it("ne rattache pas un combattant SANS club ni équipe", () => {
    // Deux inscriptions orphelines ne forment pas une « équipe des sans-club ».
    const v = verifierSeparationDEquipe(
      [combat(0, "r1", "r2")],
      [inscrit("r1", null, null), inscrit("r2", null, null)],
    );

    expect(v.rencontres).toEqual([]);
    expect(v.surchargees).toEqual([]);
  });

  it("DISTINGUE « le tirage a mal fait » de « la règle ne pouvait pas être tenue »", () => {
    // Trois combattants d'une même entité : aucun placement ne les sépare tous.
    // Le dire est ce qui évite d'accuser le tirage d'une contrainte impossible.
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

    // Le plus gros effectif d'abord, puis l'identifiant : un rapport de
    // génération ne doit pas changer d'une exécution à l'autre.
    expect(un.surchargees).toEqual([
      { entiteId: "A", effectif: 4 },
      { entiteId: "B", effectif: 3 },
    ]);
    expect(deux.surchargees).toEqual(un.surchargees);
  });
});

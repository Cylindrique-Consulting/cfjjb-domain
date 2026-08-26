import { describe, expect, it } from "vitest";
import {
  autoComposeSquads,
  detecterDepassementsParEquipe,
  squadTeamId,
  type SquadCandidate,
} from "../src/squad-composition";

/**
 * LA RÈGLE PORTE SUR L'ÉQUIPE, PAS SUR LE CLUB (CYL-502).
 *
 * ┌─ CE QUE LE GROUPEMENT PAR CLUB LAISSAIT PASSER ───────────────────────────┐
 * │ Une team fédère plusieurs clubs — INFINITY en compte 33 en production.     │
 * │ Équilibrer par CLUB donne la lettre A à un combattant de chacun des deux   │
 * │ clubs d'une même équipe : le tirage les tient alors pour deux sous-équipes │
 * │ différentes, et ne les sépare pas. La règle fédérale « deux au plus par    │
 * │ équipe et par catégorie » n'était donc pas appliquée là où elle compte le  │
 * │ plus : sur les grosses équipes.                                            │
 * └───────────────────────────────────────────────────────────────────────────┘
 */

const c = (
  registrationId: string,
  clubId: string,
  teamId: string | null = null,
  categoryKey = "cat",
): SquadCandidate => ({ registrationId, clubId, teamId, categoryKey });

describe("autoComposeSquads — l'entité de rattachement", () => {
  it("ÉQUILIBRE SUR L'ÉQUIPE quand deux clubs la partagent", () => {
    // Deux clubs, une seule équipe, deux combattants : ils doivent recevoir
    // des lettres DIFFÉRENTES. Groupés par club, ils auraient tous deux le A.
    const compo = autoComposeSquads([c("r1", "k1", "t1"), c("r2", "k2", "t1")], "graine");

    const lettres = compo.assignments.map((a) => a.letter);
    expect(new Set(lettres).size).toBe(2);
  });

  it("rattache la sous-équipe à l'ÉQUIPE, et non à chaque club", () => {
    const compo = autoComposeSquads([c("r1", "k1", "t1"), c("r2", "k2", "t1")], "graine");

    // Une ligne par (équipe, lettre) — pas une par (club, lettre), sinon les
    // deux combattants resteraient deux entités distinctes au tirage.
    expect(compo.squads.every((q) => q.teamId === "t1")).toBe(true);
    expect(compo.assignments.every((a) => a.ownerId === "t1")).toBe(true);
  });

  it("retombe sur le CLUB quand il n'a pas d'équipe, sans le ranger sous une team", () => {
    const compo = autoComposeSquads([c("r1", "k1"), c("r2", "k1")], "graine");

    expect(compo.assignments.every((a) => a.ownerId === "k1")).toBe(true);
    expect(compo.squads.every((q) => q.teamId === null)).toBe(true);
  });

  it("ne mélange PAS deux équipes différentes", () => {
    const compo = autoComposeSquads([c("r1", "k1", "t1"), c("r2", "k2", "t2")], "graine");

    // Chaque équipe repart de zéro : toutes deux peuvent prendre le A.
    expect(compo.assignments.map((a) => a.letter)).toEqual(["A", "A"]);
  });

  it("la clé de séparation du tirage est celle de l'ENTITÉ", () => {
    // C'est cette chaîne que la plateforme pose sur `BracketEntry.teamId`.
    expect(squadTeamId("t1", "A")).toBe("t1#A");
    expect(squadTeamId("t1", "A")).not.toBe(squadTeamId("k1", "A"));
  });
});

describe("detecterDepassementsParEquipe", () => {
  it("se tait tant que le seuil est tenu", () => {
    expect(detecterDepassementsParEquipe([c("r1", "k1", "t1"), c("r2", "k2", "t1")])).toEqual([]);
  });

  it("NOMME le groupe qui dépasse, à travers les clubs de l'équipe", () => {
    const d = detecterDepassementsParEquipe([
      c("r1", "k1", "t1"),
      c("r2", "k2", "t1"),
      c("r3", "k3", "t1"),
    ]);

    expect(d).toHaveLength(1);
    expect(d[0]?.ownerId).toBe("t1");
    expect(d[0]?.registrationIds).toHaveLength(3);
  });

  it("compte PAR CATÉGORIE : trois combattants répartis sur trois catégories ne dépassent rien", () => {
    const d = detecterDepassementsParEquipe([
      c("r1", "k1", "t1", "a"),
      c("r2", "k1", "t1", "b"),
      c("r3", "k1", "t1", "c"),
    ]);

    expect(d).toEqual([]);
  });

  it("ignore les inscriptions sans club : elles ne forment pas un groupe", () => {
    const sansClub: SquadCandidate = {
      registrationId: "r0",
      clubId: null,
      categoryKey: "cat",
    };
    expect(detecterDepassementsParEquipe([sansClub, sansClub, sansClub])).toEqual([]);
  });

  it("rend un ordre STABLE, le plus gros dépassement d'abord", () => {
    const entrees = [
      c("r1", "k1", "t1"),
      c("r2", "k1", "t1"),
      c("r3", "k1", "t1"),
      c("r4", "k2", "t2"),
      c("r5", "k2", "t2"),
      c("r6", "k2", "t2"),
      c("r7", "k2", "t2"),
    ];
    const un = detecterDepassementsParEquipe(entrees);
    const deux = detecterDepassementsParEquipe([...entrees].reverse());

    expect(un.map((d) => d.ownerId)).toEqual(["t2", "t1"]);
    expect(deux.map((d) => d.ownerId)).toEqual(un.map((d) => d.ownerId));
  });

  it("le seuil est un paramètre, pas une constante cachée", () => {
    const trois = [c("r1", "k1", "t1"), c("r2", "k1", "t1"), c("r3", "k1", "t1")];
    expect(detecterDepassementsParEquipe(trois, 3)).toEqual([]);
    expect(detecterDepassementsParEquipe(trois, 2)).toHaveLength(1);
  });
});

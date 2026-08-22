import { describe, expect, it } from "vitest";
import {
  allowedKinds,
  canPerform,
  CAPABILITIES,
  operableTatamis,
  STAFF_ROLES,
  type Assignment,
  type MutationKind,
  type StaffRole,
} from "../src/capabilities";

const T1 = "11111111-1111-1111-1111-111111111111";
const T3 = "33333333-3333-3333-3333-333333333333";

const poste = (
  role: StaffRole,
  tatamiScope: Assignment["tatamiScope"] = "none",
  tatamiIds: string[] = [],
): Assignment => ({ role, tatamiScope, tatamiIds });

describe("la matrice couvre tout et ne s'ouvre pas par défaut", () => {
  it("chaque verbe a une règle, et chaque règle nomme des postes existants", () => {
    // Le `Record<MutationKind, …>` garantit déjà la couverture au compilateur.
    // Ce test attrape l'autre moitié : une règle qui cite un poste inexistant
    // n'autoriserait JAMAIS personne, en silence.
    const kinds = Object.keys(CAPABILITIES) as MutationKind[];
    expect(kinds.length).toBeGreaterThanOrEqual(11);
    for (const k of kinds) {
      expect(CAPABILITIES[k].roles.length, `${k} n'autorise aucun poste`).toBeGreaterThan(0);
      for (const r of CAPABILITIES[k].roles) {
        expect(
          (STAFF_ROLES as readonly string[]).includes(r),
          `${k} cite le poste « ${r} », qui n'existe pas : la comparaison ne matcherait jamais et personne ne pourrait agir`,
        ).toBe(true);
      }
    }
  });

  it("aucun verbe n'est ouvert à tous les postes", () => {
    // Une règle qui liste les huit postes est une règle absente déguisée.
    for (const k of Object.keys(CAPABILITIES) as MutationKind[]) {
      expect(CAPABILITIES[k].roles.length, `${k} est ouvert à tout le monde`).toBeLessThan(
        STAFF_ROLES.length,
      );
    }
  });

  it("sans aucune affectation, rien n'est autorisé", () => {
    for (const k of Object.keys(CAPABILITIES) as MutationKind[]) {
      expect(canPerform(k, [], T1), k).toBe(false);
      expect(canPerform(k, [], null), k).toBe(false);
    }
  });
});

describe("le périmètre tapis est consulté quand il compte, et ignoré sinon", () => {
  it("un poste sans tapis n'écrit aucun score", () => {
    // `none` est le DÉFAUT en base, et il est fail-closed à dessein : un défaut
    // fail-open sur la table qui garde l'écriture des scores serait inacceptable.
    expect(canPerform("fight.score", [poste("table_operator", "none")], T1)).toBe(false);
  });

  it("un tapis listé autorise celui-là et pas un autre", () => {
    const a = [poste("table_operator", "listed", [T1])];
    expect(canPerform("fight.score", a, T1)).toBe(true);
    expect(canPerform("fight.score", a, T3)).toBe(false);
  });

  it("« tous les tapis » autorise n'importe lequel", () => {
    expect(canPerform("fight.score", [poste("table_operator", "all")], T3)).toBe(true);
  });

  it("un verbe lié au tapis sans tapis connu est REFUSÉ", () => {
    // On ne devine pas le tapis. Ne pas le connaître n'est pas une raison de
    // laisser passer — c'est la règle qui empêche un opérateur du tatami 1 de
    // scorer le tatami 3 en omettant l'information.
    expect(canPerform("fight.score", [poste("table_operator", "all")], null)).toBe(false);
  });

  it("un verbe non lié au tapis ignore le périmètre", () => {
    // La balance sert toute la salle : exiger un tapis empêcherait la pesée.
    expect(canPerform("weighin.record", [poste("weighin", "none")], null)).toBe(true);
    expect(canPerform("presence.check_in", [poste("checkin_desk", "none")], null)).toBe(true);
  });
});

describe("les décisions de conception que la matrice porte", () => {
  it("la table de marque ne réouvre pas un combat", () => {
    const table = [poste("table_operator", "all")];
    expect(canPerform("fight.finish", table, T1)).toBe(true);
    expect(
      canPerform("fight.reopen", table, T1),
      "réouvrir dépropage l'aval d'un tableau : c'est une décision de commissaire, portée par le poste et non par une fenêtre de confirmation",
    ).toBe(false);
  });

  it("déplacer un combat n'appartient qu'au commissaire de journée", () => {
    // Deux tapis sont concernés : seul un poste qui les voit tous les deux peut
    // décider. C'est aussi la seule opération où deux appareils hors ligne
    // prendraient des décisions inconciliables.
    expect(canPerform("fight.move", [poste("tatami_commissioner", "all")], null)).toBe(false);
    expect(canPerform("fight.move", [poste("day_commissioner", "all")], null)).toBe(true);
  });

  it("la saisie papier n'appartient qu'au commissaire de journée", () => {
    expect(canPerform("paper.entry", [poste("table_operator", "all")], null)).toBe(false);
    expect(canPerform("paper.entry", [poste("day_commissioner")], null)).toBe(true);
  });

  it("le commissaire de journée touche à tout SAUF ce qui n'est pas son poste", () => {
    // Il n'est pas omnipotent par magie : il l'est parce qu'il figure
    // explicitement dans chaque règle. Un verbe futur ne l'inclura pas tout seul.
    const manquants = (Object.keys(CAPABILITIES) as MutationKind[]).filter(
      (k) => !CAPABILITIES[k].roles.includes("day_commissioner"),
    );
    expect(manquants).toEqual([]);
  });

  it("aucun poste de guichet ne peut écrire un score", () => {
    for (const r of ["checkin_desk", "weighin", "medido", "podium", "tshirt_stand"] as const) {
      expect(canPerform("fight.score", [poste(r, "all")], T1), r).toBe(false);
    }
  });
});

describe("les vues dérivées", () => {
  it("allowedKinds rend les verbes des postes tenus", () => {
    expect(allowedKinds([poste("weighin")])).toEqual(["weighin.record"]);
    expect(allowedKinds([poste("table_operator")]).sort()).toEqual([
      "fight.finish",
      "fight.score",
      "fight.start",
    ]);
  });

  it("operableTatamis fusionne les périmètres et « tous » l'emporte", () => {
    expect(operableTatamis([poste("table_operator", "listed", [T3, T1])])).toEqual([T1, T3]);
    expect(operableTatamis([poste("table_operator", "listed", [T1]), poste("podium", "all")])).toBe(
      "all",
    );
    expect(operableTatamis([poste("weighin", "none")])).toEqual([]);
  });
});

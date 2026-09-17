import { describe, expect, it } from "vitest";
import type { WinMethod } from "../src/bracket-propagation";
import {
  METHODES_SANS_COMBAT,
  aDisputeLeCombat,
  finDeRepos,
  finDeReposDeLAthlete,
  multiplicateurDeRepos,
  type CombatPasse,
} from "../src/fight-rest";

const MINUTE = 60_000;
const T0 = Date.UTC(2026, 8, 20, 9, 0, 0);

describe("« a disputé un combat »", () => {
  it("bye, wo, double_wo et désignation entre coéquipiers ne sont pas des combats disputés", () => {
    for (const winMethod of ["bye", "wo", "double_wo", "designation"] as const) {
      expect(
        aDisputeLeCombat({ state: "finished", winMethod, chronoLance: false }),
        winMethod,
      ).toBe(false);
    }
    expect([...METHODES_SANS_COMBAT].sort()).toEqual(["bye", "designation", "double_wo", "wo"]);
  });

  it("points, soumission, disqualification, décision, abandon et les deux fins sans vainqueur le sont", () => {
    for (const winMethod of [
      "points",
      "submission",
      "dq",
      "decision",
      "abandon",
      "double_dq",
      "double_blessure",
    ] as WinMethod[]) {
      expect(
        aDisputeLeCombat({ state: "finished", winMethod, chronoLance: false }),
        winMethod,
      ).toBe(true);
    }
  });

  it("chrono lancé puis forfait : disputé, l'athlète est monté sur le tapis", () => {
    expect(aDisputeLeCombat({ state: "finished", winMethod: "wo", chronoLance: true })).toBe(true);
    expect(aDisputeLeCombat({ state: "in_progress", winMethod: null, chronoLance: true })).toBe(
      true,
    );
  });

  it("un combat à venir ou annulé, jamais lancé, n'est pas disputé", () => {
    expect(aDisputeLeCombat({ state: "scheduled", winMethod: null, chronoLance: false })).toBe(
      false,
    );
    expect(aDisputeLeCombat({ state: "cancelled", winMethod: null, chronoLance: false })).toBe(
      false,
    );
  });
});

describe("le multiplicateur de repos", () => {
  it("1 avant un tour ordinaire : T1, QF, DF, et la 2e DF d'un tableau de trois", () => {
    expect(multiplicateurDeRepos({ division: 5, type: "BraketFight" })).toBe(1);
    expect(multiplicateurDeRepos({ division: 3, type: "BraketFight" })).toBe(1);
    expect(multiplicateurDeRepos({ division: 2, type: "BraketFight" })).toBe(1);
    expect(multiplicateurDeRepos({ division: 2, type: "BraketFightRepechage3" })).toBe(1);
  });

  it("2 avant une finale (catégorie ou absolut, type absent compris)", () => {
    expect(multiplicateurDeRepos({ division: 1, type: "BraketFight" })).toBe(2);
    expect(multiplicateurDeRepos({ division: 1 })).toBe(2);
  });

  it("1 avant le combat pour la 3e place (décision interne : repos simple)", () => {
    expect(multiplicateurDeRepos({ division: 2, type: "BraketFightPool3" })).toBe(1);
  });
});

describe("la fin du repos", () => {
  it("fin réelle + k × durée de la catégorie du combat À VENIR", () => {
    const demie = { id: "df", division: 2, type: "BraketFight", dureeSecondes: 300 };
    const finale = { id: "f", division: 1, type: "BraketFight", dureeSecondes: 300 };
    expect(finDeRepos(T0, demie)).toBe(T0 + 5 * MINUTE);
    expect(finDeRepos(T0, finale)).toBe(T0 + 10 * MINUTE);
    expect(finDeRepos(T0, { ...finale, dureeSecondes: 240 })).toBe(T0 + 8 * MINUTE);
  });

  function combat(
    id: string,
    finReelleMs: number | null,
    winMethod: WinMethod | null,
    chronoLance = false,
  ): CombatPasse {
    return {
      id,
      state: finReelleMs === null ? "scheduled" : "finished",
      winMethod,
      chronoLance,
      finReelleMs,
    };
  }

  it("tableau de trois : 2e DF gagnée par forfait, le repos avant la finale part de la 1re DF", () => {
    const premiereDF = combat("df1", T0 + 6 * MINUTE, "points", true);
    const deuxiemeDF = combat("df2", T0 + 20 * MINUTE, "wo");
    const finale = { id: "f", division: 1, type: "BraketFight", dureeSecondes: 300 };
    expect(finDeReposDeLAthlete([premiereDF, deuxiemeDF], finale)).toBe(
      T0 + 6 * MINUTE + 10 * MINUTE,
    );
  });

  it("seul le DERNIER combat disputé compte", () => {
    const t1 = combat("t1", T0, "submission", true);
    const qf = combat("qf", T0 + 30 * MINUTE, "points", true);
    const df = { id: "df", division: 2, type: "BraketFight", dureeSecondes: 360 };
    expect(finDeReposDeLAthlete([qf, t1], df)).toBe(T0 + 30 * MINUTE + 6 * MINUTE);
  });

  it("le combat à venir est exclu du calcul, même s'il figure dans la liste", () => {
    const df1 = combat("df1", T0, "points", true);
    const finaleDejaDatee = combat("f", T0 + 40 * MINUTE, "points", true);
    const finale = { id: "f", division: 1, type: "BraketFight", dureeSecondes: 300 };
    expect(finDeReposDeLAthlete([df1, finaleDejaDatee], finale)).toBe(T0 + 10 * MINUTE);
  });

  it("un bye ou un forfait n'ouvre aucun repos ; aucun combat disputé = aucun repos", () => {
    const bye = combat("b", T0, "bye");
    const wo = combat("w", T0 + MINUTE, "wo");
    const aVenir = { id: "x", division: 2, type: "BraketFight", dureeSecondes: 300 };
    expect(finDeReposDeLAthlete([bye, wo], aVenir)).toBeNull();
    expect(finDeReposDeLAthlete([], aVenir)).toBeNull();
  });

  it("un combat en cours (sans fin réelle) n'ouvre pas encore de repos", () => {
    const enCours: CombatPasse = {
      id: "c",
      state: "in_progress",
      winMethod: null,
      chronoLance: true,
      finReelleMs: null,
    };
    const aVenir = { id: "x", division: 1, type: "BraketFight", dureeSecondes: 300 };
    expect(finDeReposDeLAthlete([enCours], aVenir)).toBeNull();
  });
});

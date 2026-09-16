import { describe, expect, it } from "vitest";
import {
  arbitrageRequisPour,
  estHorsGrille,
  formatDuTableau,
  positionApresRepos,
  REGLES_FIN_SANS_VAINQUEUR,
  scenariosFinSansVainqueur,
  tourDuCombat,
} from "../src/arbitrage";
import {
  estDisqualifieDisciplinaire,
  findFeederFight,
  findNextSlot,
  findPool3Slot,
  isSlotImpossible,
  planFinishSansVainqueur,
  planForfeit,
} from "../src/bracket-propagation";
import { aCombattuDansLesCombats } from "../src/podium-officiel";
import { K, P3, Tableau } from "./aides-classement";

// ===================================================================
// « ARBITRAGE REQUIS » (DQ1.3, DQ1.4, DQ1.5, SB3.2) : la table unique des fins
// sans vainqueur, sa propagation, et les combats supplémentaires.
// ===================================================================

describe("la table REGLES_FIN_SANS_VAINQUEUR", () => {
  it("chaque ligne a un scénario, et chaque scénario rend la résolution annoncée", () => {
    const scenarios = scenariosFinSansVainqueur();
    for (const regle of REGLES_FIN_SANS_VAINQUEUR) {
      expect(
        scenarios.some((s) => s.regle === regle.id),
        `la ligne ${regle.id} n'a aucun scénario`,
      ).toBe(true);
    }
    for (const s of scenarios) {
      const elimines = new Set(s.eliminations.map((e) => e.registrationId));
      const classable = (r: string) => !elimines.has(r) || aCombattuDansLesCombats(s.fights, r);
      const cible = s.fights.find((f) => f.id === s.cible)!;
      const requis = arbitrageRequisPour(s.fights, cible, classable);
      expect(requis?.resolution ?? null, s.id).toBe(s.attendu);
      if (s.regle !== "designe_indisponible") {
        const ligne = REGLES_FIN_SANS_VAINQUEUR.find((r) => r.id === s.regle)!;
        expect(formatDuTableau(s.fights), s.id).toBe(ligne.format);
        expect(tourDuCombat(cible), s.id).toBe(ligne.tour);
      }
    }
  });

  it("une ligne par combinaison lue : aucune ambiguïté dans la table", () => {
    const cles = REGLES_FIN_SANS_VAINQUEUR.map(
      (r) => `${r.format}|${r.tour}|${r.nature}|${r.autreDemie ?? "-"}`,
    );
    expect(new Set(cles).size).toBe(cles.length);
  });

  it("chaque règle cite sa source, et aucun libellé d'écran ne porte de tiret cadratin", () => {
    for (const r of REGLES_FIN_SANS_VAINQUEUR) {
      expect(r.source, r.id).toMatch(/^(IBJJF Rules Book 6\.1 \(juin 2024\)|Règle CFJJB)/);
      expect(r.libelle.length, r.id).toBeGreaterThan(10);
      expect(`${r.libelle} ${r.source}`, r.id).not.toContain("—");
    }
  });

  it("tableau de trois : le tirage vaut pour les DEUX demi-finales (DQ1.4)", () => {
    const ids = scenariosFinSansVainqueur()
      .filter((s) => s.regle === "trois.demie.technique")
      .map((s) => [s.id, s.attendu]);
    expect(ids).toEqual([
      ["trois.demie.technique.1re_demie", "tirage"],
      ["trois.demie.technique.2e_demie", "tirage"],
    ]);
  });

  it("les cas écrits sont automatiques : catégorie à deux, demie d'au moins quatre, avant les demies", () => {
    const automatiques = REGLES_FIN_SANS_VAINQUEUR.filter((r) => r.resolution === null).map(
      (r) => r.id,
    );
    expect(automatiques).toEqual(
      expect.arrayContaining([
        "deux.finale.technique",
        "deux.finale.disciplinaire",
        "deux.finale.mixte",
        "trois.finale.technique",
        "quatre.demie.technique",
        "quatre.demie.disciplinaire",
        "quatre.demie.mixte",
        "quatre.demie.blessure",
        "quatre.avant_demies.technique",
      ]),
    );
  });

  it("athlète désigné indisponible : le logiciel ne choisit pas, classement saisi", () => {
    const substitutions = scenariosFinSansVainqueur().filter(
      (s) => s.regle === "designe_indisponible",
    );
    expect(substitutions.length).toBe(3);
    for (const s of substitutions) expect(s.attendu).toBe("classement");
  });
});

describe("la propagation attend l'arbitrage", () => {
  it("planFinishSansVainqueur n'écrit aucun emplacement", () => {
    const t = new Tableau(4);
    const plan = planFinishSansVainqueur(t.fights, K(2, 0), {
      method: "double_dq",
      dqReasonA: "technique",
      dqReasonB: "disciplinaire",
    });
    expect(plan.propagation).toEqual([]);
    expect(plan.patches).toEqual([
      expect.objectContaining({
        fightId: K(2, 0),
        state: "finished",
        winner: null,
        winMethod: "double_dq",
        dqReasonA: "technique",
        dqReasonB: "disciplinaire",
        doubleBlessure: false,
      }),
    ]);
  });

  it("demie d'au moins quatre (règle nulle) : l'emplacement de finale est impossible tout de suite", () => {
    const t = new Tableau(4).double(K(2, 0), "technique");
    expect(isSlotImpossible(t.fights, t.combat(K(1, 0)), "A")).toBe(true);
  });

  it("1re demie d'un tableau de trois (tirage) : ni la finale ni la 2e demie ne sont impossibles tant que le tirage attend", () => {
    const t = new Tableau(3).double(K(2, 0), "technique");
    const rep = t.combat(K(2, 1, "BraketFightRepechage3"));
    expect(isSlotImpossible(t.fights, t.combat(K(1, 0)), "A")).toBe(false);
    expect(isSlotImpossible(t.fights, rep, "A")).toBe(false);
    t.arbitre(K(2, 0), "tirage", "B");
    expect(t.combat(K(1, 0)).slotA).toBe("r3");
    expect(t.combat(K(2, 1, "BraketFightRepechage3")).slotA).toBe("r1");
  });

  it("décision « aucun qualifié » : l'emplacement devient impossible, la cascade passe sans adversaire", () => {
    const t = new Tableau(8).double(K(3, 0), "blessure");
    expect(isSlotImpossible(t.fights, t.combat(K(2, 0)), "A")).toBe(false);
    t.arbitre(K(3, 0), "decision", null);
    expect(isSlotImpossible(t.fights, t.combat(K(2, 0)), "A")).toBe(true);
  });

  // DQ1.2 SANS AUCUN ÉLIMINÉ. Le passage sans adversaire ne doit rien à une
  // élimination : borné aux éliminés, le point fixe laissait la demie à venir,
  // case vide, et le tapis attendait un combat qui n'aurait jamais lieu. Aucun
  // appel explicite à la cascade ici : c'est la fin de combat qui la déclenche.
  it("quart en double DQ, AUCUN éliminé : la fin de l'autre quart solde la demie sans adversaire", () => {
    const t = new Tableau(8).double(K(3, 0), "technique").gagne(K(3, 1), "A");
    expect(t.elimines.size).toBe(0);
    expect(t.combat(K(2, 0))).toMatchObject({
      state: "finished",
      winMethod: "wo",
      winner: "r2",
      slotA: null,
    });
  });

  it("autre quart déjà joué, AUCUN éliminé : la double DQ solde la demie tout de suite", () => {
    const t = new Tableau(8).gagne(K(3, 1), "A").double(K(3, 0), "disciplinaire");
    expect(t.combat(K(2, 0))).toMatchObject({ state: "finished", winMethod: "wo", winner: "r2" });
  });

  it("combat pour la 3e place : une décision (technique, mixte, blessure), jamais pour le disciplinaire", () => {
    const attendus = scenariosFinSansVainqueur()
      .filter((s) => s.regle.startsWith("quatre.petite_finale."))
      .map((s) => [s.regle, s.attendu]);
    expect(attendus).toEqual([
      ["quatre.petite_finale.technique", "decision"],
      ["quatre.petite_finale.mixte", "decision"],
      ["quatre.petite_finale.blessure", "decision"],
      ["quatre.petite_finale.disciplinaire", null],
    ]);
  });

  it("les deux demies en double DQ : la cascade ne solde ni n'annule la finale avant l'arbitrage", () => {
    const t = new Tableau(8);
    for (const i of [0, 1, 2, 3]) t.gagne(K(3, i), "A");
    t.double(K(2, 0), "technique").double(K(2, 1), "technique");
    const plan = planForfeit(t.fights, new Set());
    expect(plan.patches.find((p) => p.fightId === K(1, 0))).toBeUndefined();
    // Arbitrage rendu (combats créés) : la finale d'origine n'aura jamais lieu.
    t.arbitre(K(2, 0), null, null).arbitre(K(2, 1), null, null);
    expect(t.combat(K(1, 0)).state).toBe("cancelled");
  });
});

describe("les combats hors grille : l'arithmétique existante les route", () => {
  const t = new Tableau(8).ajouterCombat(2, 2, "r5", "r6").ajouterCombat(2, 3, "r7", "r8");
  t.ajouterCombat(1, 1, null, null);

  it("(2,2) → (1,1) côté A, (2,3) → (1,1) côté B", () => {
    expect(findNextSlot(t.fights, t.combat(K(2, 2)))).toEqual({ fightId: K(1, 1), slot: "A" });
    expect(findNextSlot(t.fights, t.combat(K(2, 3)))).toEqual({ fightId: K(1, 1), slot: "B" });
    expect(findFeederFight(t.fights, t.combat(K(1, 1)), "A")?.id).toBe(K(2, 2));
  });

  it("aucune demie supplémentaire ne descend au combat de 3e place", () => {
    expect(findPool3Slot(t.fights, t.combat(K(2, 2)))).toBeNull();
    expect(findPool3Slot(t.fights, t.combat(K(2, 3)))).toBeNull();
  });

  it("les tours se lisent : hors grille, finale, demie, 3e place", () => {
    expect(estHorsGrille(t.combat(K(1, 1)))).toBe(true);
    expect(tourDuCombat(t.combat(K(2, 2)))).toBe("hors_grille");
    expect(tourDuCombat(t.combat(K(1, 0)))).toBe("finale");
    expect(tourDuCombat(new Tableau(4, "pool3").combat(P3))).toBe("petite_finale");
  });
});

describe("DQ disciplinaire lue sur les combats (point de branchement L7)", () => {
  it("perdant d'un dq disciplinaire, côté disciplinaire d'une double DQ ; jamais un technique", () => {
    const t = new Tableau(4).gagneParDq(K(2, 0), "A", "disciplinaire").double(K(2, 1), "mixte");
    expect(estDisqualifieDisciplinaire(t.fights, "r3")).toBe(true);
    expect(estDisqualifieDisciplinaire(t.fights, "r1")).toBe(false);
    expect(estDisqualifieDisciplinaire(t.fights, "r2")).toBe(false);
    expect(estDisqualifieDisciplinaire(t.fights, "r4")).toBe(true);
  });
});

describe("positionApresRepos : placé après le repos, jamais en tête (DQ1.3)", () => {
  const MIN = 60_000;
  const T0 = Date.UTC(2026, 8, 20, 10, 0, 0);
  const file = [
    { fightId: "x1", dureeSecondes: 300 },
    { fightId: "x2", dureeSecondes: 300 },
    { fightId: "x3", dureeSecondes: 300 },
    { fightId: "x4", dureeSecondes: 300 },
  ];
  const aVenir = { id: "sup", division: 1, dureeSecondes: 300 };

  it("sans repos à respecter : juste après le combat en tête, jamais avant", () => {
    expect(
      positionApresRepos({
        file,
        maintenantMs: T0,
        combatsDesAthletes: [[], []],
        combatAVenir: aVenir,
      }),
    ).toBe(1);
  });

  it("repos d'une finale (deux durées) depuis la fin réelle : le premier rang qui démarre après", () => {
    const combats = [
      {
        id: "demie",
        state: "finished" as const,
        winMethod: "points" as const,
        chronoLance: true,
        finReelleMs: T0,
      },
    ];
    // Fin du repos : T0 + 2 × 5 min = T0 + 10 min. Rangs : 0 → T0, 1 → +5, 2 → +10.
    expect(
      positionApresRepos({
        file,
        maintenantMs: T0,
        combatsDesAthletes: [combats, []],
        combatAVenir: aVenir,
      }),
    ).toBe(2);
  });

  it("au-delà de la file : la dernière position", () => {
    const combats = [
      {
        id: "d",
        state: "finished" as const,
        winMethod: "points" as const,
        chronoLance: true,
        finReelleMs: T0 + 60 * MIN,
      },
    ];
    expect(
      positionApresRepos({
        file,
        maintenantMs: T0,
        combatsDesAthletes: [combats],
        combatAVenir: aVenir,
      }),
    ).toBe(4);
  });
});

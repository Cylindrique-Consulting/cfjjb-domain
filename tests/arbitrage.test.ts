import { describe, expect, it } from "vitest";
import {
  arbitrageRequisPour,
  estHorsGrille,
  formatDuTableau,
  LIBELLE_COTE_SANS_PERDANT_DE_QUART,
  positionApresRepos,
  proposerCombatsSupplementaires,
  REGLE_DESIGNE_INDISPONIBLE,
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
        "trois.demie.blessure",
        "quatre.demie.technique",
        "quatre.demie.disciplinaire",
        "quatre.demie.mixte",
        "quatre.demie.blessure",
        "quatre.avant_demies.technique",
      ]),
    );
  });

  it("tableau de trois, double blessure à égalité : automatique dans les DEUX demies, tirage en finale (SB3.2)", () => {
    const attendus = scenariosFinSansVainqueur()
      .filter((s) => s.regle === "trois.demie.blessure" || s.regle === "trois.finale.blessure")
      .map((s) => [s.id, s.attendu]);
    expect(attendus).toEqual([
      ["trois.demie.blessure.1re_demie", null],
      ["trois.demie.blessure.2e_demie", null],
      ["trois.finale.blessure", "tirage"],
    ]);
  });

  it("athlète désigné indisponible : le logiciel ne choisit pas, classement saisi", () => {
    const substitutions = scenariosFinSansVainqueur().filter(
      (s) => s.regle === "designe_indisponible",
    );
    expect(substitutions.length).toBe(4);
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

  it("2e demie d'un tableau de trois en double blessure : la finale passe tout de suite au vainqueur de la 1re", () => {
    const rep = K(2, 1, "BraketFightRepechage3");
    const t = new Tableau(3).gagne(K(2, 0), "A").double(rep, "blessure");
    expect(t.combat(rep)).toMatchObject({
      state: "finished",
      winner: null,
      slotA: "r3",
      slotB: "r2",
    });
    expect(t.combat(K(1, 0))).toMatchObject({
      state: "finished",
      winMethod: "wo",
      winner: "r1",
      slotB: null,
    });
  });

  it("1re demie d'un tableau de trois en double blessure : le 3e passe la 2e demie puis la finale sans adversaire", () => {
    const rep = K(2, 1, "BraketFightRepechage3");
    const t = new Tableau(3).double(K(2, 0), "blessure");
    expect(t.combat(rep)).toMatchObject({
      state: "finished",
      winMethod: "wo",
      winner: "r2",
      slotA: null,
    });
    expect(t.combat(K(1, 0))).toMatchObject({
      state: "finished",
      winMethod: "wo",
      winner: "r2",
      slotA: null,
    });
  });

  it("décision « aucun qualifié » : l'emplacement devient impossible, la cascade passe sans adversaire", () => {
    const t = new Tableau(8).double(K(3, 0), "blessure");
    expect(isSlotImpossible(t.fights, t.combat(K(2, 0)), "A")).toBe(false);
    t.arbitre(K(3, 0), "decision", null);
    expect(isSlotImpossible(t.fights, t.combat(K(2, 0)), "A")).toBe(true);
  });

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
    t.arbitre(K(2, 0), null, null).arbitre(K(2, 1), null, null);
    expect(t.combat(K(1, 0)).state).toBe("cancelled");
  });
});

describe("quatre demi-finalistes disqualifiés, un quart de finale exempté (recette du 21/09/2026)", () => {
  const septJoue = (nature: "technique" | "disciplinaire") => {
    const t = new Tableau(7);
    for (const i of [0, 1, 2]) t.gagne(K(3, i), "A");
    return t.double(K(2, 0), nature).double(K(2, 1), nature);
  };
  const scenario = (id: string) => scenariosFinSansVainqueur().find((s) => s.id === id)!;

  it("le demi-finaliste exempté ne désigne personne : des combats, pas un classement saisi", () => {
    for (const nature of ["technique", "disciplinaire"] as const) {
      const t = septJoue(nature);
      expect(t.combat(K(3, 3)).isBye).toBe(true);
      for (const demie of [K(2, 0), K(2, 1)]) {
        const requis = arbitrageRequisPour(t.fights, t.combat(demie));
        expect(requis?.resolution, `${nature} ${demie}`).toBe("combats");
        expect(requis?.regle.id, `${nature} ${demie}`).toBe(`quatre.deux_demies.${nature}`);
      }
    }
  });

  it("le seul perdant de quart de son côté va directement en finale", () => {
    const t = septJoue("technique");
    const proposition = proposerCombatsSupplementaires(t.fights, t.combat(K(2, 0)));
    expect(
      proposition?.combats.map((x) => [x.division, x.indexInDivision, x.slotA, x.slotB, x.libelle]),
    ).toEqual([
      [2, 2, "r5", "r6", "Demi-finale supplémentaire"],
      [
        1,
        1,
        null,
        "r7",
        "Finale entre le vainqueur de la demi-finale supplémentaire et le seul perdant de quart de l'autre côté du tableau",
      ],
    ]);
    expect(proposition?.consequences).toEqual([
      "Les quatre disqualifiés des demi-finales sont 3es.",
      "Le perdant de la demi-finale supplémentaire n'a pas de médaille.",
      "Un demi-finaliste disqualifié n'avait pas disputé de quart de finale : de son côté du tableau, le seul perdant de quart va directement en finale.",
    ]);
  });

  it("un quart exempté de chaque côté : la finale oppose directement les deux perdants de quart", () => {
    const s = scenario("quatre.deux_demies.technique.un_quart_exempte_de_chaque_cote");
    const demie = s.fights.find((f) => f.id === s.cible)!;
    expect(s.fights.filter((f) => f.division === 3 && f.isBye).map((f) => f.id)).toEqual([
      K(3, 1),
      K(3, 3),
    ]);
    const proposition = proposerCombatsSupplementaires(s.fights, demie);
    expect(
      proposition?.combats.map((x) => [x.division, x.indexInDivision, x.slotA, x.slotB, x.libelle]),
    ).toEqual([
      [1, 1, "r5", "r7", "Finale entre les seuls perdants de quart de chaque côté du tableau"],
    ]);
    expect(proposition?.consequences).toEqual([
      "Les quatre disqualifiés des demi-finales sont 3es.",
      "Deux demi-finalistes disqualifiés n'avaient pas disputé de quart de finale : de chaque côté du tableau, le seul perdant de quart va directement en finale.",
    ]);
  });

  it("sans quart exempté, la proposition est celle d'avant : deux demies puis leur finale", () => {
    const t = new Tableau(8);
    for (const i of [0, 1, 2, 3]) t.gagne(K(3, i), "A");
    t.double(K(2, 0), "disciplinaire").double(K(2, 1), "disciplinaire");
    const proposition = proposerCombatsSupplementaires(t.fights, t.combat(K(2, 0)));
    expect(proposition?.combats.map((x) => x.libelle)).toEqual([
      "1re demi-finale supplémentaire",
      "2e demi-finale supplémentaire",
      "Finale entre les vainqueurs des demi-finales supplémentaires",
    ]);
    expect(proposition?.consequences).toEqual([
      "Les disqualifiés des demi-finales n'ont pas de médaille.",
      "Les perdants des demi-finales supplémentaires sont 3es.",
    ]);
  });

  it("un côté sans aucun quart disputé : classement saisi, et le libellé dit pourquoi", () => {
    const t = new Tableau(6);
    t.gagne(K(3, 0), "A").gagne(K(3, 1), "A");
    t.double(K(2, 0), "technique").double(K(2, 1), "technique");
    const requis = arbitrageRequisPour(t.fights, t.combat(K(2, 0)));
    expect(requis?.resolution).toBe("classement");
    expect(requis?.regle.libelle).toBe(LIBELLE_COTE_SANS_PERDANT_DE_QUART);
    expect(proposerCombatsSupplementaires(t.fights, t.combat(K(2, 0)))).toBeNull();
  });

  it("un perdant de quart indisponible reste un classement saisi, comme avant", () => {
    const t = septJoue("technique");
    const requis = arbitrageRequisPour(t.fights, t.combat(K(2, 0)), (r) => r !== "r6");
    expect(requis?.resolution).toBe("classement");
    expect(requis?.regle.libelle).toBe(REGLE_DESIGNE_INDISPONIBLE.libelle);
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

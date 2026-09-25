import { describe, expect, it } from "vitest";
import {
  confirmationsConservees,
  controlerLePlanning,
  ECART_DE_DESEQUILIBRE_MINUTES,
  GRAVITE_PAR_TYPE,
  peutConsulterAvantPublication,
  peutGenererOuRetoucherLePlanning,
  peutPublierLePlanning,
  peutValiderLePlanning,
  publicationAutomatique,
  statutDePlanning,
  verdictDePublication,
  type CombatControle,
} from "../src/controles-de-planning";
import { heure } from "./aides-planning";

const combat = (partiel: Partial<CombatControle> & { fightId: string }): CombatControle => ({
  categorieId: "c1",
  tatamiId: "t1",
  jour: 0,
  rang: 1,
  debutMs: heure("09:00"),
  finMs: heure("09:05"),
  division: 3,
  type: "BraketFight",
  dureeSecondes: 300,
  ...partiel,
});

describe("la gravité des contrôles", () => {
  it("refuse la dépendance impossible, bloque la double convocation et le repos insuffisant (RPS.3 B), avertit sur le reste", () => {
    expect(GRAVITE_PAR_TYPE.source_apres_dependant).toBe("refus");
    expect(GRAVITE_PAR_TYPE.double_convocation).toBe("bloquant");
    expect(GRAVITE_PAR_TYPE.repos_insuffisant).toBe("bloquant");
    expect(GRAVITE_PAR_TYPE.depassement_de_journee).toBe("avertissement");
    expect(GRAVITE_PAR_TYPE.desequilibre_de_tatami).toBe("avertissement");
    expect(GRAVITE_PAR_TYPE.repartition_non_examinee).toBe("avertissement");
  });
});

describe("le contrôle des dépendances du tableau", () => {
  it("refuse une source rangée après son dépendant sur le même tatami", () => {
    const constats = controlerLePlanning({
      combats: [
        combat({
          fightId: "finale",
          division: 1,
          rang: 1,
          debutMs: heure("09:00"),
          finMs: heure("09:05"),
          sources: ["demie", null],
        }),
        combat({
          fightId: "demie",
          division: 2,
          rang: 2,
          debutMs: heure("09:06"),
          finMs: heure("09:11"),
        }),
      ],
    });
    expect(constats.map((c) => c.type)).toEqual(["source_apres_dependant"]);
    expect(constats[0]?.gravite).toBe("refus");
  });

  it("refuse une source d'un autre tatami qui finit après le début de son dépendant", () => {
    const constats = controlerLePlanning({
      combats: [
        combat({
          fightId: "finale",
          division: 1,
          rang: 5,
          debutMs: heure("10:00"),
          finMs: heure("10:05"),
          sources: ["demie", null],
        }),
        combat({
          fightId: "demie",
          tatamiId: "t2",
          division: 2,
          rang: 1,
          debutMs: heure("09:58"),
          finMs: heure("10:03"),
        }),
      ],
    });
    expect(constats.map((c) => c.type)).toEqual(["source_apres_dependant"]);
  });

  it("refuse une source planifiée un jour plus tard que son dépendant", () => {
    const constats = controlerLePlanning({
      combats: [
        combat({ fightId: "finale", division: 1, sources: ["demie", null] }),
        combat({ fightId: "demie", jour: 1, division: 2, debutMs: 0, finMs: 1 }),
      ],
    });
    expect(constats.map((c) => c.type)).toEqual(["source_apres_dependant"]);
  });

  it("signale un repos raccourci entre une source et son dépendant, en bloquant (RPS.3 B)", () => {
    const constats = controlerLePlanning({
      combats: [
        combat({
          fightId: "demie",
          division: 2,
          rang: 1,
          debutMs: heure("09:00"),
          finMs: heure("09:05"),
        }),
        combat({
          fightId: "finale",
          division: 1,
          rang: 2,
          debutMs: heure("09:06"),
          finMs: heure("09:11"),
          sources: ["demie", null],
        }),
      ],
    });
    expect(constats).toHaveLength(1);
    expect(constats[0]).toMatchObject({
      type: "repos_insuffisant",
      gravite: "bloquant",
      combatId: "finale",
      autreCombatId: "demie",
      ecartMinutes: 9,
    });
  });

  it("double le repos avant une finale, pas avant une demi-finale", () => {
    const enchainer = (division: number, minutesApres: number) =>
      controlerLePlanning({
        combats: [
          combat({
            fightId: "source",
            division: division + 1,
            rang: 1,
            debutMs: heure("09:00"),
            finMs: heure("09:05"),
          }),
          combat({
            fightId: "suite",
            division,
            rang: 2,
            debutMs: heure("09:05") + minutesApres * 60_000,
            finMs: heure("09:10") + minutesApres * 60_000,
            sources: ["source", null],
          }),
        ],
      });
    expect(enchainer(2, 5)).toEqual([]);
    expect(enchainer(2, 4).map((c) => c.type)).toEqual(["repos_insuffisant"]);
    expect(enchainer(1, 10)).toEqual([]);
    expect(enchainer(1, 9).map((c) => c.type)).toEqual(["repos_insuffisant"]);
  });

  it("ne dit rien d'une source absente du plan contrôlé", () => {
    expect(
      controlerLePlanning({
        combats: [combat({ fightId: "finale", division: 1, sources: ["ailleurs", null] })],
      }),
    ).toEqual([]);
  });
});

describe("le contrôle des athlètes communs", () => {
  const engagement = (partiel: Partial<Parameters<typeof controlerLePlanning>[0]> = {}) => partiel;

  it("bloque la publication quand un athlète est convoqué deux fois en même temps", () => {
    const constats = controlerLePlanning({
      engagements: [
        {
          athleteId: "L1",
          categorieId: "gi",
          competitionId: "GI",
          jour: 0,
          debutMs: heure("09:00"),
          finMs: heure("12:00"),
          dureeSecondes: 300,
        },
        {
          athleteId: "L1",
          categorieId: "nogi",
          competitionId: "NOGI",
          jour: 0,
          debutMs: heure("11:00"),
          finMs: heure("14:00"),
          dureeSecondes: 300,
        },
      ],
    });
    expect(constats).toHaveLength(1);
    expect(constats[0]).toMatchObject({
      type: "double_convocation",
      gravite: "bloquant",
      athleteId: "L1",
      competitionId: "GI",
      autreCompetitionId: "NOGI",
    });
  });

  it("signale un repos trop court entre deux compétitions d'un même événement, en bloquant (RPS.3 B)", () => {
    const constats = controlerLePlanning({
      engagements: [
        {
          athleteId: "L1",
          categorieId: "gi",
          competitionId: "GI",
          jour: 0,
          debutMs: heure("09:00"),
          finMs: heure("12:00"),
          dureeSecondes: 300,
        },
        {
          athleteId: "L1",
          categorieId: "nogi",
          competitionId: "NOGI",
          jour: 0,
          debutMs: heure("12:03"),
          finMs: heure("14:00"),
          dureeSecondes: 300,
        },
      ],
    });
    expect(constats.map((c) => c.type)).toEqual(["repos_insuffisant"]);
    expect(constats[0]?.gravite).toBe("bloquant");
    expect(constats[0]?.ecartMinutes).toBe(2);
  });

  it("se tait quand le repos réglementaire est tenu", () => {
    expect(
      controlerLePlanning({
        engagements: [
          {
            athleteId: "L1",
            categorieId: "gi",
            jour: 0,
            debutMs: heure("09:00"),
            finMs: heure("12:00"),
            dureeSecondes: 300,
          },
          {
            athleteId: "L1",
            categorieId: "nogi",
            jour: 0,
            debutMs: heure("12:05"),
            finMs: heure("14:00"),
            dureeSecondes: 300,
          },
        ],
      }),
    ).toEqual([]);
  });

  it("double le repos quand la catégorie suivante n'a qu'un combat, sa finale", () => {
    const constats = controlerLePlanning({
      engagements: [
        {
          athleteId: "L1",
          categorieId: "poids",
          jour: 0,
          debutMs: heure("09:00"),
          finMs: heure("12:00"),
          dureeSecondes: 300,
        },
        {
          athleteId: "L1",
          categorieId: "absolut",
          jour: 0,
          debutMs: heure("12:06"),
          finMs: heure("12:11"),
          dureeSecondes: 300,
          reposAvantSecondes: 600,
        },
      ],
    });
    expect(constats.map((c) => c.type)).toEqual(["repos_insuffisant"]);
  });

  it("ne compare pas deux journées différentes", () => {
    expect(
      controlerLePlanning({
        engagements: [
          {
            athleteId: "L1",
            categorieId: "samedi",
            jour: 0,
            debutMs: heure("09:00"),
            finMs: heure("18:00"),
            dureeSecondes: 300,
          },
          {
            athleteId: "L1",
            categorieId: "dimanche",
            jour: 1,
            debutMs: heure("09:00"),
            finMs: heure("18:00"),
            dureeSecondes: 300,
          },
        ],
      }),
    ).toEqual([]);
    expect(engagement()).toEqual({});
  });

  it("ne se plaint pas d'un athlète vu deux fois dans la même catégorie", () => {
    expect(
      controlerLePlanning({
        engagements: [
          {
            athleteId: "L1",
            categorieId: "c",
            jour: 0,
            debutMs: heure("09:00"),
            finMs: heure("10:00"),
            dureeSecondes: 300,
          },
          {
            athleteId: "L1",
            categorieId: "c",
            jour: 0,
            debutMs: heure("09:00"),
            finMs: heure("10:00"),
            dureeSecondes: 300,
          },
        ],
      }),
    ).toEqual([]);
  });
});

describe("le contrôle des horaires de journée", () => {
  const finDeTatami = (tatamiId: string, fin: string): CombatControle =>
    combat({
      fightId: `f-${tatamiId}`,
      categorieId: `c-${tatamiId}`,
      tatamiId,
      debutMs: heure(fin) - 5 * 60_000,
      finMs: heure(fin),
    });

  it("avertit d'un tatami qui finit après l'heure de fin de sa journée", () => {
    const constats = controlerLePlanning({
      combats: [finDeTatami("t1", "22:45"), finDeTatami("t2", "22:40")],
      journees: [{ jour: 0, finMs: heure("22:30") }],
    });
    expect(constats.map((c) => c.type)).toEqual([
      "depassement_de_journee",
      "depassement_de_journee",
    ]);
    expect(constats[0]?.ecartMinutes).toBe(15);
  });

  it("avertit du déséquilibre de Charléty : Tatami 1 à 21:41, les autres avant 19:20, qui finissent plus d'une heure avant les autres", () => {
    const constats = controlerLePlanning({
      combats: [finDeTatami("t1", "21:41"), finDeTatami("t2", "19:17"), finDeTatami("t3", "19:05")],
      journees: [{ jour: 0, finMs: heure("22:30") }],
    });
    expect(constats.map((c) => c.type)).toEqual([
      "desequilibre_de_tatami",
      "desequilibre_de_tatami",
      "desequilibre_de_tatami",
    ]);
    expect(constats[0]).toMatchObject({ tatamiId: "t1", jour: 0, ecartMinutes: 150 });
    expect(constats[1]).toMatchObject({ tatamiId: "t2", jour: 0, ecartMinutes: -66 });
    expect(constats[2]).toMatchObject({ tatamiId: "t3", jour: 0, ecartMinutes: -84 });
  });

  it("avertit aussi d'un tatami qui finit plus d'une heure avant la moyenne des autres : T2 de l'Open IdF à 16:45", () => {
    const constats = controlerLePlanning({
      combats: [
        finDeTatami("t1", "19:13"),
        finDeTatami("t2", "16:45"),
        finDeTatami("t3", "18:31"),
        finDeTatami("t4", "19:18"),
        finDeTatami("t5", "19:06"),
        finDeTatami("t6", "18:58"),
      ],
    }).filter((c) => c.type === "desequilibre_de_tatami");
    expect(constats.map((c) => [c.tatamiId, c.ecartMinutes])).toEqual([["t2", -136]]);
  });

  it("tolère un écart de 60 minutes, avertit au-delà", () => {
    const ecart = (minutes: number) =>
      controlerLePlanning({
        combats: [
          finDeTatami("t1", "19:00"),
          combat({
            fightId: "f-t2",
            categorieId: "c2",
            tatamiId: "t2",
            debutMs: heure("19:00") + minutes * 60_000 - 5 * 60_000,
            finMs: heure("19:00") + minutes * 60_000,
          }),
        ],
      }).filter((c) => c.type === "desequilibre_de_tatami");
    expect(ecart(ECART_DE_DESEQUILIBRE_MINUTES)).toEqual([]);
    // À deux tatamis, chacun est l'« autre » de l'autre : le premier finit en avance, le second en retard.
    expect(
      ecart(ECART_DE_DESEQUILIBRE_MINUTES + 1).map((c) => [c.tatamiId, c.ecartMinutes]),
    ).toEqual([
      ["t1", -(ECART_DE_DESEQUILIBRE_MINUTES + 1)],
      ["t2", ECART_DE_DESEQUILIBRE_MINUTES + 1],
    ]);
  });

  it("ne parle pas de déséquilibre quand un seul tatami travaille", () => {
    expect(
      controlerLePlanning({ combats: [finDeTatami("t1", "21:41")] }).filter(
        (c) => c.type === "desequilibre_de_tatami",
      ),
    ).toEqual([]);
  });

  it("compare les tatamis de la même journée seulement", () => {
    const constats = controlerLePlanning({
      combats: [
        finDeTatami("t1", "19:00"),
        combat({
          fightId: "f-demain",
          categorieId: "c-demain",
          tatamiId: "t2",
          jour: 1,
          debutMs: heure("09:00"),
          finMs: heure("23:00"),
        }),
      ],
    });
    expect(constats).toEqual([]);
  });
});

describe("le contrôle des propositions de répartition", () => {
  it("avertit d'une proposition de répartition non examinée", () => {
    const constats = controlerLePlanning({
      categories: [{ id: "grande", tatamis: 8, etatDeRepartition: "proposee" }],
    });
    expect(constats.map((c) => c.type)).toEqual(["repartition_non_examinee"]);
  });

  it("se tait quand la proposition a été acceptée, modifiée ou refusée", () => {
    for (const etat of ["acceptee", "modifiee", "refusee"] as const) {
      expect(
        controlerLePlanning({
          categories: [{ id: "grande", tatamis: 8, etatDeRepartition: etat }],
        }),
      ).toEqual([]);
    }
  });

  it("ne réclame rien pour une catégorie que l'outil laisse sur un seul tatami", () => {
    expect(
      controlerLePlanning({
        categories: [{ id: "petite", tatamis: 1, etatDeRepartition: "proposee" }],
      }),
    ).toEqual([]);
  });
});

describe("le verdict de publication", () => {
  const demie = combat({
    fightId: "demie",
    division: 2,
    rang: 1,
    debutMs: heure("09:00"),
    finMs: heure("09:05"),
  });
  const finale = combat({
    fightId: "finale",
    division: 1,
    rang: 2,
    debutMs: heure("09:15"),
    finMs: heure("09:20"),
    sources: ["demie", null],
  });
  const journees = [{ jour: 0, finMs: heure("09:18") }];
  const constats = controlerLePlanning({ combats: [demie, finale], journees });

  it("interdit la publication tant qu'un avertissement n'est pas confirmé", () => {
    const verdict = verdictDePublication(constats);
    expect(verdict.publiable).toBe(false);
    expect(verdict.aConfirmer.map((c) => c.type)).toEqual(["depassement_de_journee"]);
  });

  it("autorise la publication quand le responsable confirme l'avertissement", () => {
    const cles = constats.map((c) => c.cle);
    const verdict = verdictDePublication(constats, cles);
    expect(verdict.publiable).toBe(true);
    expect(verdict.aConfirmer).toEqual([]);
  });

  it("ne lève jamais une double convocation par une confirmation", () => {
    const bloquants = controlerLePlanning({
      engagements: [
        {
          athleteId: "L1",
          categorieId: "a",
          jour: 0,
          debutMs: heure("09:00"),
          finMs: heure("12:00"),
          dureeSecondes: 300,
        },
        {
          athleteId: "L1",
          categorieId: "b",
          jour: 0,
          debutMs: heure("10:00"),
          finMs: heure("13:00"),
          dureeSecondes: 300,
        },
      ],
    });
    const verdict = verdictDePublication(
      bloquants,
      bloquants.map((c) => c.cle),
    );
    expect(verdict.publiable).toBe(false);
    expect(verdict.bloquants).toHaveLength(1);
  });

  it("ne lève jamais un repos insuffisant par une confirmation (RPS.3 B)", () => {
    const raccourci = controlerLePlanning({
      combats: [demie, { ...finale, debutMs: heure("09:06"), finMs: heure("09:11") }],
    });
    expect(raccourci.map((c) => c.type)).toEqual(["repos_insuffisant"]);
    const verdict = verdictDePublication(
      raccourci,
      raccourci.map((c) => c.cle),
    );
    expect(verdict.publiable).toBe(false);
    expect(verdict.bloquants.map((c) => c.type)).toEqual(["repos_insuffisant"]);
    expect(verdict.aConfirmer).toEqual([]);
  });

  it("ne lève jamais un refus par une confirmation", () => {
    const refus = controlerLePlanning({
      combats: [
        combat({ fightId: "finale", division: 1, rang: 1, sources: ["demie", null] }),
        combat({
          fightId: "demie",
          division: 2,
          rang: 2,
          debutMs: heure("09:06"),
          finMs: heure("09:11"),
        }),
      ],
    });
    const verdict = verdictDePublication(
      refus,
      refus.map((c) => c.cle),
    );
    expect(verdict.publiable).toBe(false);
    expect(verdict.refus).toHaveLength(1);
  });

  it("signale une confirmation devenue inutile", () => {
    const verdict = verdictDePublication(constats, ["clé d'un avertissement disparu"]);
    expect(verdict.confirmationsInutiles).toEqual(["clé d'un avertissement disparu"]);
  });

  it("garde les confirmations des avertissements qu'une retouche ne touche pas", () => {
    const cles = constats.map((c) => c.cle);
    expect(confirmationsConservees([...cles, "clé périmée"], constats)).toEqual([...cles].sort());
  });

  it("donne à chaque constat une clé stable, indépendante de l'ordre de lecture", () => {
    const relu = controlerLePlanning({ combats: [finale, demie], journees });
    expect(constats).toHaveLength(1);
    expect(relu.map((c) => c.cle)).toEqual(constats.map((c) => c.cle));
  });
});

describe("qui valide, retouche et publie le planning", () => {
  it("n'ouvre jamais l'outil de préparation à l'identifiant de poste partagé", () => {
    const poste = {
      identifiantDePostePartage: true,
      compteFederalAutoriseAModifier: true,
      responsableDesigneSurLaFiche: true,
    };
    expect(peutConsulterAvantPublication(poste)).toBe(false);
    expect(peutValiderLePlanning(poste)).toBe(false);
    expect(peutGenererOuRetoucherLePlanning(poste)).toBe(false);
    expect(peutPublierLePlanning(poste)).toBe(false);
  });

  it("laisse valider un responsable désigné sur la fiche, avec son compte personnel", () => {
    const responsable = { responsableDesigneSurLaFiche: true };
    expect(peutConsulterAvantPublication(responsable)).toBe(true);
    expect(peutValiderLePlanning(responsable)).toBe(true);
    expect(peutGenererOuRetoucherLePlanning(responsable)).toBe(false);
    expect(peutPublierLePlanning(responsable)).toBe(false);
  });

  it("laisse un compte fédéral autorisé générer, retoucher, valider et publier", () => {
    const federal = { compteFederalAutoriseAModifier: true };
    expect(peutConsulterAvantPublication(federal)).toBe(true);
    expect(peutValiderLePlanning(federal)).toBe(true);
    expect(peutGenererOuRetoucherLePlanning(federal)).toBe(true);
    expect(peutPublierLePlanning(federal)).toBe(true);
  });

  it("ferme tout à un compte sans rôle sur la compétition", () => {
    expect(peutConsulterAvantPublication({})).toBe(false);
    expect(peutValiderLePlanning({})).toBe(false);
  });
});

describe("le circuit de publication", () => {
  it("nomme le statut du planning", () => {
    expect(statutDePlanning({ valide: false, publieLe: null, retoucheLe: null })).toBe("brouillon");
    expect(statutDePlanning({ valide: true, publieLe: null, retoucheLe: null })).toBe("valide");
    expect(statutDePlanning({ valide: true, publieLe: 100, retoucheLe: null })).toBe("publie");
    expect(statutDePlanning({ valide: true, publieLe: 100, retoucheLe: 90 })).toBe("publie");
    expect(statutDePlanning({ valide: false, publieLe: 100, retoucheLe: 110 })).toBe(
      "modifie_apres_publication",
    );
  });

  it("publie à l'échéance un planning validé", () => {
    expect(
      publicationAutomatique({ statut: "valide", publicationPrevueMs: 100, maintenantMs: 100 }),
    ).toBe("publier");
  });

  it("attend avant l'échéance", () => {
    expect(
      publicationAutomatique({ statut: "valide", publicationPrevueMs: 100, maintenantMs: 99 }),
    ).toBe("attendre");
  });

  it("ne publie rien et alerte quand le planning n'est pas validé à l'échéance", () => {
    expect(
      publicationAutomatique({ statut: "brouillon", publicationPrevueMs: 100, maintenantMs: 101 }),
    ).toBe("alerter");
  });

  it("laisse la republication à la main après une retouche", () => {
    expect(
      publicationAutomatique({
        statut: "modifie_apres_publication",
        publicationPrevueMs: 100,
        maintenantMs: 200,
      }),
    ).toBe("rien_a_faire");
  });

  it("ne fait rien sans date de publication sur la fiche", () => {
    expect(
      publicationAutomatique({ statut: "valide", publicationPrevueMs: null, maintenantMs: 100 }),
    ).toBe("rien_a_faire");
  });
});

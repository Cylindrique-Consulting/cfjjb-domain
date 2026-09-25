import { describe, expect, it } from "vitest";
import { regrouperLesDerniersTours } from "../src/convergence-des-branches";
import {
  comparerLesPlans,
  evaluerLaJournee,
  MARGE_ENTRE_PLANS_MINUTES,
  OBJECTIFS_DU_PLANNING,
  retoucheSansRetard,
  sourcesDesCombats,
  type EvaluationDeJournee,
} from "../src/objectifs-du-planning";
import { planifierCombats, type EntreeDePlanification } from "../src/ordonnanceur-planning";
import { MINUTE, heure, monter, sourcesDuMontage, tableau, tatamis } from "./aides-planning";

const NEUF_HEURES = heure("09:00");

function evaluation(partiel: Partial<EvaluationDeJournee> = {}): EvaluationDeJournee {
  return {
    jour: 0,
    combatsSansHoraire: 0,
    finMs: heure("18:00"),
    tatamiInutiliseMs: 0,
    repartitionsDesequilibrees: 0,
    ecartDesBranchesMs: 0,
    ecartALaHierarchie: 0,
    parcoursSurTroisTatamis: 0,
    changementsDeTatami: 0,
    reposDeConfortManques: 0,
    ...partiel,
  };
}

describe("l'ordre des objectifs du §18 et la marge de 5 minutes (ORD.9 B)", () => {
  it("six objectifs, dans l'ordre du §18 ; la marge est de 5 minutes", () => {
    expect(OBJECTIFS_DU_PLANNING).toEqual([
      "fin_de_journee",
      "tatami_inutilise",
      "repartition_des_tableaux",
      "hierarchie_des_tatamis",
      "continuite_des_branches",
      "repos_de_confort",
    ]);
    expect(MARGE_ENTRE_PLANS_MINUTES).toBe(5);
  });

  it("une fin plus précoce de 5 minutes ou plus l'emporte, quels que soient les objectifs suivants", () => {
    const tot = evaluation({
      finMs: heure("18:00"),
      tatamiInutiliseMs: 60 * MINUTE,
      parcoursSurTroisTatamis: 12,
      reposDeConfortManques: 40,
    });
    const tard = evaluation({ finMs: heure("18:05") });
    expect(comparerLesPlans(tot, tard)).toEqual({ ordre: -1, objectif: "fin_de_journee" });
    expect(comparerLesPlans(tard, tot)).toEqual({ ordre: 1, objectif: "fin_de_journee" });
  });

  it("à moins de 5 minutes, les objectifs suivants départagent ; sans la marge, la minute l'emporterait (témoin)", () => {
    const continu = evaluation({ finMs: heure("18:04"), parcoursSurTroisTatamis: 0 });
    const disperse = evaluation({ finMs: heure("18:00"), parcoursSurTroisTatamis: 4 });
    expect(comparerLesPlans(continu, disperse)).toEqual({
      ordre: -1,
      objectif: "continuite_des_branches",
    });
    // Témoin : l'ordre strict (marge nulle) donne la victoire aux 4 minutes gagnées.
    expect(comparerLesPlans(continu, disperse, { margeMs: 0 })).toEqual({
      ordre: 1,
      objectif: "fin_de_journee",
    });
  });

  it("les objectifs départagent dans l'ordre : chacun passe devant tous ceux qui le suivent", () => {
    const pire: Partial<EvaluationDeJournee> = {
      tatamiInutiliseMs: 30 * MINUTE,
      repartitionsDesequilibrees: 2,
      ecartDesBranchesMs: 40 * MINUTE,
      ecartALaHierarchie: 100,
      parcoursSurTroisTatamis: 8,
      changementsDeTatami: 20,
      reposDeConfortManques: 30,
    };
    const cles = Object.keys(pire) as (keyof EvaluationDeJournee)[];
    const attendus = [
      "tatami_inutilise",
      "repartition_des_tableaux",
      "repartition_des_tableaux",
      "hierarchie_des_tatamis",
      "continuite_des_branches",
      "continuite_des_branches",
      "repos_de_confort",
    ];
    cles.forEach((cle, rang) => {
      // `a` est meilleur sur cet objectif et pire sur tous les suivants.
      const a = evaluation({ finMs: heure("18:02") });
      const b = evaluation();
      for (const suivante of cles.slice(rang + 1)) {
        (a as Record<string, number | null>)[suivante] = pire[suivante] as number;
      }
      (b as Record<string, number | null>)[cle] = pire[cle] as number;
      expect(comparerLesPlans(a, b)).toEqual({ ordre: -1, objectif: attendus[rang] });
    });
  });

  it("les objectifs mesurés en temps gardent la marge : 4 minutes de tatami vide de plus ne départagent pas", () => {
    const a = evaluation({ tatamiInutiliseMs: 4 * MINUTE, reposDeConfortManques: 0 });
    const b = evaluation({ tatamiInutiliseMs: 0, reposDeConfortManques: 6 });
    expect(comparerLesPlans(a, b)).toEqual({ ordre: -1, objectif: "repos_de_confort" });
    const c = evaluation({ tatamiInutiliseMs: 5 * MINUTE, reposDeConfortManques: 0 });
    expect(comparerLesPlans(c, b)).toEqual({ ordre: 1, objectif: "tatami_inutilise" });
  });

  it("à égalité sur tous les objectifs, la fin la plus précoce l'emporte, même d'une minute ; un plan identique ne l'emporte pas", () => {
    const a = evaluation({ finMs: heure("18:01") });
    const b = evaluation({ finMs: heure("18:00") });
    expect(comparerLesPlans(a, b)).toEqual({ ordre: 1, objectif: "fin_de_journee" });
    expect(comparerLesPlans(b, b)).toEqual({ ordre: 0, objectif: null });
  });

  it("un plan qui laisse moins de combats sans horaire l'emporte toujours", () => {
    const complet = evaluation({ finMs: heure("20:00") });
    const troue = evaluation({ finMs: heure("17:00"), combatsSansHoraire: 1 });
    expect(comparerLesPlans(complet, troue).ordre).toBeLessThan(0);
  });
});

describe("une retouche qui ne coûte rien (REP.5 C, REP.6 A, RPS.5 A)", () => {
  it("refusée si la journée finit plus tard, même d'une minute et même mieux ailleurs", () => {
    const courant = evaluation({ parcoursSurTroisTatamis: 8 });
    const plusTard = evaluation({ finMs: heure("18:01"), parcoursSurTroisTatamis: 0 });
    // Témoin : l'ordre du §18 seul (marge de 5 minutes) la préférerait.
    expect(comparerLesPlans(plusTard, courant).ordre).toBeLessThan(0);
    expect(retoucheSansRetard(plusTard, courant)).toBe(false);
  });

  it("gardée à fin égale quand un objectif s'améliore, refusée quand rien ne change ou qu'un objectif antérieur recule", () => {
    const courant = evaluation({ parcoursSurTroisTatamis: 8 });
    expect(retoucheSansRetard(evaluation({ parcoursSurTroisTatamis: 0 }), courant)).toBe(true);
    expect(retoucheSansRetard(evaluation({ parcoursSurTroisTatamis: 8 }), courant)).toBe(false);
    expect(
      retoucheSansRetard(
        evaluation({ parcoursSurTroisTatamis: 0, ecartALaHierarchie: 5 }),
        courant,
      ),
    ).toBe(false);
    expect(
      retoucheSansRetard(evaluation({ parcoursSurTroisTatamis: 0, combatsSansHoraire: 1 }), {
        ...courant,
      }),
    ).toBe(false);
  });
});

describe("les mesures d'une journée", () => {
  const unTatami = [{ id: "t1", numero: 1, debutParJour: { 0: NEUF_HEURES } }];

  it("repos de confort seul sur son tatami : le confort est offert (objectif 6), son attente ne compte pas comme un tatami inutilisé (RPS.5 A), mais il retarde la fin", () => {
    const montage = monter([
      { id: "c", fights: tableau(8), tatamis: tatamis(1), dureeSecondes: 300, rangDePlanning: 0 },
    ]);
    const entree = (reposDeConfort: boolean): EntreeDePlanification => ({
      espacementSecondes: 60,
      reposDeConfort,
      tatamis: unTatami,
      categories: montage.categories,
      combats: montage.combats,
    });
    const minimal = evaluerLaJournee(entree(false), planifierCombats(entree(false)), 0);
    const confort = evaluerLaJournee(entree(true), planifierCombats(entree(true)), 0);
    expect(minimal.tatamiInutiliseMs).toBe(0);
    expect(confort.tatamiInutiliseMs).toBe(0);
    expect(minimal.reposDeConfortManques).toBeGreaterThan(0);
    expect(confort.reposDeConfortManques).toBe(0);
    expect(confort.finMs).toBeGreaterThan(minimal.finMs as number);
    // Le confort retarde la fin : il est refusé.
    expect(retoucheSansRetard(confort, minimal)).toBe(false);
    expect(minimal.combatsSansHoraire).toBe(0);
    // Témoin : lu avec le repos réglementaire, le plan de confort laisserait le tatami vide.
    const confortLuSansConfort = evaluerLaJournee(entree(false), planifierCombats(entree(true)), 0);
    expect(confortLuSansConfort.tatamiInutiliseMs).toBeGreaterThan(0);
  });

  it("à quatre parties, un athlète sur quatre passe par trois tatamis ; regroupées sur le tatami de la finale, les demi-finales n'en laissent aucun", () => {
    const montage = monter([
      { id: "c", fights: tableau(16), tatamis: tatamis(4), dureeSecondes: 300, rangDePlanning: 0 },
    ]);
    const quatre = tatamis(4).map((t) => ({ ...t, debutParJour: { 0: NEUF_HEURES } }));
    const base: EntreeDePlanification = {
      espacementSecondes: 60,
      tatamis: quatre,
      categories: montage.categories,
      combats: montage.combats,
    };
    const contexte = { partiesParCategorie: new Map([["c", 4]]) };
    const avant = evaluerLaJournee(base, planifierCombats(base), 0, contexte);
    expect(avant.parcoursSurTroisTatamis).toBe(4);
    const regroupe = regrouperLesDerniersTours(
      montage.combats,
      4,
      new Map(montage.combats.map((c) => [c.id, c.tatamiId] as const)),
      1,
    );
    const apresEntree: EntreeDePlanification = {
      ...base,
      combats: montage.combats.map((c) => ({ ...c, tatamiId: regroupe.get(c.id) ?? c.tatamiId })),
    };
    const apres = evaluerLaJournee(apresEntree, planifierCombats(apresEntree), 0, contexte);
    expect(apres.parcoursSurTroisTatamis).toBe(0);
    expect(apres.changementsDeTatami).toBeLessThan(avant.changementsDeTatami);
    // Sans le nombre de parties, la catégorie compte pour une seule branche.
    expect(evaluerLaJournee(base, planifierCombats(base), 0).parcoursSurTroisTatamis).toBe(0);
  });

  it("écart à la hiérarchie : une noire adulte sur le meilleur tatami ne coûte rien, sur un tatami de rang 2 elle coûte 13 par combat", () => {
    const montage = monter([
      {
        id: "noire",
        fights: tableau(4),
        tatamis: tatamis(1),
        dureeSecondes: 600,
        rangDePlanning: 0,
      },
    ]);
    const entree: EntreeDePlanification = {
      espacementSecondes: 60,
      tatamis: unTatami,
      categories: montage.categories,
      combats: montage.combats,
    };
    const resultat = planifierCombats(entree);
    const rangPrioritaireParCategorie = new Map([["noire", 1]]);
    const surLeMeilleur = evaluerLaJournee(entree, resultat, 0, {
      rangPrioritaireParCategorie,
      rangQualiteParTatami: new Map([["t1", 1]]),
    });
    const surUnMoinsBon = evaluerLaJournee(entree, resultat, 0, {
      rangPrioritaireParCategorie,
      rangQualiteParTatami: new Map([["t1", 2]]),
    });
    expect(surLeMeilleur.ecartALaHierarchie).toBe(0);
    expect(surUnMoinsBon.ecartALaHierarchie).toBe(13 * 3);
  });

  it("l'écart des branches : deux parties qui finissent ensemble ne comptent rien ; l'une retardée compte son retard", () => {
    const montage = monter([
      { id: "c", fights: tableau(8), tatamis: tatamis(2), dureeSecondes: 300, rangDePlanning: 0 },
    ]);
    const deux = tatamis(2).map((t) => ({ ...t, debutParJour: { 0: NEUF_HEURES } }));
    const contexte = { partiesParCategorie: new Map([["c", 2]]) };
    const ensemble: EntreeDePlanification = {
      espacementSecondes: 60,
      tatamis: deux,
      categories: montage.categories,
      combats: montage.combats,
    };
    expect(
      evaluerLaJournee(ensemble, planifierCombats(ensemble), 0, contexte).ecartDesBranchesMs,
    ).toBe(0);
    const decale: EntreeDePlanification = {
      ...ensemble,
      categories: montage.categories.map((c) => ({
        ...c,
        debutAuPlusTotParTatami: { t2: heure("10:00") },
      })),
    };
    const mesure = evaluerLaJournee(decale, planifierCombats(decale), 0, contexte);
    expect(mesure.ecartDesBranchesMs).toBe(60 * MINUTE);
    // La branche décalée attend alors qu'elle pourrait partir : le tatami est inutilisé.
    expect(mesure.tatamiInutiliseMs).toBe(60 * MINUTE);
    expect(mesure.repartitionsDesequilibrees).toBe(0);
    expect(
      evaluerLaJournee(decale, planifierCombats(decale), 0, {
        partiesParCategorie: new Map([["c", 3]]),
      }).repartitionsDesequilibrees,
    ).toBe(1);
  });

  it("les sources sont celles que lit l'ordonnanceur", () => {
    const montage = monter([
      { id: "c", fights: tableau(6), tatamis: tatamis(1), dureeSecondes: 300, rangDePlanning: 0 },
    ]);
    expect(sourcesDesCombats(montage.combats)).toEqual(sourcesDuMontage(montage));
  });
});

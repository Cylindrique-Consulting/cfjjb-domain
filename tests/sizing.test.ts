import { describe, expect, it } from "vitest";
import { DEFAULT_FORMAT_BY_AGE_GROUP, type FormatByAgeGroup } from "../src/competition-format";
import {
  computeTatamiSchedule,
  planCategories,
  type SchedulableCategory,
} from "../src/planning-generator";
import {
  buildSizingPanel,
  evaluateTatamiCount,
  projectCategories,
  recommendTatamiCount,
  toPlanningCategories,
  toSchedulableCategories,
  type SizingRegistration,
} from "../src/sizing";

const JOUR = new Date("2026-11-14T08:00:00Z").getTime();
const DEUX_HEURES = 2 * 3600 * 1000;

const POOL3 = { thirdPlaceMode: "pool3" } as const;
const SHARED = { thirdPlaceMode: "shared_bronze" } as const;

let compteur = 0;
function inscriptions(
  n: number,
  gabarit: Partial<SizingRegistration> & Pick<SizingRegistration, "ageGroup" | "weightClass">,
): SizingRegistration[] {
  return Array.from({ length: n }, () => ({
    registrationId: `r${++compteur}`,
    clubId: null,
    status: "paid",
    discipline: "gi" as const,
    belt: "blue" as const,
    gender: "male" as const,
    ...gabarit,
  }));
}

/** Trois catégories de huit, sur trois durées de combat différentes. */
function troisCategoriesDeHuit(): SizingRegistration[] {
  return [
    // bleue / Adulte : 6 min de combat.
    ...inscriptions(8, { ageGroup: "Adulte", weightClass: "Pena" }),
    // blanche / Adulte : 5 min.
    ...inscriptions(8, { ageGroup: "Adulte", weightClass: "Leve", belt: "white" }),
    // grise / U11 : 4 min.
    ...inscriptions(8, { ageGroup: "U11", weightClass: "Pena", belt: "grey" }),
  ];
}

// ===================================================================
// LA PROJECTION VIRTUELLE : des catégories AVANT toute génération
// ===================================================================

describe("projectCategories", () => {
  it("produit des catégories, leurs combats et leurs médailles SANS aucune ligne de base", () => {
    const projection = projectCategories(troisCategoriesDeHuit(), SHARED);
    expect(projection.categories).toHaveLength(3);
    expect(projection.categories.map((c) => c.fullname).sort()).toEqual([
      "Blanche - Adulte - Homme - Leve",
      "Bleue - Adulte - Homme - Pena",
      "Grise - U11 - Garçon - Pena",
    ]);
    // Huit inscrits, arbre complet, aucun bye, aucun combat de 3e place en
    // bronze partagé : sept combats par catégorie.
    expect(projection.categories.map((c) => c.realFightCount)).toEqual([7, 7, 7]);
    expect(projection.categories.map((c) => c.fightTimeSeconds)).toEqual([360, 300, 240]);
  });

  it("ne place QUE les inscriptions actives : un pré-inscrit n'entre dans aucune catégorie", () => {
    const rows = [
      ...inscriptions(4, { ageGroup: "Adulte", weightClass: "Pena" }),
      ...inscriptions(3, { ageGroup: "Adulte", weightClass: "Pena", status: "pre_registered" }),
      ...inscriptions(2, { ageGroup: "Adulte", weightClass: "Pena", status: "withdrawn" }),
      ...inscriptions(1, { ageGroup: "Adulte", weightClass: "Pena", status: "no_show" }),
    ];
    const projection = projectCategories(rows, SHARED);
    expect(projection.categories).toHaveLength(1);
    expect(projection.categories[0]?.competitorCount).toBe(4);
    // Le décompte complet reste rendu, pour être affiché À CÔTÉ.
    expect(projection.breakdown).toEqual({
      active: 4,
      preRegistered: 3,
      noShow: 1,
      withdrawn: 2,
      countedTotal: 8,
      unknown: 0,
    });
  });

  it("groupe sur le tuple BRUT : deux vocabulaires font deux catégories, comme chez le générateur", () => {
    // `adult` (code ETL) et `Adulte` (libellé plateforme) désignent la même
    // tranche, mais `tupleKeyOf` groupe sur la colonne telle quelle : le
    // générateur produira DEUX tableaux et DEUX podiums. Les fusionner ici
    // annoncerait une catégorie et un jeu de médailles de moins que la réalité.
    const rows = [
      ...inscriptions(4, { ageGroup: "Adulte", weightClass: "Pena" }),
      ...inscriptions(4, { ageGroup: "adult", weightClass: "Pena" }),
    ];
    const projection = projectCategories(rows, SHARED);
    expect(projection.categories).toHaveLength(2);
    // Les deux sont bien résolues vers la même tranche pour la DURÉE.
    expect(projection.categories.map((c) => c.ageGroup)).toEqual(["Adulte", "Adulte"]);
    expect(projection.categories.map((c) => c.fightTimeSeconds)).toEqual([360, 360]);
  });

  it("ÉCARTE et COMPTE ce qu'il ne sait pas nommer, sans jamais approximer une durée", () => {
    const rows = [
      ...inscriptions(2, { ageGroup: "Adulte", weightClass: "Pena" }),
      // `master` ne désigne aucune tranche unique : refus assumé.
      ...inscriptions(3, { ageGroup: "master", weightClass: "Pena" }),
      // « 500 » est une aberration mesurée de la colonne.
      ...inscriptions(2, { ageGroup: "Adulte", weightClass: "500" }),
      // Colonnes de catégorie absentes : les lignes miroir legacy.
      ...inscriptions(1, { ageGroup: null, weightClass: "Pena" }),
      // Marron en Juvénile : la combinaison n'existe pas au référentiel.
      ...inscriptions(4, { ageGroup: "Juvénile", weightClass: "Pena", belt: "brown" }),
    ];
    const projection = projectCategories(rows, SHARED);
    expect(projection.categories).toHaveLength(1);
    expect(projection.rejections).toEqual({
      colonnesManquantes: 1,
      ageNonResolu: 3,
      classeNonResolue: 2,
      dureeInconnue: 4,
    });
  });

  it("rend le format RÉELLEMENT appliqué, et le repli quand la poule est trop grosse", () => {
    const enPoule: FormatByAgeGroup = { ...DEFAULT_FORMAT_BY_AGE_GROUP, Adulte: "pools" };
    const petite = projectCategories(inscriptions(4, { ageGroup: "Adulte", weightClass: "Pena" }), {
      ...SHARED,
      formatTable: enPoule,
    });
    expect(petite.categories[0]?.appliedFormat).toBe("pools");
    expect(petite.categories[0]?.realFightCount).toBe(6);

    const grosse = projectCategories(inscriptions(8, { ageGroup: "Adulte", weightClass: "Pena" }), {
      ...SHARED,
      formatTable: enPoule,
    });
    expect(grosse.categories[0]?.requestedFormat).toBe("pools");
    expect(grosse.categories[0]?.appliedFormat).toBe("single_elim");
    expect(grosse.categories[0]?.fallback).toMatchObject({ code: "pool-too-large" });
  });
});

// ===================================================================
// LES MÉDAILLES, COMMANDÉES AVANT LA GÉNÉRATION
// ===================================================================

describe("buildSizingPanel — les médailles", () => {
  const OPTS_BASE = {
    dayStartMs: JOUR,
    dayEndMs: JOUR + DEUX_HEURES,
  };

  it("chiffre les médailles à partir des seules inscriptions, sans competition_categories", () => {
    const panneau = buildSizingPanel(troisCategoriesDeHuit(), { ...SHARED, ...OPTS_BASE });
    // Trois catégories de huit en bronze partagé : or + argent + deux bronzes.
    expect(panneau.medals).toEqual({ gold: 3, silver: 3, bronze: 6, total: 12 });
    expect(panneau.categoryCount).toBe(3);
    expect(panneau.competitorCount).toBe(24);
    expect(panneau.fightCount).toBe(21);
  });

  it("donne l'or automatique au seul inscrit, et ne lui donne aucune minute de tapis", () => {
    const rows = [
      ...inscriptions(1, { ageGroup: "Adulte", weightClass: "Galo" }),
      ...inscriptions(4, { ageGroup: "Adulte", weightClass: "Pena" }),
    ];
    const panneau = buildSizingPanel(rows, { ...SHARED, ...OPTS_BASE });
    expect(panneau.singleCompetitorCount).toBe(1);
    expect(panneau.medals).toEqual({ gold: 2, silver: 1, bronze: 2, total: 5 });
    // La catégorie à un inscrit n'entre pas dans le planning.
    expect(toPlanningCategories(panneau.projection.categories)).toHaveLength(1);
  });

  it("compte le bronze d'une POULE, jamais deux : le format prime sur le mode de 3e place", () => {
    const enPoule: FormatByAgeGroup = { ...DEFAULT_FORMAT_BY_AGE_GROUP, Adulte: "pools" };
    const rows = inscriptions(4, { ageGroup: "Adulte", weightClass: "Pena" });
    const elimination = buildSizingPanel(rows, { ...SHARED, ...OPTS_BASE });
    const poule = buildSizingPanel(rows, { ...SHARED, ...OPTS_BASE, formatTable: enPoule });
    expect(elimination.medals.bronze).toBe(2);
    expect(poule.medals.bronze).toBe(1);
  });
});

// ===================================================================
// LA RECOMMANDATION DE TAPIS : LE PLANNING RÉEL, EXÉCUTÉ
// ===================================================================

describe("recommendTatamiCount", () => {
  const OPTS = { dayStartMs: JOUR, dayEndMs: JOUR + DEUX_HEURES };

  function categories() {
    return projectCategories(troisCategoriesDeHuit(), SHARED).categories;
  }

  it("rend le plus PETIT nombre de tapis qui tient dans la journée", () => {
    // Un tapis porte les 7 560 s des trois catégories, soit 2 h 06 : la journée
    // de deux heures déborde. À deux tapis, le plus chargé tombe à 4 620 s.
    const reco = recommendTatamiCount(categories(), OPTS);
    expect(reco.recommended).toBe(2);
    expect(reco.candidates.map((c) => ({ t: c.tatamiCount, tient: c.fits }))).toEqual([
      { t: 1, tient: false },
      { t: 2, tient: true },
    ]);
    expect(reco.candidates[0]?.longestTatamiSeconds).toBe(7560);
    expect(reco.candidates[1]?.longestTatamiSeconds).toBe(4620);
    expect(reco.candidates[0]?.overrunSeconds).toBe(360);
  });

  it("NE PEUT PAS diverger du planning réel : chaque candidat se rejoue à l'identique", () => {
    // Ce test est le verrou du lot. Il refait, depuis l'API publique et sans
    // passer par `evaluateTatamiCount`, exactement ce que la recommandation
    // prétend avoir fait : `planCategories` puis `computeTatamiSchedule`. Une
    // estimation parallèle (charge ÷ journée, arrondie au-dessus) donnerait un
    // nombre plausible et faux — elle ignorerait le LPT, l'ordre intra-tapis et
    // l'indivisibilité d'une catégorie — et ce test la nommerait.
    const cats = categories();
    const reco = recommendTatamiCount(cats, OPTS);
    const schedulables = toSchedulableCategories(cats);

    for (const candidat of reco.candidates) {
      const plans = planCategories(toPlanningCategories(cats), {
        tatamiCount: candidat.tatamiCount,
      });
      let finReelle = OPTS.dayStartMs;
      for (const plan of plans) {
        const ordonnees = plan.categoryIds.flatMap((id) => {
          const cat = schedulables.get(id);
          return cat ? [cat] : [];
        });
        const horaire = computeTatamiSchedule(ordonnees as SchedulableCategory[], OPTS.dayStartMs);
        finReelle = Math.max(finReelle, horaire.endsAt);
      }
      expect({
        tapis: candidat.tatamiCount,
        finAnnoncee: candidat.endsAtMs,
        finDuPlanningReel: finReelle,
      }).toEqual({
        tapis: candidat.tatamiCount,
        finAnnoncee: finReelle,
        finDuPlanningReel: finReelle,
      });
      expect(candidat.fits).toBe(finReelle <= OPTS.dayEndMs);
    }
  });

  it("recommande STRICTEMENT le minimum : le candidat d'en dessous déborde vraiment", () => {
    const cats = categories();
    const reco = recommendTatamiCount(cats, OPTS);
    const minimum = reco.recommended;
    expect(minimum).not.toBeNull();
    if (minimum === null || minimum < 2) return;
    const enDessous = planCategories(toPlanningCategories(cats), { tatamiCount: minimum - 1 });
    const pire = Math.max(...enDessous.map((t) => t.totalSeconds));
    expect({ tapis: minimum - 1, chargeMax: pire, tientDansLaJournee: pire <= 7200 }).toEqual({
      tapis: minimum - 1,
      chargeMax: pire,
      tientDansLaJournee: false,
    });
  });

  it("BOUGE quand un format bascule en poule, à effectif constant", () => {
    // Une poule de quatre coûte six combats là où l'élimination en coûte
    // trois : la même compétition demande plus de tapis. La recommandation doit
    // le voir, sinon le format n'est qu'un mot dans un formulaire.
    const enPoule: FormatByAgeGroup = { ...DEFAULT_FORMAT_BY_AGE_GROUP, Adulte: "pools" };
    const rows = [
      ...inscriptions(4, { ageGroup: "Adulte", weightClass: "Pena" }),
      ...inscriptions(4, { ageGroup: "Adulte", weightClass: "Leve" }),
      ...inscriptions(4, { ageGroup: "Adulte", weightClass: "Medio" }),
    ];
    // 70 minutes : les 3 × 1 260 s de l'élimination tiennent sur UN tapis, les
    // 3 × 2 520 s de la poule en demandent TROIS.
    const courte = { dayStartMs: JOUR, dayEndMs: JOUR + 70 * 60 * 1000 };
    const elimination = recommendTatamiCount(projectCategories(rows, SHARED).categories, courte);
    const poule = recommendTatamiCount(
      projectCategories(rows, { ...SHARED, formatTable: enPoule }).categories,
      courte,
    );
    expect({ elimination: elimination.recommended, poule: poule.recommended }).toEqual({
      elimination: 1,
      poule: 3,
    });
  });

  it("traite une heure de fin inconnue comme SANS BORNE, plutôt que d'en deviner une", () => {
    // Même convention que `PlanningDay` : `end_time` est nullable en base. On
    // ne recommande pas du matériel sur une heure inventée.
    const reco = recommendTatamiCount(categories(), { dayStartMs: JOUR, dayEndMs: JOUR });
    expect(reco.recommended).toBe(1);
    expect(reco.candidates[0]?.overrunSeconds).toBe(0);
  });

  it("rend null plutôt qu'un nombre de tapis qu'on ne peut pas installer", () => {
    const reco = recommendTatamiCount(categories(), {
      dayStartMs: JOUR,
      dayEndMs: JOUR + 60 * 1000,
      maxTatamiCount: 3,
    });
    expect(reco.recommended).toBeNull();
    expect(reco.candidates).toHaveLength(3);
  });

  it("évalue AUSSI le nombre déclaré, par le même planning, pour qu'il se compare", () => {
    const reco = recommendTatamiCount(categories(), { ...OPTS, declaredTatamiCount: 6 });
    expect(reco.recommended).toBe(2);
    expect(reco.declared?.tatamiCount).toBe(6);
    expect(reco.declared).toEqual(evaluateTatamiCount(categories(), 6, OPTS));
  });

  it("rend le panneau complet, recommandation comprise", () => {
    const panneau = buildSizingPanel(troisCategoriesDeHuit(), { ...SHARED, ...OPTS });
    expect(panneau.totalFightSeconds).toBe(7560);
    expect(panneau.recommendation.recommended).toBe(2);
  });
});

describe("buildSizingPanel — une compétition sans personne", () => {
  it("ne recommande pas zéro tapis : un jour vide tient sur un tapis", () => {
    const panneau = buildSizingPanel([], {
      ...POOL3,
      dayStartMs: JOUR,
      dayEndMs: JOUR + DEUX_HEURES,
    });
    expect(panneau.categoryCount).toBe(0);
    expect(panneau.medals).toEqual({ gold: 0, silver: 0, bronze: 0, total: 0 });
    expect(panneau.recommendation.recommended).toBe(1);
  });
});

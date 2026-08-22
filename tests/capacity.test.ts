import { describe, expect, it } from "vitest";
import {
  ACTIVE_BRACKET_STATUSES,
  breakdownRegistrations,
  computeCompetitorCapacity,
  computeFightCapacity,
  computeFillRate,
  computeFillReport,
  countsInRegistrationTotal,
  explainCapacity,
  fightsPerCompetitor,
  isActiveBracketStatus,
  isRegistrationStatus,
  REGISTRATION_STATUSES,
  statusesCountedButNotDrawn,
  type CapacityParams,
  type CategoryShape,
} from "../src/capacity";

// Huit heures exploitables, quatre tapis, cinq minutes de combat, une minute
// d'espacement : 28 800 ÷ 360 = 80 combats par tapis, 320 en tout.
const JOURNEE: CapacityParams = {
  tatamiCount: 4,
  usableSecondsPerTatami: 8 * 3600,
  averageFightSeconds: 300,
  bufferSeconds: 60,
};

const ELIMINATION: CategoryShape = {
  competitorsPerCategory: 4,
  format: "single_elim",
  thirdPlaceMode: "shared_bronze",
};

const POULE: CategoryShape = { competitorsPerCategory: 4, format: "pools" };

// ===================================================================
// LA NON-DÉRIVE DES DEUX POPULATIONS
//
// Le numérateur du taux et le compteur d'inscrits de la plateforme sont deux
// ensembles DIFFÉRENTS de statuts. Les confondre double-compte le pipeline
// commercial dans une mesure d'occupation physique, et la fédération commande
// ses médailles sur ces nombres.
//
// Ces tests NOMMENT la valeur qui bouge : élargir l'un des deux ensembles
// n'échoue pas sur un total, il échoue sur le statut fautif.
// ===================================================================

describe("le numérateur du taux, et le total de la base", () => {
  it("place EXACTEMENT registered, validated et paid — miroir d'isActiveBracketStatus", () => {
    expect(REGISTRATION_STATUSES.filter(isActiveBracketStatus)).toEqual([
      "registered",
      "validated",
      "paid",
    ]);
    expect([...ACTIVE_BRACKET_STATUSES]).toEqual(["registered", "validated", "paid"]);
  });

  it("compte dans le total TOUT SAUF withdrawn — miroir de competition_registration_counts", () => {
    expect(REGISTRATION_STATUSES.filter(countsInRegistrationTotal)).toEqual([
      "pre_registered",
      "registered",
      "validated",
      "paid",
      "no_show",
    ]);
  });

  it("laisse EXACTEMENT deux statuts comptés par la base et jamais placés sur un tapis", () => {
    // Si quelqu'un élargit le numérateur, cette liste rétrécit et le statut
    // absorbé est nommé ici. S'il élargit le total, elle s'allonge.
    expect(statusesCountedButNotDrawn()).toEqual(["pre_registered", "no_show"]);
  });

  it("n'admet AUCUN statut compté-mais-non-tiré dans le numérateur, statut par statut", () => {
    for (const statut of ["pre_registered", "no_show", "withdrawn"] as const) {
      expect({ statut, entreDansLeNumerateur: isActiveBracketStatus(statut) }).toEqual({
        statut,
        entreDansLeNumerateur: false,
      });
    }
  });

  it("garde les deux ensembles DISTINCTS : le total de la base n'est jamais le numérateur", () => {
    const numerateur = REGISTRATION_STATUSES.filter(isActiveBracketStatus);
    const total = REGISTRATION_STATUSES.filter(countsInRegistrationTotal);
    expect({
      numerateur,
      total,
      identiques: numerateur.length === total.length,
    }).toEqual({ numerateur, total, identiques: false });
  });

  it("connaît les six valeurs de l'enum, et rien d'autre", () => {
    expect([...REGISTRATION_STATUSES]).toEqual([
      "pre_registered",
      "registered",
      "validated",
      "paid",
      "withdrawn",
      "no_show",
    ]);
    expect(isRegistrationStatus("confirmed")).toBe(false);
  });
});

describe("breakdownRegistrations", () => {
  const POPULATION = [
    "paid",
    "paid",
    "registered",
    "validated",
    "pre_registered",
    "pre_registered",
    "pre_registered",
    "withdrawn",
    "no_show",
  ];

  it("sépare le numérateur des pré-inscrits, qui s'affichent à côté", () => {
    expect(breakdownRegistrations(POPULATION)).toEqual({
      active: 4,
      preRegistered: 3,
      noShow: 1,
      withdrawn: 1,
      countedTotal: 8,
      unknown: 0,
    });
  });

  it("ne range NULLE PART un statut hors vocabulaire, plutôt que de l'approximer", () => {
    const b = breakdownRegistrations(["confirmed", "PAID", "paid"]);
    expect({ active: b.active, countedTotal: b.countedTotal, unknown: b.unknown }).toEqual({
      active: 1,
      countedTotal: 1,
      unknown: 2,
    });
  });
});

// ===================================================================
// LE RATIO, ET LE FAIT QU'IL DÉPENDE DU FORMAT
// ===================================================================

describe("fightsPerCompetitor", () => {
  it("rend 1,5 pour une poule de quatre : six combats pour quatre combattants", () => {
    expect(fightsPerCompetitor(POULE)).toBe(1.5);
  });

  it("rend 0,75 pour une élimination de quatre : trois combats pour quatre combattants", () => {
    expect(fightsPerCompetitor(ELIMINATION)).toBe(0.75);
  });

  it("DIFFÈRE selon le format à effectif identique, et la poule coûte le double", () => {
    const poule = fightsPerCompetitor(POULE);
    const elimination = fightsPerCompetitor(ELIMINATION);
    expect({ poule, elimination, identiques: poule === elimination }).toEqual({
      poule: 1.5,
      elimination: 0.75,
      identiques: false,
    });
    expect(poule).toBe(elimination * 2);
  });

  it("compte le combat de 3e place quand le mode le programme (n ≥ 4)", () => {
    expect(fightsPerCompetitor({ ...ELIMINATION, thirdPlaceMode: "pool3" })).toBe(1);
    // n = 3 : aucun combat de 3e place n'est généré, le ratio ne bouge pas.
    expect(
      fightsPerCompetitor({
        competitorsPerCategory: 3,
        format: "single_elim",
        thirdPlaceMode: "pool3",
      }),
    ).toBeCloseTo(2 / 3, 10);
  });

  it("se replie AVEC le tirage quand le gabarit dépasse le plafond de poule", () => {
    // Sept en poule, c'est au-dessus de six : `resolveDrawFormat` replie en
    // élimination directe, et le ratio doit se replier avec lui. Un ratio de
    // poule maintenu ici annoncerait une capacité deux fois trop basse.
    const sept: CategoryShape = {
      competitorsPerCategory: 7,
      format: "pools",
      thirdPlaceMode: "shared_bronze",
    };
    expect(fightsPerCompetitor(sept)).toBeCloseTo(6 / 7, 10);
    expect(fightsPerCompetitor({ ...sept, competitorsPerCategory: 6 })).toBe(2.5);
  });

  it("arrondit un gabarit fractionnaire AU-DESSUS, jamais en dessous", () => {
    // « 4,6 combattants par catégorie » est une entrée légitime, et une
    // catégorie contient des personnes. Arrondir en dessous rendrait 1,5 au
    // lieu de 2,0 en poule — un tiers de capacité annoncée en trop, c'est-à-dire
    // une salle qu'on n'a pas.
    const fractionnaire: CategoryShape = { competitorsPerCategory: 4.6, format: "pools" };
    expect(fightsPerCompetitor(fractionnaire)).toBe(2);
    expect(fightsPerCompetitor(fractionnaire)).not.toBe(
      fightsPerCompetitor({ ...fractionnaire, competitorsPerCategory: 4 }),
    );
    expect(
      fightsPerCompetitor({
        competitorsPerCategory: 4.6,
        format: "single_elim",
        thirdPlaceMode: "shared_bronze",
      }),
    ).toBe(0.8);
  });

  it("rend 0 sous deux combattants : personne ne combat", () => {
    expect(fightsPerCompetitor({ competitorsPerCategory: 1, format: "pools" })).toBe(0);
    expect(fightsPerCompetitor({ competitorsPerCategory: 0, format: "single_elim" })).toBe(0);
  });
});

// ===================================================================
// LA CAPACITÉ
// ===================================================================

describe("computeFightCapacity", () => {
  it("compte 80 combats par tapis et 320 sur quatre", () => {
    expect(computeFightCapacity(JOURNEE)).toBe(320);
  });

  it("prend le plancher PAR TAPIS, pas sur le total", () => {
    // 10 000 s ÷ 360 = 27,7 combats. Par tapis : 27 × 4 = 108. Sur le total,
    // l'arrondi aurait rendu 111 — trois combats qu'aucun tapis ne peut tenir,
    // une catégorie ne se coupant pas en deux.
    const capacite = computeFightCapacity({ ...JOURNEE, usableSecondsPerTatami: 10_000 });
    expect(capacite).toBe(108);
    expect(capacite).not.toBe(Math.floor((10_000 * 4) / 360));
  });

  it("rend 0 quand il n'y a ni tapis, ni heures, ni créneau", () => {
    expect(computeFightCapacity({ ...JOURNEE, tatamiCount: 0 })).toBe(0);
    expect(computeFightCapacity({ ...JOURNEE, usableSecondsPerTatami: 0 })).toBe(0);
    expect(computeFightCapacity({ ...JOURNEE, averageFightSeconds: 0, bufferSeconds: 0 })).toBe(0);
  });

  it("compte l'espacement dans le créneau, et 60 s par défaut", () => {
    expect(computeFightCapacity({ ...JOURNEE, bufferSeconds: undefined })).toBe(320);
    expect(computeFightCapacity({ ...JOURNEE, bufferSeconds: 0 })).toBe(384);
  });
});

describe("computeCompetitorCapacity", () => {
  it("BOUGE quand on change le nombre de tapis", () => {
    const a = computeCompetitorCapacity(JOURNEE, ELIMINATION);
    const b = computeCompetitorCapacity({ ...JOURNEE, tatamiCount: 8 }, ELIMINATION);
    expect({ quatreTapis: a, huitTapis: b, identiques: a === b }).toEqual({
      quatreTapis: 426,
      huitTapis: 853,
      identiques: false,
    });
  });

  it("BOUGE quand on change le format, à tapis constants", () => {
    const elimination = computeCompetitorCapacity(JOURNEE, ELIMINATION);
    const poule = computeCompetitorCapacity(JOURNEE, POULE);
    expect({ elimination, poule, identiques: elimination === poule }).toEqual({
      elimination: 426,
      poule: 213,
      identiques: false,
    });
  });

  it("rend 0 quand le gabarit ne décrit aucun combat, jamais l'infini", () => {
    expect(
      computeCompetitorCapacity(JOURNEE, { competitorsPerCategory: 1, format: "single_elim" }),
    ).toBe(0);
  });
});

// ===================================================================
// LE TAUX, ET SON `null`
// ===================================================================

describe("computeFillRate", () => {
  it("rend la part occupée quand la capacité existe", () => {
    expect(computeFillRate(213, 426)).toBe(0.5);
  });

  it("rend null — JAMAIS 0 — quand la capacité est nulle", () => {
    // Un 0 se lit comme un fait mesuré (« la compétition est vide ») alors que
    // l'information réelle est « on ne sait pas ». À l'écran, null vaut « - ».
    expect(computeFillRate(0, 0)).toBeNull();
    expect(computeFillRate(120, 0)).toBeNull();
    expect(computeFillRate(120, -1)).toBeNull();
    expect(computeFillRate(120, Number.NaN)).toBeNull();
  });

  it("distingue une salle VIDE d'une capacité INCONNUE", () => {
    expect(computeFillRate(0, 426)).toBe(0);
    expect(computeFillRate(0, 0)).toBeNull();
  });
});

describe("computeFillReport", () => {
  const STATUTS = [
    ...Array<string>(200).fill("paid"),
    ...Array<string>(13).fill("validated"),
    ...Array<string>(50).fill("pre_registered"),
    ...Array<string>(7).fill("withdrawn"),
  ];

  it("prend pour numérateur les seuls inscrits que le générateur placera", () => {
    const rapport = computeFillReport({
      statuses: STATUTS,
      capacity: JOURNEE,
      shape: ELIMINATION,
    });
    expect(rapport.breakdown.active).toBe(213);
    expect(rapport.competitorCapacity).toBe(426);
    expect(rapport.fillRate).toBe(0.5);
  });

  it("n'additionne JAMAIS les pré-inscrits au taux, il les rend à côté", () => {
    const rapport = computeFillReport({
      statuses: STATUTS,
      capacity: JOURNEE,
      shape: ELIMINATION,
    });
    // Le total de la base vaut 263 : le brancher sur le numérateur porterait le
    // taux à 0,617 et ferait commander des médailles pour 50 personnes qui
    // n'ont pas validé leur inscription.
    expect(rapport.breakdown.countedTotal).toBe(263);
    expect(rapport.breakdown.preRegistered).toBe(50);
    expect(rapport.fillRate).not.toBe(computeFillRate(263, rapport.competitorCapacity));
  });

  it("rend un taux null quand la capacité est nulle, sans toucher au décompte", () => {
    const rapport = computeFillReport({
      statuses: STATUTS,
      capacity: { ...JOURNEE, tatamiCount: 0 },
      shape: ELIMINATION,
    });
    expect(rapport.competitorCapacity).toBe(0);
    expect(rapport.fillRate).toBeNull();
    expect(rapport.breakdown.active).toBe(213);
  });
});

describe("explainCapacity", () => {
  it("rend les termes du calcul un par un, pour que l'écran montre POURQUOI", () => {
    expect(explainCapacity(JOURNEE, POULE)).toEqual({
      tatamiCount: 4,
      usableSecondsPerTatami: 28_800,
      slotSeconds: 360,
      fightsPerTatami: 80,
      fightCapacity: 320,
      fightsPerCompetitor: 1.5,
      competitorCapacity: 213,
      requestedFormat: "pools",
      appliedFormat: "pools",
    });
  });

  it("rend des combats par tapis ENTIERS, cohérents avec la capacité qu'ils composent", () => {
    // 10 000 s ÷ 360 = 27,77. Le champ doit porter 27, le nombre réellement
    // programmable, et non la division brute : un écran qui montre « 27,8
    // combats par tapis » à côté de « 108 combats » invite à refaire le calcul
    // à la main et à trouver 111.
    const explication = explainCapacity(
      { ...JOURNEE, usableSecondsPerTatami: 10_000 },
      ELIMINATION,
    );
    expect(explication.fightsPerTatami).toBe(27);
    expect(explication.fightsPerTatami * explication.tatamiCount).toBe(explication.fightCapacity);
  });

  it("nomme le repli quand le gabarit dépasse le plafond de poule", () => {
    const explication = explainCapacity(JOURNEE, { competitorsPerCategory: 8, format: "pools" });
    expect(explication.requestedFormat).toBe("pools");
    expect(explication.appliedFormat).toBe("single_elim");
    expect(explication.fallback).toMatchObject({
      code: "pool-too-large",
      competitorCount: 8,
      maxPoolSize: 6,
      poolFightCount: 28,
      bracketFightCount: 7,
    });
  });
});

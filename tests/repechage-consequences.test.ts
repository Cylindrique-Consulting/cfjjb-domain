import { describe, expect, it } from "vitest";
import { generateBracket, type BracketEntry, type GeneratedFight } from "../src/bracket-generator";
import { fightsPerCompetitor } from "../src/capacity";
import {
  categoryRunningOrder,
  computeTatamiSchedule,
  fightTimeKey,
  type SchedulableCategory,
} from "../src/planning-generator";

// ===================================================================
// LES CONSÉQUENCES DE PLANNING DU FORMAT À TROIS INSCRITS.
//
// Depuis la décision produit du 10/09/2026, le bye d'une catégorie à trois
// devient un COMBAT (`BraketFightRepechage3`) : plus personne ne monte
// gratuitement en finale, et la catégorie compte TROIS combats réels au lieu
// de deux. Ce fichier mesure ce que le planning en faisait — rien — et gèle ce
// qu'il doit en faire.
//
// Le 11/09/2026, sur la base de recette, les deux « Open de Charléty 2026 »
// portaient 58 repêchages : 58 sans `time_starts`, seuls combats non-bye sans
// horaire de ces compétitions. Les écrans du jour J masquent les combats sans
// heure — le repêchage n'était sur aucun planning, aucune TV de tapis, aucune
// estimation de fin.
// ===================================================================

function entries(n: number): BracketEntry[] {
  return Array.from({ length: n }, (_, i) => ({ registrationId: `r${i + 1}`, clubId: null }));
}

function tirage(n: number, seed = "graine"): GeneratedFight[] {
  const result = generateBracket(entries(n), seed, { thirdPlaceMode: "pool3" });
  if (result.kind !== "bracket") throw new Error(`arbre attendu pour n=${n}`);
  return result.fights;
}

const DEBUT = Date.UTC(2026, 8, 12, 9, 0, 0);
const DUREE = 240;
const ESPACEMENT = 60;
const CRENEAU = (DUREE + ESPACEMENT) * 1000; // 5 min

function horaires(fights: GeneratedFight[]): SchedulableCategory[] {
  return [{ id: "cat", fightTimeSeconds: DUREE, fights }];
}

// -------------------------------------------------------------------
// 1. L'ORDRE DE PASSAGE
// -------------------------------------------------------------------

describe("l'ordre de passage d'une catégorie à trois inscrits", () => {
  it("rend les TROIS combats : le repêchage n'est plus perdu en route", () => {
    const fights = tirage(3);
    expect(fights.filter((f) => !f.isBye)).toHaveLength(3);
    expect(categoryRunningOrder(fights)).toHaveLength(3);
  });

  it("range le repêchage ENTRE l'ouverture et la finale", () => {
    // L'ordre physique est imposé par la propagation, pas par le confort du
    // public : le repêchage attend le perdant de la demie (donc après elle) et
    // son vainqueur monte en finale (donc avant elle).
    expect(
      categoryRunningOrder(tirage(3)).map((f) => `${f.division}.${f.indexInDivision}`),
    ).toEqual(["2.1", "2.0", "1.0"]);
  });

  it("le range APRÈS la demie alors qu'il porte un index PLUS PETIT qu'elle", () => {
    // La raison pour laquelle un simple tri par division/index ne suffit pas :
    // le repêchage occupe la case du BYE, donc l'index 0, et la demie l'index
    // 1. Trié comme une ronde ordinaire, il passerait le premier — avant que
    // son occupant du côté A n'existe.
    const fights = tirage(3);
    const repechage = fights.find((f) => f.type === "BraketFightRepechage3");
    const demie = fights.find((f) => f.type === "BraketFight" && f.division === 2);
    expect(repechage?.indexInDivision).toBe(0);
    expect(demie?.indexInDivision).toBe(1);

    const ordre = categoryRunningOrder(fights);
    expect(ordre.indexOf(demie as GeneratedFight)).toBeLessThan(
      ordre.indexOf(repechage as GeneratedFight),
    );
  });

  it("range la 1re DF avant la 2e par TYPE, même quand la 2e porte l'index 1", () => {
    // Le générateur pose la 2e DF à l'index 0 (58/58 en recette), mais rien ne
    // le garantit : l'ordre de passage 1re DF < 2e DF < finale (TR1.3) ne doit
    // dépendre que du type.
    const inverse = tirage(3).map((f) =>
      f.division === 2 ? { ...f, indexInDivision: f.type === "BraketFightRepechage3" ? 1 : 0 } : f,
    );
    expect(categoryRunningOrder(inverse).map((f) => `${f.division}.${f.type}`)).toEqual([
      "2.BraketFight",
      "2.BraketFightRepechage3",
      "1.BraketFight",
    ]);
  });

  it("ne touche à rien quand il n'y a pas de repêchage", () => {
    // Le seau du milieu s'est ouvert par exclusion ; la forme historique d'un
    // arbre de huit doit rester au combat près.
    expect(categoryRunningOrder(tirage(8)).map((f) => `${f.division}:${f.type}`)).toEqual([
      "3:BraketFight",
      "3:BraketFight",
      "3:BraketFight",
      "3:BraketFight",
      "2:BraketFight",
      "2:BraketFight",
      "2:BraketFightPool3",
      "1:BraketFight",
    ]);
  });
});

// -------------------------------------------------------------------
// 2. LES HORAIRES
// -------------------------------------------------------------------

describe("les horaires d'une catégorie à trois inscrits", () => {
  it("donne TROIS horaires strictement croissants", () => {
    const fights = tirage(3);
    const { fightTimes } = computeTatamiSchedule(horaires(fights), DEBUT, ESPACEMENT);

    const heures = fights.map((f) => fightTimes.get(fightTimeKey("cat", f)));
    expect(
      heures.every((h) => h !== undefined),
      "un combat réel sans horaire",
    ).toBe(true);

    const parOrdre = categoryRunningOrder(fights).map(
      (f) => fightTimes.get(fightTimeKey("cat", f)) as number,
    );
    expect(parOrdre).toEqual([DEBUT, DEBUT + CRENEAU, DEBUT + 2 * CRENEAU]);
  });

  it("la finale n'est plus programmée À LA PLACE du repêchage", () => {
    // La mesure du défaut : le repêchage sortait sans horaire et la finale
    // prenait son créneau — un créneau après l'ouverture, alors qu'elle se
    // combat deux créneaux après.
    const fights = tirage(3);
    const { fightTimes } = computeTatamiSchedule(horaires(fights), DEBUT, ESPACEMENT);
    const heure = (f: GeneratedFight) => fightTimes.get(fightTimeKey("cat", f)) as number;

    const repechage = fights.find((f) => f.type === "BraketFightRepechage3") as GeneratedFight;
    const finale = fights.find((f) => f.division === 1) as GeneratedFight;

    expect(heure(repechage)).toBe(DEBUT + CRENEAU);
    expect(heure(finale)).toBe(DEBUT + 2 * CRENEAU);
  });

  it("consomme bien TROIS créneaux de tapis, pas deux", () => {
    // Sinon toutes les catégories suivantes du même tapis démarrent trop tôt,
    // et le décalage s'accumule sur la journée. Le budget, lui, comptait déjà
    // juste : `realFightCount` compte les non-byes.
    const { endsAt, categoryStarts } = computeTatamiSchedule(
      [
        { id: "cat", fightTimeSeconds: DUREE, fights: tirage(3) },
        { id: "suivante", fightTimeSeconds: DUREE, fights: tirage(2) },
      ],
      DEBUT,
      ESPACEMENT,
    );
    expect(categoryStarts.get("suivante")).toBe(DEBUT + 3 * CRENEAU);
    expect(endsAt).toBe(DEBUT + 4 * CRENEAU);
  });

  it("AUCUN combat réel ne sort sans horaire, de deux à huit inscrits", () => {
    // Le garde-fou général — celui qui aurait attrapé le repêchage le jour où
    // il est né, sans qu'on ait à penser à lui.
    for (let n = 2; n <= 8; n++) {
      const fights = tirage(n);
      const { fightTimes } = computeTatamiSchedule(horaires(fights), DEBUT, ESPACEMENT);
      const orphelins = fights.filter(
        (f) => !f.isBye && fightTimes.get(fightTimeKey("cat", f)) === undefined,
      );
      expect(
        orphelins.map((f) => `${f.division}.${f.indexInDivision}:${f.type}`),
        `n=${n}`,
      ).toEqual([]);
    }
  });
});

// -------------------------------------------------------------------
// 3. LE BUDGET DE TAPIS
// -------------------------------------------------------------------

describe("le coût en tapis d'une catégorie à trois inscrits", () => {
  it("l'estimateur de capacité compte ce que le tirage produit VRAIMENT", () => {
    // `fightsPerCompetitor` est un estimateur A PRIORI : il ne voit pas le
    // tirage. Il annonçait 2/3 — le compte de l'ancien format, avec son bye.
    // Un tiers du temps de tapis des catégories à trois n'était budgété nulle
    // part, et sous-estimer le coût SURÉVALUE la capacité annoncée.
    for (const n of [2, 3, 4, 5, 6, 7, 8]) {
      const reels = tirage(n).filter((f) => !f.isBye).length;
      expect(
        fightsPerCompetitor({ competitorsPerCategory: n, format: "single_elim" }),
        `n=${n}`,
      ).toBeCloseTo(reels / n, 10);
    }
  });
});

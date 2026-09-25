import { describe, expect, it } from "vitest";
import * as domaine from "../src/index";
import { construireConstat } from "../src/controles-de-planning";
import {
  controlerLaContinuite,
  verdictAvecLaContinuite,
  type CombatDeContinuite,
} from "../src/continuite-des-tatamis";
import { monter, sourcesDuMontage, tableau, tatamis } from "./aides-planning";

/**
 * Une catégorie répartie telle que le générateur la place, puis retouchée à
 * la main : la continuité des tatamis (§12.1, §12.5, REP.5 C).
 */
function categorie(inscrits: number, parties: number, prefixe = "a") {
  const montage = monter([
    {
      id: prefixe,
      fights: tableau(inscrits, prefixe),
      tatamis: tatamis(parties),
      dureeSecondes: 300,
      rangDePlanning: 0,
    },
  ]);
  const sources = sourcesDuMontage(montage);
  const combats: CombatDeContinuite[] = montage.combats
    .filter((c) => c.isBye !== true)
    .map((c) => ({
      fightId: c.id,
      categorieId: c.categorieId,
      competitionId: "moi",
      tatamiId: c.tatamiId,
      jour: 0,
      division: c.division,
      indexInDivision: c.indexInDivision,
      type: c.type,
      sources: sources.get(c.id) ?? [],
    }));
  return {
    combats,
    categories: [{ id: prefixe, tatamisDesParties: tatamis(parties).map((t) => t.id) }],
  };
}

function sur(combats: CombatDeContinuite[], fightId: string, tatamiId: string) {
  return combats.map((c) => (c.fightId === fightId ? { ...c, tatamiId } : c));
}

function combat(combats: CombatDeContinuite[], division: number, index = 0) {
  const trouve = combats.find(
    (c) => c.type === "BraketFight" && c.division === division && c.indexInDivision === index,
  );
  if (trouve === undefined) throw new Error(`pas de combat ${division}/${index}`);
  return trouve;
}

describe("la continuité des tatamis (§12.1, §12.5)", () => {
  it("le plan du générateur est continu, de 1 à 8 parties : aucun avertissement", () => {
    for (const parties of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const { combats, categories } = categorie(64, parties);
      expect(controlerLaContinuite({ combats, categories }), `${parties} partie(s)`).toEqual([]);
    }
  });

  it("un combat d'une partie déplacé sur le tatami d'une autre partie sort de sa branche", () => {
    const { combats, categories } = categorie(32, 4);
    const premierTour = combat(combats, 5, 0);
    expect(premierTour.tatamiId).toBe("t1");
    const retouches = sur(combats, premierTour.fightId, "t3");
    const constats = controlerLaContinuite({ combats: retouches, categories });
    expect(constats).toEqual([
      {
        type: "combat_hors_de_sa_branche",
        gravite: "avertissement",
        cle: `combat_hors_de_sa_branche|moi|${premierTour.fightId}|||t3|0`,
        combatId: premierTour.fightId,
        categorieId: "a",
        competitionId: "moi",
        tatamiId: "t3",
        jour: 0,
        tatamisAttendus: ["t1"],
      },
    ]);
  });

  it("une catégorie sur un seul tatami : tout combat déplacé ailleurs sort de sa branche", () => {
    const { combats, categories } = categorie(8, 1);
    const quart = combat(combats, 3, 2);
    const constats = controlerLaContinuite({
      combats: sur(combats, quart.fightId, "t9"),
      categories,
    });
    expect(constats.map((c) => [c.type, c.combatId, c.tatamisAttendus])).toEqual([
      ["combat_hors_de_sa_branche", quart.fightId, ["t1"]],
    ]);
  });

  it("un combat de regroupement reste dans sa branche sur le tatami d'une partie réunie, ou sur celui de la finale (REP.5 C)", () => {
    const { combats, categories } = categorie(64, 4);
    const finale = combat(combats, 1);
    const demi = combat(combats, 2, 0);
    // La demi-finale des parties 1 et 2 se joue sur t1 ou t2 : sur t2, elle reste
    // dans sa branche. La finale, restée sur t1, n'a plus de demi-finale sur son
    // tatami : c'est elle qui est signalée.
    expect(finale.tatamiId).toBe("t1");
    const demiSurT2 = controlerLaContinuite({
      combats: sur(combats, demi.fightId, "t2"),
      categories,
    });
    expect(demiSurT2.map((c) => [c.type, c.combatId])).toEqual([
      ["finale_loin_des_demi_finales", finale.fightId],
    ]);
    // Sur le tatami de la finale (t3 ou t4 ici), c'est le regroupement de REP.5 C : rien.
    const avecFinaleSurT3 = sur(sur(combats, finale.fightId, "t3"), demi.fightId, "t3");
    const constats = controlerLaContinuite({ combats: avecFinaleSurT3, categories });
    expect(constats.filter((c) => c.combatId === demi.fightId)).toEqual([]);
    // Sur t4, ni une partie réunie ni la finale : hors de sa branche.
    const horsBranche = controlerLaContinuite({
      combats: sur(avecFinaleSurT3, demi.fightId, "t4"),
      categories,
    });
    expect(horsBranche.find((c) => c.combatId === demi.fightId)).toMatchObject({
      type: "combat_hors_de_sa_branche",
      tatamisAttendus: ["t1", "t2", "t3"],
    });
  });

  it("la finale envoyée sur un tatami où aucune demi-finale ne s'est jouée : avertissement", () => {
    const { combats, categories } = categorie(64, 4);
    const finale = combat(combats, 1);
    const demiA = combat(combats, 2, 0);
    const demiB = combat(combats, 2, 1);
    const tatamisDesDemis = [demiA.tatamiId, demiB.tatamiId];
    expect(tatamisDesDemis).toContain(finale.tatamiId);
    const ailleurs = ["t1", "t2", "t3", "t4"].find((t) => !tatamisDesDemis.includes(t)) as string;
    const constats = controlerLaContinuite({
      combats: sur(combats, finale.fightId, ailleurs),
      categories,
    });
    expect(constats).toEqual([
      {
        type: "finale_loin_des_demi_finales",
        gravite: "avertissement",
        cle: `finale_loin_des_demi_finales|moi|${finale.fightId}|||${ailleurs}|0`,
        combatId: finale.fightId,
        categorieId: "a",
        competitionId: "moi",
        tatamiId: ailleurs,
        jour: 0,
        tatamisAttendus: tatamisDesDemis,
      },
    ]);
  });

  it("une finale hors de sa catégorie n'est signalée qu'une fois ; sur 3 parties, la finale sur le tatami de la moitié reste continue", () => {
    const quatre = categorie(64, 4);
    const finale = combat(quatre.combats, 1);
    const hors = controlerLaContinuite({
      combats: sur(quatre.combats, finale.fightId, "t8"),
      categories: quatre.categories,
    });
    expect(hors.map((c) => c.type)).toEqual(["combat_hors_de_sa_branche"]);

    const trois = categorie(64, 3);
    const finaleTrois = combat(trois.combats, 1);
    const demiDeLaMoitie = combat(trois.combats, 2, 1);
    expect(demiDeLaMoitie.tatamiId).toBe("t3");
    expect(
      controlerLaContinuite({
        combats: sur(trois.combats, finaleTrois.fightId, "t3"),
        categories: trois.categories,
      }),
    ).toEqual([]);
  });

  it("une catégorie sans répartition lisible n'est pas jugée", () => {
    const { combats } = categorie(16, 2);
    expect(
      controlerLaContinuite({
        combats: sur(combats, combats[0]?.fightId ?? "", "t7"),
        categories: [],
      }),
    ).toEqual([]);
    expect(
      controlerLaContinuite({
        combats,
        categories: [{ id: "a", tatamisDesParties: [] }],
      }),
    ).toEqual([]);
  });
});

describe("le verdict avec la continuité : à confirmer, jamais bloquant", () => {
  const { combats, categories } = categorie(32, 4);
  const premierTour = combat(combats, 5, 0);
  const continuite = controlerLaContinuite({
    combats: sur(combats, premierTour.fightId, "t2"),
    categories,
  });
  const depassement = construireConstat({
    type: "depassement_de_journee",
    tatamiId: "t1",
    jour: 0,
    ecartMinutes: 12,
  });

  it("non confirmé : à confirmer, ni refus ni bloquant, pas publiable", () => {
    const verdict = verdictAvecLaContinuite([depassement], continuite);
    expect(verdict.refus).toEqual([]);
    expect(verdict.bloquants).toEqual([]);
    expect(verdict.aConfirmer.map((c) => c.type)).toEqual([
      "depassement_de_journee",
      "combat_hors_de_sa_branche",
    ]);
    expect(verdict.publiable).toBe(false);
  });

  it("confirmé : publiable, et sa confirmation n'est pas « inutile »", () => {
    const verdict = verdictAvecLaContinuite([depassement], continuite, [
      depassement.cle,
      ...continuite.map((c) => c.cle),
      "perimee",
    ]);
    expect(verdict.aConfirmer).toEqual([]);
    expect(verdict.publiable).toBe(true);
    expect(verdict.confirmationsInutiles).toEqual(["perimee"]);
  });

  it("un bloquant reste bloquant, avec ou sans continuité", () => {
    const double = construireConstat({
      type: "double_convocation",
      athleteId: "x",
      categorieId: "a",
      autreCategorieId: "b",
      jour: 0,
    });
    const verdict = verdictAvecLaContinuite([double], [], []);
    expect(verdict.bloquants).toHaveLength(1);
    expect(verdict.publiable).toBe(false);
  });
});

describe("la carte des exports", () => {
  it("la continuité des tatamis est joignable depuis la racine", () => {
    expect(domaine.controlerLaContinuite).toBe(controlerLaContinuite);
    expect(domaine.verdictAvecLaContinuite).toBe(verdictAvecLaContinuite);
  });
});

import { describe, expect, it } from "vitest";
import type { GeneratedFight } from "../src/bracket-generator";
import { structuralKey } from "../src/bracket-propagation";
import { controlerLePlanning } from "../src/controles-de-planning";
import {
  clePiste,
  dureeIncompressibleSecondes,
  planifierCombats,
  type CategorieAPlanifier,
  type CombatAPlanifier,
  type CreneauOccupe,
  type PlacementDeCombat,
  type ResultatDePlanification,
} from "../src/ordonnanceur-planning";
import {
  categoryRunningOrder,
  computeTatamiSchedule,
  fightTimeKey,
} from "../src/planning-generator";
import { generatePool } from "../src/pool-generator";
import { fnv1a, mulberry32 } from "../src/prng";
import {
  heure,
  hhmm,
  inscrits,
  monter,
  sourcesDuMontage,
  tableau,
  tatamis,
  versControle,
  MINUTE,
} from "./aides-planning";

const JOUR_MS = 24 * 60 * 60_000;

const unTatami = (debut = heure("09:00")) => [{ id: "t1", numero: 1, debutParJour: { 0: debut } }];

const parRang = (resultat: Map<string, PlacementDeCombat>): PlacementDeCombat[] =>
  [...resultat.values()].sort((a, b) => a.rang - b.rang);

describe("l'ordonnanceur au combat", () => {
  it("refuse un combat qui vise une catégorie ou un tatami inconnu", () => {
    const montage = monter([
      { id: "c", fights: tableau(4), tatamis: tatamis(1), dureeSecondes: 300, rangDePlanning: 0 },
    ]);
    expect(() =>
      planifierCombats({ tatamis: unTatami(), categories: [], combats: montage.combats }),
    ).toThrow(/catégorie inconnue/);
    expect(() =>
      planifierCombats({
        tatamis: [{ id: "autre", numero: 1, debutParJour: { 0: 0 } }],
        categories: montage.categories,
        combats: montage.combats,
      }),
    ).toThrow(/tatami inconnu/);
  });

  it("refuse une journée sans heure de début connue", () => {
    const montage = monter([
      { id: "c", fights: tableau(4), tatamis: tatamis(1), dureeSecondes: 300, rangDePlanning: 0 },
    ]);
    expect(() =>
      planifierCombats({
        tatamis: [{ id: "t1", numero: 1, debutParJour: {} }],
        categories: montage.categories,
        combats: montage.combats,
      }),
    ).toThrow(/heure de début/);
  });

  it("respecte le repos du tableau de trois : 09:00, puis 09:10, puis 09:25", () => {
    const montage = monter([
      { id: "c3", fights: tableau(3), tatamis: tatamis(1), dureeSecondes: 300, rangDePlanning: 0 },
    ]);
    const resultat = planifierCombats({
      tatamis: unTatami(),
      categories: montage.categories,
      combats: montage.combats,
    });
    const places = parRang(resultat.combats);
    expect(places.map((p) => hhmm(p.debutMs))).toEqual(["09:00", "09:10", "09:25"]);
    expect(places.map((p) => p.attenteDeRepos)).toEqual([false, true, true]);
  });

  it("là où le générateur d'avant enchaînait la finale une minute après la demi-finale", () => {
    const montage = monter([
      { id: "c3", fights: tableau(3), tatamis: tatamis(1), dureeSecondes: 300, rangDePlanning: 0 },
    ]);
    const fights = tableau(3);
    const ancien = computeTatamiSchedule(
      [{ id: "c3", fightTimeSeconds: 300, fights }],
      heure("09:00"),
    );
    const demiFinale = fights.find((f) => f.type === "BraketFightRepechage3");
    const finale = fights.find((f) => f.division === 1);
    if (demiFinale === undefined || finale === undefined) throw new Error("tableau incomplet");
    const ancienneFinale = ancien.fightTimes.get(fightTimeKey("c3", finale)) ?? 0;
    const ancienneDemie = ancien.fightTimes.get(fightTimeKey("c3", demiFinale)) ?? 0;
    expect(ancienneFinale - ancienneDemie).toBe(6 * MINUTE);

    const resultat = planifierCombats({
      tatamis: unTatami(),
      categories: montage.categories,
      combats: montage.combats,
    });
    const nouvelles = parRang(resultat.combats);
    const nouvelleDemie = nouvelles[1]?.debutMs ?? 0;
    const nouvelleFinale = nouvelles[2]?.debutMs ?? 0;
    expect(nouvelleFinale - nouvelleDemie).toBe(15 * MINUTE);
  });

  it("ne planifie aucun combat avant la fin de sa source plus le repos", () => {
    for (const inscrits of [2, 3, 4, 5, 7, 8, 11, 16, 23, 32, 64]) {
      const montage = monter([
        {
          id: "c",
          fights: tableau(inscrits, `p${inscrits}`),
          tatamis: tatamis(1),
          dureeSecondes: 300,
          rangDePlanning: 0,
        },
      ]);
      const resultat = planifierCombats({
        tatamis: unTatami(),
        categories: montage.categories,
        combats: montage.combats,
      });
      const constats = controlerLePlanning({
        combats: versControle(montage, resultat, { c: 300 }),
      });
      expect(constats, `tableau de ${inscrits}`).toEqual([]);
    }
  });

  it("tient le repos et les dépendances d'une catégorie répartie sur 2 à 8 tatamis", () => {
    for (const parties of [2, 3, 4, 5, 6, 7, 8]) {
      const montage = monter([
        {
          id: "c",
          fights: tableau(64, `r${parties}`),
          tatamis: tatamis(parties),
          dureeSecondes: 300,
          rangDePlanning: 0,
        },
      ]);
      const resultat = planifierCombats({
        tatamis: tatamis(parties).map((t) => ({ ...t, debutParJour: { 0: heure("09:00") } })),
        categories: montage.categories,
        combats: montage.combats,
      });
      const constats = controlerLePlanning({
        combats: versControle(montage, resultat, { c: 300 }),
      });
      expect(
        constats.filter((c) => c.type !== "desequilibre_de_tatami"),
        `${parties} parties`,
      ).toEqual([]);
      if ([2, 4, 8].includes(parties)) expect(constats, `${parties} parties`).toEqual([]);
    }
  });

  it("range la file de chaque tatami sur l'ordre croissant des heures prévues", () => {
    const montage = monter([
      {
        id: "A",
        fights: tableau(16, "A"),
        tatamis: tatamis(2),
        dureeSecondes: 300,
        rangDePlanning: 0,
      },
      {
        id: "B",
        fights: tableau(8, "B"),
        tatamis: tatamis(2),
        dureeSecondes: 360,
        rangDePlanning: 1,
      },
      {
        id: "C",
        fights: tableau(5, "C"),
        tatamis: tatamis(1),
        dureeSecondes: 240,
        rangDePlanning: 2,
      },
    ]);
    const resultat = planifierCombats({
      tatamis: tatamis(2).map((t) => ({ ...t, debutParJour: { 0: heure("09:00") } })),
      categories: montage.categories,
      combats: montage.combats,
    });
    const files = new Map<string, PlacementDeCombat[]>();
    for (const place of resultat.combats.values()) {
      const cle = clePiste(place.tatamiId, place.jour);
      const liste = files.get(cle) ?? [];
      liste.push(place);
      files.set(cle, liste);
    }
    expect(files.size).toBeGreaterThan(1);
    for (const [cle, liste] of files) {
      liste.sort((a, b) => a.rang - b.rang);
      expect(liste[0]?.rang, cle).toBe(1);
      for (let i = 1; i < liste.length; i += 1) {
        const avant = liste[i - 1];
        const apres = liste[i];
        expect(apres?.rang, cle).toBe((avant?.rang ?? 0) + 1);
        expect(apres?.debutMs ?? 0, cle).toBeGreaterThan(avant?.debutMs ?? 0);
        expect(apres?.debutMs ?? 0, cle).toBeGreaterThanOrEqual(avant?.finMs ?? 0);
      }
    }
  });

  it("garde l'ordre des tours dans une catégorie : profondeur d'abord, finale en dernier", () => {
    const montage = monter([
      {
        id: "c",
        fights: tableau(8, "o", "pool3"),
        tatamis: tatamis(1),
        dureeSecondes: 300,
        rangDePlanning: 0,
      },
    ]);
    const resultat = planifierCombats({
      tatamis: unTatami(),
      categories: montage.categories,
      combats: montage.combats,
    });
    const ordre = parRang(resultat.combats).map((p) => p.fightId.replace("c:", ""));
    const divisions = ordre.map((cle) => Number(cle.split(":")[0]));
    const troisieme = ordre.findIndex((cle) => cle.endsWith("BraketFightPool3"));
    const finale = ordre.findIndex((cle) => cle === "1:0:BraketFight");
    expect(divisions.slice(0, 4)).toEqual([3, 3, 3, 3]);
    expect(troisieme).toBeGreaterThan(-1);
    expect(finale).toBe(ordre.length - 1);
    expect(troisieme).toBeLessThan(finale);
  });

  it("intercale une autre catégorie plutôt que de laisser le tatami inactif", () => {
    const montage = monter([
      {
        id: "A",
        fights: tableau(4, "A"),
        tatamis: tatamis(1),
        dureeSecondes: 300,
        rangDePlanning: 0,
      },
      {
        id: "B",
        fights: tableau(4, "B"),
        tatamis: tatamis(1),
        dureeSecondes: 300,
        rangDePlanning: 1,
      },
    ]);
    const resultat = planifierCombats({
      tatamis: unTatami(),
      categories: montage.categories,
      combats: montage.combats,
    });
    const places = parRang(resultat.combats);
    expect(places.map((p) => `${p.categorieId} ${hhmm(p.debutMs)}`)).toEqual([
      "A 09:00",
      "A 09:06",
      "B 09:12",
      "B 09:18",
      "A 09:24",
      "B 09:33",
    ]);
    expect(places.filter((p) => p.intercale).map((p) => p.fightId)).toEqual([
      "B:2:0:BraketFight",
      "B:2:1:BraketFight",
    ]);
  });

  it("ne laisse aucun trou sur un tatami tant qu'un combat est autorisé", () => {
    const montage = monter([
      {
        id: "A",
        fights: tableau(4, "A"),
        tatamis: tatamis(1),
        dureeSecondes: 300,
        rangDePlanning: 0,
      },
      {
        id: "B",
        fights: tableau(4, "B"),
        tatamis: tatamis(1),
        dureeSecondes: 300,
        rangDePlanning: 1,
      },
      {
        id: "C",
        fights: tableau(4, "C"),
        tatamis: tatamis(1),
        dureeSecondes: 300,
        rangDePlanning: 2,
      },
    ]);
    const resultat = planifierCombats({
      tatamis: unTatami(),
      categories: montage.categories,
      combats: montage.combats,
    });
    const places = parRang(resultat.combats);
    for (let i = 1; i < places.length; i += 1) {
      const avant = places[i - 1];
      const apres = places[i];
      const trou = (apres?.debutMs ?? 0) - (avant?.finMs ?? 0);
      if (trou > 60_000) expect(apres?.attenteDeRepos, apres?.fightId).toBe(true);
    }
  });

  it("ne permute jamais deux combats d'un même tour : seul sur son tatami, il attend la fin du repos", () => {
    const montage = monter([
      {
        id: "c",
        fights: tableau(8, "L"),
        tatamis: tatamis(1),
        dureeSecondes: 300,
        rangDePlanning: 0,
      },
    ]);
    const premierTour = montage.combats.filter((c) => c.division === 3);
    const occupe = premierTour[0]?.athletes?.[0];
    if (occupe === undefined || occupe === null) throw new Error("premier tour incomplet");
    const resultat = planifierCombats({
      tatamis: unTatami(),
      categories: montage.categories,
      combats: montage.combats,
      occupations: [{ athleteId: occupe, debutMs: heure("08:00"), finMs: heure("09:30") }],
    });
    const places = parRang(resultat.combats);
    expect(places.map((p) => `${p.fightId} ${hhmm(p.debutMs)}`)).toEqual([
      "c:3:0:BraketFight 09:35",
      "c:3:1:BraketFight 09:41",
      "c:3:2:BraketFight 09:47",
      "c:3:3:BraketFight 09:53",
      "c:2:0:BraketFight 09:59",
      "c:2:1:BraketFight 10:05",
      "c:1:0:BraketFight 10:20",
    ]);
    expect(places[0]?.fightId).toBe(premierTour[0]?.id);
    expect(places[0]?.attenteDeRepos).toBe(true);
    expect(places.some((p) => p.intercale)).toBe(false);
  });

  it("pendant ce repos, fait passer une autre catégorie du tatami sans toucher à l'ordre du tableau", () => {
    const montage = monter([
      {
        id: "A",
        fights: tableau(8, "L"),
        tatamis: tatamis(1),
        dureeSecondes: 300,
        rangDePlanning: 0,
      },
      {
        id: "B",
        fights: tableau(8, "B"),
        tatamis: tatamis(1),
        dureeSecondes: 300,
        rangDePlanning: 1,
      },
    ]);
    const occupe = montage.combats.find((c) => c.id === "A:3:0:BraketFight")?.athletes?.[0];
    if (occupe === undefined || occupe === null) throw new Error("premier tour incomplet");
    const resultat = planifierCombats({
      tatamis: unTatami(),
      categories: montage.categories,
      combats: montage.combats,
      occupations: [{ athleteId: occupe, debutMs: heure("08:00"), finMs: heure("09:30") }],
    });
    const places = parRang(resultat.combats);
    expect(
      places.map((p) => `${p.fightId} ${hhmm(p.debutMs)}${p.intercale ? " intercalé" : ""}`),
    ).toEqual([
      "B:3:0:BraketFight 09:00 intercalé",
      "B:3:1:BraketFight 09:06 intercalé",
      "B:3:2:BraketFight 09:12 intercalé",
      "B:3:3:BraketFight 09:18 intercalé",
      "B:2:0:BraketFight 09:24 intercalé",
      "B:2:1:BraketFight 09:30 intercalé",
      "A:3:0:BraketFight 09:36",
      "A:3:1:BraketFight 09:42",
      "A:3:2:BraketFight 09:48",
      "A:3:3:BraketFight 09:54",
      "A:2:0:BraketFight 10:00",
      "A:2:1:BraketFight 10:06",
      "B:1:0:BraketFight 10:12 intercalé",
      "A:1:0:BraketFight 10:21",
    ]);
  });

  it("répartit une catégorie de 128 sur 8 tatamis et la ramène de 21:50 à 11:08", () => {
    const seul = monter([
      { id: "c", fights: tableau(128), tatamis: tatamis(1), dureeSecondes: 300, rangDePlanning: 0 },
    ]);
    const surUn = planifierCombats({
      tatamis: unTatami(),
      categories: seul.categories,
      combats: seul.combats,
    });
    expect(hhmm(surUn.categories.get("c")?.finMs ?? 0)).toBe("21:50");

    const reparti = monter([
      { id: "c", fights: tableau(128), tatamis: tatamis(8), dureeSecondes: 300, rangDePlanning: 0 },
    ]);
    const surHuit = planifierCombats({
      tatamis: tatamis(8).map((t) => ({ ...t, debutParJour: { 0: heure("09:00") } })),
      categories: reparti.categories,
      combats: reparti.combats,
    });
    const plan = surHuit.categories.get("c");
    expect(plan?.combats).toBe(127);
    expect(plan?.tatamiIds).toEqual(["t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8"]);
    expect(hhmm(plan?.debutMs ?? 0)).toBe("09:00");
    expect(hhmm(plan?.finMs ?? 0)).toBe("11:08");

    const parTatami = new Map<string, number>();
    for (const place of surHuit.combats.values()) {
      parTatami.set(place.tatamiId, (parTatami.get(place.tatamiId) ?? 0) + 1);
    }
    expect([...parTatami.values()].sort((a, b) => a - b)).toEqual([15, 15, 15, 15, 16, 16, 17, 18]);
  });

  it("ne donne ni horaire ni rang à un combat bye, et n'en tire aucun repos", () => {
    const montage = monter([
      {
        id: "c",
        fights: tableau(5, "b"),
        tatamis: tatamis(1),
        dureeSecondes: 300,
        rangDePlanning: 0,
      },
    ]);
    const byes = montage.combats.filter((c) => c.isBye === true);
    expect(byes.length).toBeGreaterThan(0);
    const resultat = planifierCombats({
      tatamis: unTatami(),
      categories: montage.categories,
      combats: montage.combats,
    });
    for (const bye of byes) {
      expect(resultat.combats.has(bye.id)).toBe(false);
      expect(resultat.combatsSansHoraire).toContain(bye.id);
    }
    const premier = parRang(resultat.combats)[0];
    expect(hhmm(premier?.debutMs ?? 0)).toBe("09:00");
  });

  it("sépare deux combats par l'espacement réglable, sans l'ajouter au repos", () => {
    const montage = monter([
      {
        id: "A",
        fights: tableau(4, "A"),
        tatamis: tatamis(1),
        dureeSecondes: 300,
        rangDePlanning: 0,
      },
    ]);
    const sansEspacement = planifierCombats({
      espacementSecondes: 0,
      tatamis: unTatami(),
      categories: montage.categories,
      combats: montage.combats,
    });
    const places = parRang(sansEspacement.combats);
    expect(places.map((p) => hhmm(p.debutMs))).toEqual(["09:00", "09:05", "09:20"]);

    const avecDeuxMinutes = planifierCombats({
      espacementSecondes: 120,
      tatamis: unTatami(),
      categories: montage.categories,
      combats: montage.combats,
    });
    expect(parRang(avecDeuxMinutes.combats).map((p) => hhmm(p.debutMs))).toEqual([
      "09:00",
      "09:07",
      "09:22",
    ]);
  });

  it("planifie chaque journée depuis son propre début", () => {
    const montage = monter([
      {
        id: "J0",
        fights: tableau(8, "x"),
        tatamis: tatamis(1),
        dureeSecondes: 300,
        rangDePlanning: 0,
      },
      {
        id: "J1",
        fights: tableau(8, "y"),
        tatamis: tatamis(1),
        dureeSecondes: 300,
        rangDePlanning: 1,
        jour: 1,
      },
    ]);
    const resultat = planifierCombats({
      tatamis: [
        { id: "t1", numero: 1, debutParJour: { 0: heure("09:00"), 1: heure("10:00", JOUR_MS) } },
      ],
      categories: montage.categories,
      combats: montage.combats,
    });
    expect(hhmm(resultat.categories.get("J0")?.debutMs ?? 0)).toBe("09:00");
    expect(hhmm(resultat.categories.get("J1")?.debutMs ?? 0, JOUR_MS)).toBe("10:00");
    expect(resultat.tatamis.get(clePiste("t1", 0))?.combats).toBe(7);
    expect(resultat.tatamis.get(clePiste("t1", 1))?.combats).toBe(7);
    expect([...resultat.finParJour.keys()].sort()).toEqual([0, 1]);
  });

  it("recule le premier combat d'un athlète déjà occupé dans une compétition sœur", () => {
    const montage = monter([
      {
        id: "c",
        fights: tableau(4, "L"),
        tatamis: tatamis(1),
        dureeSecondes: 300,
        rangDePlanning: 0,
      },
    ]);
    const resultat = planifierCombats({
      tatamis: unTatami(),
      categories: montage.categories,
      combats: montage.combats,
      occupations: [{ athleteId: "L1", debutMs: heure("08:00"), finMs: heure("09:20") }],
    });
    const deL1 = [...resultat.combats.values()].filter((place) => {
      const combat = montage.combats.find((c) => c.id === place.fightId);
      return combat?.athletes?.includes("L1") === true;
    });
    expect(deL1.length).toBeGreaterThan(0);
    for (const place of deL1) {
      expect(place.debutMs).toBeGreaterThanOrEqual(heure("09:25"));
    }
  });

  it("repose sur l'identifiant du licencié : deux combats d'un même athlète gardent leur repos", () => {
    const montage = monter([
      {
        id: "A",
        fights: tableau(8, "L"),
        tatamis: tatamis(1),
        dureeSecondes: 300,
        rangDePlanning: 0,
      },
      {
        id: "B",
        fights: tableau(8, "L"),
        tatamis: tatamis(1),
        dureeSecondes: 300,
        rangDePlanning: 1,
      },
    ]);
    const resultat = planifierCombats({
      tatamis: unTatami(),
      categories: montage.categories,
      combats: montage.combats,
    });
    const parAthlete = new Map<string, { debutMs: number; finMs: number; id: string }[]>();
    for (const combat of montage.combats) {
      const place = resultat.combats.get(combat.id);
      if (place === undefined) continue;
      for (const athlete of combat.athletes ?? []) {
        if (athlete === null) continue;
        const liste = parAthlete.get(athlete) ?? [];
        liste.push({ debutMs: place.debutMs, finMs: place.finMs, id: combat.id });
        parAthlete.set(athlete, liste);
      }
    }
    let controles = 0;
    for (const [athlete, liste] of parAthlete) {
      liste.sort((a, b) => a.debutMs - b.debutMs);
      for (let i = 1; i < liste.length; i += 1) {
        const avant = liste[i - 1];
        const apres = liste[i];
        expect(apres?.debutMs ?? 0, `${athlete} ${apres?.id}`).toBeGreaterThanOrEqual(
          (avant?.finMs ?? 0) + 5 * MINUTE,
        );
        controles += 1;
      }
    }
    expect(controles).toBeGreaterThan(4);
  });

  it("planifie une poule sans jamais faire combattre un athlète deux fois de suite", () => {
    const resultat = generatePool(inscrits(5, "P"), "graine-poule", {});
    if (resultat.kind !== "pool") throw new Error("poule non générée");
    const combats = resultat.fights.map((fight, index) => ({
      id: `poule:${index}`,
      categorieId: "poule",
      tatamiId: "t1",
      division: fight.division,
      indexInDivision: fight.indexInDivision,
      type: fight.type,
      isBye: fight.isBye,
      athletes: [fight.slotA, fight.slotB] as const,
    }));
    const plan = planifierCombats({
      tatamis: unTatami(),
      categories: [
        { id: "poule", dureeSecondes: 300, jour: 0, rangDePlanning: 0, format: "pools" },
      ],
      combats,
    });
    expect(plan.combats.size).toBe(combats.length);
    const dernierParAthlete = new Map<string, number>();
    for (const place of parRang(plan.combats)) {
      const combat = combats.find((c) => c.id === place.fightId);
      for (const athlete of combat?.athletes ?? []) {
        if (athlete === null) continue;
        const fin = dernierParAthlete.get(athlete);
        if (fin !== undefined) {
          expect(place.debutMs, `${athlete} ${place.fightId}`).toBeGreaterThanOrEqual(
            fin + 5 * MINUTE,
          );
        }
        dernierParAthlete.set(athlete, place.finMs);
      }
    }
    expect(dernierParAthlete.size).toBe(5);
  });

  it("rend le même plan pour la même entrée", () => {
    const construire = () =>
      monter([
        {
          id: "A",
          fights: tableau(23, "A"),
          tatamis: tatamis(2),
          dureeSecondes: 300,
          rangDePlanning: 0,
        },
        {
          id: "B",
          fights: tableau(9, "B"),
          tatamis: tatamis(1),
          dureeSecondes: 360,
          rangDePlanning: 1,
        },
      ]);
    const lire = () => {
      const montage = construire();
      const resultat = planifierCombats({
        tatamis: tatamis(2).map((t) => ({ ...t, debutParJour: { 0: heure("09:00") } })),
        categories: montage.categories,
        combats: montage.combats,
      });
      return [...resultat.combats.values()]
        .map((p) => `${p.fightId}|${p.tatamiId}|${p.rang}|${p.debutMs}`)
        .sort();
    };
    expect(lire()).toEqual(lire());
  });

  it("rend un plan vide sans combat, sans se bloquer", () => {
    const resultat = planifierCombats({ tatamis: unTatami(), categories: [], combats: [] });
    expect(resultat.combats.size).toBe(0);
    expect(resultat.categories.size).toBe(0);
    expect(resultat.finParJour.size).toBe(0);
  });
});

describe("l'ordre strict du tableau dans un tour (PL3.9 option B)", () => {
  const seulSurUnTatami = (nombre: number) => {
    const montage = monter([
      {
        id: "c",
        fights: tableau(nombre),
        tatamis: tatamis(1),
        dureeSecondes: 300,
        rangDePlanning: 0,
      },
    ]);
    const resultat = planifierCombats({
      tatamis: unTatami(),
      categories: montage.categories,
      combats: montage.combats,
    });
    return { montage, places: parRang(resultat.combats) };
  };

  it("à 5 inscrits, la 1re demi-finale attend son repos et passe avant la 2e", () => {
    const { places } = seulSurUnTatami(5);
    expect(places.map((p) => `${p.fightId} ${hhmm(p.debutMs)}`)).toEqual([
      "c:3:1:BraketFight 09:00",
      "c:2:0:BraketFight 09:10",
      "c:2:1:BraketFight 09:16",
      "c:1:0:BraketFight 09:31",
    ]);
    expect(places[1]?.attenteDeRepos).toBe(true);
  });

  it("à 9, 17 et 33 inscrits, chaque tour passe du haut vers le bas du tableau", () => {
    const attendus = [
      { nombre: 9, enAttente: "c:3:0:BraketFight 09:10", finale: "09:55" },
      { nombre: 17, enAttente: "c:4:0:BraketFight 09:10", finale: "10:43" },
      { nombre: 33, enAttente: "c:5:0:BraketFight 09:10", finale: "12:19" },
    ];
    for (const { nombre, enAttente, finale } of attendus) {
      const { montage, places } = seulSurUnTatami(nombre);
      const ordreDuTableau = categoryRunningOrder(
        montage.combats.filter((c) => c.isBye !== true),
      ).map((c) => c.id);
      expect(
        places.map((p) => p.fightId),
        `${nombre} inscrits`,
      ).toEqual(ordreDuTableau);
      expect(`${places[1]?.fightId} ${hhmm(places[1]?.debutMs ?? 0)}`, `${nombre} inscrits`).toBe(
        enAttente,
      );
      expect(places[1]?.attenteDeRepos, `${nombre} inscrits`).toBe(true);
      expect(hhmm(places[places.length - 1]?.debutMs ?? 0), `${nombre} inscrits`).toBe(finale);
    }
  });

  it("à 5 inscrits, une autre catégorie du tatami passe pendant le repos de la 1re demi-finale", () => {
    const montage = monter([
      {
        id: "A",
        fights: tableau(5, "A"),
        tatamis: tatamis(1),
        dureeSecondes: 300,
        rangDePlanning: 0,
      },
      {
        id: "B",
        fights: tableau(4, "B"),
        tatamis: tatamis(1),
        dureeSecondes: 300,
        rangDePlanning: 1,
      },
    ]);
    const resultat = planifierCombats({
      tatamis: unTatami(),
      categories: montage.categories,
      combats: montage.combats,
    });
    const places = parRang(resultat.combats);
    expect(
      places.map((p) => `${p.fightId} ${hhmm(p.debutMs)}${p.intercale ? " intercalé" : ""}`),
    ).toEqual([
      "A:3:1:BraketFight 09:00",
      "B:2:0:BraketFight 09:06 intercalé",
      "A:2:0:BraketFight 09:12",
      "A:2:1:BraketFight 09:18",
      "B:2:1:BraketFight 09:24 intercalé",
      "A:1:0:BraketFight 09:33",
      "B:1:0:BraketFight 09:39",
    ]);
  });
});

describe("l'ordre strict entre tatamis : aucun interblocage", () => {
  const surTatamis = (
    categorieId: string,
    fights: readonly GeneratedFight[],
    tatamiDuCombat: (fight: GeneratedFight) => string,
  ): CombatAPlanifier[] =>
    fights.map((fight) => ({
      id: `${categorieId}:${structuralKey(fight)}`,
      categorieId,
      tatamiId: tatamiDuCombat(fight),
      division: fight.division,
      indexInDivision: fight.indexInDivision,
      type: fight.type,
      isBye: fight.isBye,
      athletes: [fight.slotA, fight.slotB],
    }));

  const cle = (fight: Pick<GeneratedFight, "division" | "indexInDivision">) =>
    `${fight.division}:${fight.indexInDivision}`;

  const constatsDeDependance = (
    categories: CategorieAPlanifier[],
    combats: CombatAPlanifier[],
    resultat: ResultatDePlanification,
  ) => {
    const durees = Object.fromEntries(categories.map((c) => [c.id, c.dureeSecondes]));
    return controlerLePlanning({
      combats: versControle({ categories, combats, places: new Map() }, resultat, durees),
    }).filter((c) => c.type === "source_apres_dependant" || c.type === "repos_insuffisant");
  };

  const fileDuTatami = (resultat: ResultatDePlanification, tatamiId: string) =>
    parRang(resultat.combats)
      .filter((p) => p.tatamiId === tatamiId)
      .map((p) => `${p.fightId.replace("c:", "").replace(":BraketFight", "")} ${hhmm(p.debutMs)}`);

  it("deux parties d'un tableau qui s'attendent mutuellement avancent l'une après l'autre", () => {
    const placement: Record<string, string> = {
      "3:0": "t1",
      "3:1": "t1",
      "2:1": "t1",
      "1:0": "t1",
      "3:2": "t2",
      "3:3": "t2",
      "2:0": "t2",
    };
    const categories = [{ id: "c", dureeSecondes: 300, jour: 0, rangDePlanning: 0 }];
    const combats = surTatamis("c", tableau(8, "X"), (f) => placement[cle(f)] ?? "t1");
    const resultat = planifierCombats({
      tatamis: [
        { id: "t1", numero: 1, debutParJour: { 0: heure("09:00") } },
        { id: "t2", numero: 2, debutParJour: { 0: heure("09:30") } },
      ],
      categories,
      combats,
    });
    expect(resultat.combatsSansHoraire).toEqual([]);
    expect([...resultat.combats.values()].some((p) => p.dependanceIgnoree)).toBe(false);
    expect(fileDuTatami(resultat, "t1")).toEqual([
      "3:0 09:00",
      "3:1 09:06",
      "2:1 09:46",
      "1:0 10:01",
    ]);
    expect(fileDuTatami(resultat, "t2")).toEqual(["3:2 09:30", "3:3 09:36", "2:0 09:42"]);
    expect(constatsDeDependance(categories, combats, resultat)).toEqual([]);
  });

  it("un combat qui attend sa source sur un autre tatami n'est pas doublé par le suivant du tour", () => {
    const placement: Record<string, string> = {
      "3:2": "t1",
      "3:3": "t1",
      "2:0": "t1",
      "2:1": "t1",
      "1:0": "t1",
      "3:0": "t2",
      "3:1": "t2",
    };
    const categories = [{ id: "c", dureeSecondes: 300, jour: 0, rangDePlanning: 0 }];
    const combats = surTatamis("c", tableau(8, "X"), (f) => placement[cle(f)] ?? "t1");
    const resultat = planifierCombats({
      tatamis: [
        { id: "t1", numero: 1, debutParJour: { 0: heure("09:00") } },
        { id: "t2", numero: 2, debutParJour: { 0: heure("09:30") } },
      ],
      categories,
      combats,
    });
    expect([...resultat.combats.values()].some((p) => p.dependanceIgnoree)).toBe(false);
    expect(fileDuTatami(resultat, "t1")).toEqual([
      "3:2 09:00",
      "3:3 09:06",
      "2:0 09:46",
      "2:1 09:52",
      "1:0 10:07",
    ]);
    expect(fileDuTatami(resultat, "t2")).toEqual(["3:0 09:30", "3:1 09:36"]);
    expect(constatsDeDependance(categories, combats, resultat)).toEqual([]);
  });

  it("ne s'interbloque jamais, quelle que soit l'affectation des combats aux tatamis", () => {
    const tailles = [3, 4, 5, 8, 9, 16, 17, 23, 32];
    let dependancesCroisees = 0;
    let attentes = 0;
    for (let essai = 0; essai < 200; essai += 1) {
      const aleatoire = mulberry32(fnv1a(`interblocage-${essai}`));
      const tirer = <T>(liste: readonly T[]): T =>
        liste[Math.floor(aleatoire() * liste.length)] as T;
      const ids = Array.from({ length: 2 + Math.floor(aleatoire() * 3) }, (_, i) => `t${i + 1}`);
      const categories: CategorieAPlanifier[] = [];
      const combats: CombatAPlanifier[] = [];
      const nombreDeCategories = 1 + Math.floor(aleatoire() * 3);
      for (let rang = 0; rang < nombreDeCategories; rang += 1) {
        const id = `k${rang}`;
        const fights = tableau(
          tirer(tailles),
          `${id}e${essai}a`,
          aleatoire() < 0.5 ? "pool3" : "shared_bronze",
        );
        categories.push({
          id,
          dureeSecondes: tirer([180, 300, 360]),
          jour: 0,
          rangDePlanning: rang,
        });
        combats.push(...surTatamis(id, fights, () => tirer(ids)));
      }
      const athletes = combats.flatMap((c) => c.athletes ?? []).filter((a) => a !== null);
      const occupations: CreneauOccupe[] = Array.from({ length: 3 }, () => ({
        athleteId: tirer(athletes),
        debutMs: heure("08:00"),
        finMs: heure("09:00") + tirer([10, 30, 60]) * MINUTE,
      }));
      const resultat = planifierCombats({
        tatamis: ids.map((id, i) => ({
          id,
          numero: i + 1,
          debutParJour: { 0: heure("09:00") + tirer([0, 15, 45]) * MINUTE },
        })),
        categories,
        combats,
        occupations,
      });

      const byes = combats.filter((c) => c.isBye === true).map((c) => c.id);
      expect([...resultat.combatsSansHoraire].sort(), `essai ${essai}`).toEqual(byes.sort());
      const ignorees = [...resultat.combats.values()].filter((p) => p.dependanceIgnoree);
      expect(ignorees, `essai ${essai}`).toEqual([]);
      expect(constatsDeDependance(categories, combats, resultat), `essai ${essai}`).toEqual([]);

      for (const categorie of categories) {
        for (const tatamiId of ids) {
          const siens = combats.filter(
            (c) => c.categorieId === categorie.id && c.tatamiId === tatamiId && c.isBye !== true,
          );
          const ordreDuTableau = categoryRunningOrder(siens).map((c) => c.id);
          const ordrePlanifie = parRang(resultat.combats)
            .filter((p) => p.categorieId === categorie.id && p.tatamiId === tatamiId)
            .map((p) => p.fightId);
          expect(ordrePlanifie, `essai ${essai}, ${categorie.id} sur ${tatamiId}`).toEqual(
            ordreDuTableau,
          );
        }
      }

      const tatamiDe = new Map(combats.map((c) => [c.id, c.tatamiId]));
      const sources = sourcesDuMontage({ categories, combats, places: new Map() });
      for (const [combatId, sesSources] of sources) {
        for (const source of sesSources) {
          if (source !== null && tatamiDe.get(source) !== tatamiDe.get(combatId)) {
            dependancesCroisees += 1;
          }
        }
      }
      attentes += [...resultat.combats.values()].filter((p) => p.attenteDeRepos).length;
    }
    expect(dependancesCroisees).toBeGreaterThan(1000);
    expect(attentes).toBeGreaterThan(500);
  });
});

describe("la durée incompressible d'une catégorie", () => {
  it("compte les attentes de repos du chemin le plus long", () => {
    expect(dureeIncompressibleSecondes({ dureeSecondes: 300, divisionMax: 1 })).toBe(300);
    expect(dureeIncompressibleSecondes({ dureeSecondes: 300, divisionMax: 2 })).toBe(4 * 300);
    expect(dureeIncompressibleSecondes({ dureeSecondes: 300, divisionMax: 3 })).toBe(6 * 300);
    expect(dureeIncompressibleSecondes({ dureeSecondes: 300, divisionMax: 7 })).toBe(14 * 300);
  });

  it("compte six durées pour un tableau de trois", () => {
    expect(
      dureeIncompressibleSecondes({ dureeSecondes: 300, divisionMax: 2, tableauDeTrois: true }),
    ).toBe(6 * 300);
  });

  it("ne prétend rien pour une catégorie sans combat", () => {
    expect(dureeIncompressibleSecondes({ dureeSecondes: 300, divisionMax: 0 })).toBe(0);
  });

  it("borne un tableau de trois de 5 min sous l'écart observé au planning", () => {
    expect(
      dureeIncompressibleSecondes({ dureeSecondes: 300, divisionMax: 2, tableauDeTrois: true }) /
        60,
    ).toBe(30);
  });
});

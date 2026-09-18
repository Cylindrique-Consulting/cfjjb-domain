import { describe, expect, it } from "vitest";
import {
  planifierLEvenement,
  type CompetitionDeLEvenement,
} from "../src/enchainement-competitions";
import { heure, hhmm, monter, tableau, tatamis, MINUTE } from "./aides-planning";

const JOUR_MS = 24 * 60 * 60_000;

type Reglage = {
  id: string;
  ordre: number;
  jour?: number;
  debutSaisiMs?: number;
  prefixe: string;
  inscrits?: number;
  athletes?: readonly string[];
  autreCategorie?: { prefixe: string; inscrits: number };
};

function competition(reglage: Reglage): CompetitionDeLEvenement {
  const categorieId = `${reglage.id}-c`;
  const montage = monter([
    {
      id: categorieId,
      fights: tableau(reglage.inscrits ?? 4, reglage.prefixe),
      tatamis: tatamis(1),
      dureeSecondes: 300,
      rangDePlanning: 0,
      jour: reglage.jour ?? 0,
    },
    ...(reglage.autreCategorie === undefined
      ? []
      : [
          {
            id: `${reglage.id}-autre`,
            fights: tableau(reglage.autreCategorie.inscrits, reglage.autreCategorie.prefixe),
            tatamis: tatamis(1),
            dureeSecondes: 300,
            rangDePlanning: 1,
            jour: reglage.jour ?? 0,
          },
        ]),
  ]);
  return {
    id: reglage.id,
    ordre: reglage.ordre,
    jour: reglage.jour ?? 0,
    ...(reglage.debutSaisiMs === undefined ? {} : { debutSaisiMs: reglage.debutSaisiMs }),
    planification: {
      tatamis: [
        {
          id: "t1",
          numero: 1,
          debutParJour:
            reglage.debutSaisiMs === undefined ? {} : { [reglage.jour ?? 0]: reglage.debutSaisiMs },
        },
      ],
      categories: montage.categories,
      combats: montage.combats,
    },
    engagements: (reglage.athletes ?? []).map((athleteId) => ({ athleteId, categorieId })),
  };
}

describe("l'enchaînement des compétitions d'un événement", () => {
  it("fait partir chaque compétition de la fin prévue de la précédente", () => {
    const resultat = planifierLEvenement([
      competition({ id: "GI", ordre: 0, debutSaisiMs: heure("09:00"), prefixe: "g" }),
      competition({ id: "NOGI", ordre: 1, prefixe: "n" }),
    ]);
    expect(hhmm(resultat.debutsRetenus.get("GI") ?? 0)).toBe("09:00");
    const finGi = resultat.finsPrevues.get("GI") ?? 0;
    expect(resultat.debutsRetenus.get("NOGI")).toBe(finGi + MINUTE);
    expect(resultat.conflits).toEqual([]);
  });

  it("garde le repos d'un athlète commun d'une compétition à l'autre", () => {
    const resultat = planifierLEvenement([
      competition({
        id: "GI",
        ordre: 0,
        debutSaisiMs: heure("09:00"),
        prefixe: "L",
        athletes: ["L1"],
      }),
      competition({ id: "NOGI", ordre: 1, prefixe: "L", athletes: ["L1"] }),
    ]);
    const gi = resultat.engagements.find((e) => e.competitionId === "GI");
    const nogi = resultat.engagements.find((e) => e.competitionId === "NOGI");
    expect(nogi?.premierCombatMs ?? 0).toBeGreaterThanOrEqual((gi?.finMs ?? 0) + 5 * MINUTE);
    expect(resultat.conflits).toEqual([]);
  });

  it("recule seulement l'athlète commun : une autre catégorie passe pendant son repos", () => {
    const resultat = planifierLEvenement([
      competition({
        id: "GI",
        ordre: 0,
        debutSaisiMs: heure("09:00"),
        prefixe: "L",
        athletes: ["L1"],
      }),
      competition({
        id: "NOGI",
        ordre: 1,
        prefixe: "L",
        inscrits: 8,
        athletes: ["L1"],
        autreCategorie: { prefixe: "z", inscrits: 8 },
      }),
    ]);
    const nogi = resultat.competitions.get("NOGI");
    const debutCompetition = resultat.debutsRetenus.get("NOGI") ?? 0;
    const places = [...(nogi?.combats.values() ?? [])].sort((a, b) => a.rang - b.rang);
    expect(places[0]?.debutMs).toBe(debutCompetition);
    expect(places[0]?.categorieId).toBe("NOGI-autre");
    expect(places[0]?.intercale).toBe(true);
    const gi = resultat.engagements.find((e) => e.competitionId === "GI");
    const engagement = resultat.engagements.find((e) => e.competitionId === "NOGI");
    expect(engagement?.premierCombatMs ?? 0).toBeGreaterThanOrEqual((gi?.finMs ?? 0) + 5 * MINUTE);
    expect(places.filter((p) => p.fightId.startsWith("NOGI-c:3:")).map((p) => p.fightId)).toEqual([
      "NOGI-c:3:0:BraketFight",
      "NOGI-c:3:1:BraketFight",
      "NOGI-c:3:2:BraketFight",
      "NOGI-c:3:3:BraketFight",
    ]);
  });

  it("sans autre catégorie, le tatami attend la fin du repos de l'athlète commun (PL3.9 option B)", () => {
    const resultat = planifierLEvenement([
      competition({
        id: "GI",
        ordre: 0,
        debutSaisiMs: heure("13:33"),
        prefixe: "L",
        athletes: ["L3"],
      }),
      competition({ id: "NOGI", ordre: 1, prefixe: "L", inscrits: 16, athletes: ["L3"] }),
    ]);
    expect(hhmm(resultat.finsPrevues.get("GI") ?? 0)).toBe("13:59");
    expect(hhmm(resultat.debutsRetenus.get("NOGI") ?? 0)).toBe("14:00");
    const places = [...(resultat.competitions.get("NOGI")?.combats.values() ?? [])].sort(
      (a, b) => a.rang - b.rang,
    );
    expect(places.slice(0, 3).map((p) => `${p.fightId} ${hhmm(p.debutMs)}`)).toEqual([
      "NOGI-c:4:0:BraketFight 14:04",
      "NOGI-c:4:1:BraketFight 14:10",
      "NOGI-c:4:2:BraketFight 14:16",
    ]);
    expect(places[0]?.attenteDeRepos).toBe(true);
    expect(hhmm(places[places.length - 1]?.debutMs ?? 0)).toBe("15:37");
    expect(resultat.conflits).toEqual([]);
  });

  it("signale une heure saisie qui fait empiéter une compétition sur la précédente", () => {
    const resultat = planifierLEvenement([
      competition({ id: "GI", ordre: 0, debutSaisiMs: heure("09:00"), prefixe: "g" }),
      competition({ id: "NOGI", ordre: 1, debutSaisiMs: heure("09:10"), prefixe: "n" }),
    ]);
    const chevauchements = resultat.conflits.filter(
      (c) => c.type === "chevauchement_de_competitions",
    );
    expect(chevauchements).toHaveLength(1);
    expect(chevauchements[0]).toMatchObject({
      competitionId: "NOGI",
      autreCompetitionId: "GI",
      gravite: "avertissement",
    });
  });

  it("bloque la publication quand deux compétitions parallèles convoquent le même athlète", () => {
    const resultat = planifierLEvenement([
      competition({
        id: "ENFANTS",
        ordre: 0,
        debutSaisiMs: heure("09:00"),
        prefixe: "L",
        athletes: ["L2"],
      }),
      competition({
        id: "ADULTES",
        ordre: 1,
        debutSaisiMs: heure("09:00"),
        prefixe: "L",
        athletes: ["L2"],
      }),
    ]);
    const bloquants = resultat.conflits.filter((c) => c.gravite === "bloquant");
    expect(bloquants.map((c) => c.type)).toEqual(["double_convocation"]);
    expect(bloquants[0]?.athleteId).toBe("L2");
  });

  it("n'avance pas un autre combat devant l'athlète commun qui ouvre le tableau d'une compétition parallèle", () => {
    const resultat = planifierLEvenement([
      competition({
        id: "ENFANTS",
        ordre: 0,
        debutSaisiMs: heure("09:00"),
        prefixe: "L",
        athletes: ["L1"],
      }),
      competition({
        id: "ADULTES",
        ordre: 1,
        debutSaisiMs: heure("09:00"),
        prefixe: "L",
        athletes: ["L1"],
      }),
    ]);
    const adultes = [...(resultat.competitions.get("ADULTES")?.combats.values() ?? [])].sort(
      (a, b) => a.rang - b.rang,
    );
    expect(adultes.map((p) => `${p.fightId} ${hhmm(p.debutMs)}`)).toEqual([
      "ADULTES-c:2:0:BraketFight 09:31",
      "ADULTES-c:2:1:BraketFight 09:37",
      "ADULTES-c:1:0:BraketFight 09:52",
    ]);
    expect(resultat.conflits.map((c) => `${c.type} ${c.gravite}`)).toEqual([
      "chevauchement_de_competitions avertissement",
    ]);
  });

  it("respecte l'ordre saisi, qui peut inverser Gi et No-Gi", () => {
    const resultat = planifierLEvenement([
      competition({ id: "NOGI", ordre: 0, debutSaisiMs: heure("09:00"), prefixe: "n" }),
      competition({ id: "GI", ordre: 1, prefixe: "g" }),
    ]);
    expect(resultat.debutsRetenus.get("NOGI")).toBeLessThan(resultat.debutsRetenus.get("GI") ?? 0);
  });

  it("enchaîne chaque journée pour elle-même", () => {
    const resultat = planifierLEvenement([
      competition({ id: "SAMEDI", ordre: 0, jour: 0, debutSaisiMs: heure("09:00"), prefixe: "s" }),
      competition({
        id: "DIMANCHE-KIDS",
        ordre: 0,
        jour: 1,
        debutSaisiMs: heure("09:00", JOUR_MS),
        prefixe: "k",
      }),
      competition({ id: "DIMANCHE-NOGI", ordre: 1, jour: 1, prefixe: "d" }),
    ]);
    expect(hhmm(resultat.debutsRetenus.get("DIMANCHE-KIDS") ?? 0, JOUR_MS)).toBe("09:00");
    const finKids = resultat.finsPrevues.get("DIMANCHE-KIDS") ?? 0;
    expect(resultat.debutsRetenus.get("DIMANCHE-NOGI")).toBe(finKids + MINUTE);
    expect(resultat.debutsRetenus.get("SAMEDI")).toBe(heure("09:00"));
  });

  it("refuse une journée dont la première compétition n'a pas d'heure de début", () => {
    expect(() =>
      planifierLEvenement([competition({ id: "SEULE", ordre: 0, prefixe: "s" })]),
    ).toThrow(/heure de début/);
  });

  it("règle l'espacement entre deux compétitions", () => {
    const resultat = planifierLEvenement(
      [
        competition({ id: "GI", ordre: 0, debutSaisiMs: heure("09:00"), prefixe: "g" }),
        competition({ id: "NOGI", ordre: 1, prefixe: "n" }),
      ],
      { espacementEntreCompetitionsSecondes: 30 * 60 },
    );
    const finGi = resultat.finsPrevues.get("GI") ?? 0;
    expect(resultat.debutsRetenus.get("NOGI")).toBe(finGi + 30 * MINUTE);
  });

  it("rend un plan par compétition, sans mélanger les combats", () => {
    const resultat = planifierLEvenement([
      competition({ id: "GI", ordre: 0, debutSaisiMs: heure("09:00"), prefixe: "g" }),
      competition({ id: "NOGI", ordre: 1, prefixe: "n" }),
    ]);
    expect([...resultat.competitions.keys()].sort()).toEqual(["GI", "NOGI"]);
    for (const [id, plan] of resultat.competitions) {
      for (const place of plan.combats.values()) {
        expect(place.categorieId).toBe(`${id}-c`);
      }
    }
  });
});

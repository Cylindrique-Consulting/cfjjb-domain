/**
 * LE BANC DE L'ÉQUILIBRE DES TATAMIS (v0.42.0, ticket du 11/10/2026 : « les
 * tatamis terminent leur programme à des horaires proches, hors absolutes »).
 *
 * Une journée synthétique, tirée d'une graine fixe, à la façon d'un Open :
 * 60 catégories de poids sur 8 tatamis, près de la moitié à 2 à 7 inscrits,
 * une sur cinq à plus de 16, des durées de 5 à 10 minutes selon la ceinture.
 * Aucun nom, aucune donnée réelle. Les tableaux sont répartis comme la
 * plateforme le propose (l'effectif, et un tour de 30 minutes au plus), les
 * catégories affectées comme elle le fait (`affecterParListe` : ordre de
 * départ et charge), puis les combats de convergence des catégories réparties
 * sont placés de deux façons :
 *
 *   · `plus_tardif` (avant v0.42.0) : sur le tatami le plus chargé, d'après une
 *     charge fixe, celle des catégories partagée également entre leurs tatamis ;
 *   · `moins_charge` : sur le tatami le moins chargé, la charge partant des
 *     combats qui ne convergent pas et montant à chaque combat de convergence
 *     placé, catégorie après catégorie dans l'ordre de départ.
 *
 * L'ordonnanceur du noyau place ensuite chaque combat ; l'écart entre les fins
 * des tatamis se lit sur `evaluerLaJournee`.
 */
import { describe, expect, it } from "vitest";
import { affecterParListe } from "../src/affectation-par-liste";
import type { GeneratedFight } from "../src/bracket-generator";
import { structuralKey } from "../src/bracket-propagation";
import { controlerLePlanning, type CombatControle } from "../src/controles-de-planning";
import { evaluerLaJournee, sourcesDesCombats } from "../src/objectifs-du-planning";
import {
  planifierCombats,
  type CombatAPlanifier,
  type EntreeDePlanification,
} from "../src/ordonnanceur-planning";
import { mulberry32 } from "../src/prng";
import {
  partiesDuCombat,
  proposerLaRepartition,
  repartirLesCombats,
  type ModeDeConvergence,
} from "../src/repartition-tatamis";
import { MINUTE, heure, tableau } from "./aides-planning";

const NEUF_HEURES = heure("09:00");
const ESPACEMENT_SECONDES = 120;
const TATAMIS = Array.from({ length: 8 }, (_, k) => ({
  id: `t${k + 1}`,
  numero: k + 1,
  rangQualite: k + 1,
}));

type CategorieDuBanc = {
  id: string;
  inscrits: number;
  dureeSecondes: number;
  belt: string;
  ageGroup: string;
  weightClass: string;
};

const CEINTURES = ["white", "blue", "purple", "brown", "black"] as const;
const DUREES: Readonly<Record<(typeof CEINTURES)[number], number>> = {
  white: 300,
  blue: 360,
  purple: 420,
  brown: 480,
  black: 600,
};
const AGES = ["Adulte", "Master 1", "Master 2", "Juvenil"] as const;
const POIDS = ["Galo", "Pluma", "Pena", "Leve", "Medio", "Meio-Pesado", "Pesado", "Super-Pesado"];

function journeeSynthetique(graine: number, nombre = 60): CategorieDuBanc[] {
  const hasard = mulberry32(graine);
  const parmi = <T>(liste: readonly T[]): T => liste[Math.floor(hasard() * liste.length)] as T;
  return Array.from({ length: nombre }, (_, index) => {
    const tirage = hasard();
    const inscrits =
      tirage < 0.45
        ? 2 + Math.floor(hasard() * 6)
        : tirage < 0.8
          ? 8 + Math.floor(hasard() * 9)
          : tirage < 0.95
            ? 17 + Math.floor(hasard() * 16)
            : 33 + Math.floor(hasard() * 20);
    const belt = parmi(CEINTURES);
    const ageGroup = parmi(AGES);
    return {
      id: `c${index}`,
      inscrits,
      dureeSecondes: ageGroup === "Juvenil" ? 300 : DUREES[belt],
      belt,
      ageGroup,
      weightClass: POIDS[index % POIDS.length] as string,
    };
  });
}

/** Les combats joués du tour le plus chargé : c'est lui qui dimensionne le tableau (30 minutes par tour). */
function combatsDuTourLePlusLong(fights: readonly GeneratedFight[]): number {
  const parTour = new Map<number, number>();
  for (const f of fights) if (!f.isBye) parTour.set(f.division, (parTour.get(f.division) ?? 0) + 1);
  return Math.max(0, ...parTour.values());
}

type MesureDuBanc = {
  finMs: number;
  ecartDesFinsMs: number;
  combatsSansHoraire: number;
  attentesExcessives: number;
  reposInsuffisants: number;
};

function planifierLaJournee(
  categories: readonly CategorieDuBanc[],
  mode: ModeDeConvergence,
): MesureDuBanc {
  const tableaux = new Map(categories.map((c) => [c.id, tableau(c.inscrits, c.id)] as const));
  const joues = (id: string) => (tableaux.get(id) ?? []).filter((f) => !f.isBye).length;
  const cycle = (c: CategorieDuBanc) => c.dureeSecondes + ESPACEMENT_SECONDES;
  const affectations = affecterParListe(
    categories.map((c) => ({
      id: c.id,
      discipline: "gi",
      ageGroup: c.ageGroup,
      belt: c.belt,
      weightClass: c.weightClass,
      dureePrevueSecondes: joues(c.id) * cycle(c),
      chargeSecondes: joues(c.id) * cycle(c),
      parties: proposerLaRepartition({
        inscrits: c.inscrits,
        tatamisDeLaCompetition: TATAMIS.length,
        tourLePlusLong: {
          combats: combatsDuTourLePlusLong(tableaux.get(c.id) ?? []),
          dureeSecondes: c.dureeSecondes,
          espacementSecondes: ESPACEMENT_SECONDES,
        },
      }).proposition,
    })),
    TATAMIS,
  );
  const tatamisDe = (id: string) => affectations.get(id)?.tatamiIds ?? [];

  // La charge fixe d'avant v0.42.0, et celle qui part des combats sans convergence.
  const chargeFixe: Record<string, number> = {};
  const chargeCourante: Record<string, number> = {};
  for (const c of categories) {
    const ids = tatamisDe(c.id);
    for (const t of ids)
      chargeFixe[t] = (chargeFixe[t] ?? 0) + (joues(c.id) * cycle(c)) / ids.length;
    for (const f of tableaux.get(c.id) ?? []) {
      if (f.isBye) continue;
      const decoupe = ids.length > 1 ? partiesDuCombat(f, ids.length) : null;
      if (decoupe?.convergence) continue;
      const t = ids[decoupe?.partie ?? 0] as string;
      chargeCourante[t] = (chargeCourante[t] ?? 0) + cycle(c);
    }
  }

  const rang = (id: string) => affectations.get(id)?.rangDePlanning ?? 0;
  const combats: CombatAPlanifier[] = [];
  for (const c of [...categories].sort((a, b) => rang(a.id) - rang(b.id))) {
    const ids = tatamisDe(c.id);
    const fights = (tableaux.get(c.id) ?? []).map((f) => ({
      ...f,
      id: `${c.id}:${structuralKey(f)}`,
    }));
    const places =
      ids.length > 1
        ? repartirLesCombats({
            tatamis: ids.map((id) => ({ id, numero: Number(id.slice(1)) })),
            combats: fights,
            chargeParTatami: mode === "moins_charge" ? chargeCourante : chargeFixe,
            convergence: mode,
            cycleSecondes: cycle(c),
          })
        : null;
    for (const f of fights) {
      const place = places?.get(f.id);
      const tatamiId = place?.tatamiId ?? (ids[0] as string);
      // La charge suit la catégorie suivante, comme dans la plateforme.
      if (mode === "moins_charge" && place?.convergence === true && !f.isBye) {
        chargeCourante[tatamiId] = (chargeCourante[tatamiId] ?? 0) + cycle(c);
      }
      combats.push({
        id: f.id,
        categorieId: c.id,
        tatamiId,
        division: f.division,
        indexInDivision: f.indexInDivision,
        type: f.type,
        isBye: f.isBye,
        athletes: [f.slotA, f.slotB],
      });
    }
  }

  const entree: EntreeDePlanification = {
    espacementSecondes: ESPACEMENT_SECONDES,
    tatamis: TATAMIS.map((t) => ({ id: t.id, numero: t.numero, debutParJour: { 0: NEUF_HEURES } })),
    categories: categories.map((c) => ({
      id: c.id,
      dureeSecondes: c.dureeSecondes,
      jour: 0,
      rangDePlanning: rang(c.id),
    })),
    combats,
  };
  const resultat = planifierCombats(entree);
  const evaluation = evaluerLaJournee(entree, resultat, 0);

  const duree = new Map(categories.map((c) => [c.id, c.dureeSecondes] as const));
  const sources = sourcesDesCombats(combats);
  const controles: CombatControle[] = [];
  for (const combat of combats) {
    const place = resultat.combats.get(combat.id);
    if (place === undefined) continue;
    controles.push({
      fightId: combat.id,
      categorieId: combat.categorieId,
      tatamiId: place.tatamiId,
      jour: place.jour,
      rang: place.rang,
      debutMs: place.debutMs,
      finMs: place.finMs,
      division: combat.division,
      type: combat.type,
      dureeSecondes: duree.get(combat.categorieId) ?? 0,
      sources: sources.get(combat.id) ?? [],
    });
  }
  const constats = controlerLePlanning({ combats: controles });
  return {
    finMs: evaluation.finMs ?? NEUF_HEURES,
    ecartDesFinsMs: evaluation.ecartDesFinsMs,
    combatsSansHoraire: evaluation.combatsSansHoraire,
    attentesExcessives: constats.filter((c) => c.type === "attente_excessive").length,
    reposInsuffisants: constats.filter((c) => c.type === "repos_insuffisant").length,
  };
}

const GRAINES = [1, 2, 3, 4, 5, 6, 7, 8];

describe("le banc de l'équilibre des tatamis : une journée synthétique de 60 catégories sur 8 tatamis", () => {
  const mesures = GRAINES.map((graine) => {
    const categories = journeeSynthetique(graine);
    return {
      graine,
      avant: planifierLaJournee(categories, "plus_tardif"),
      apres: planifierLaJournee(categories, "moins_charge"),
    };
  });

  it("la convergence au tatami le moins chargé rapproche les fins des tatamis, sur chaque journée", () => {
    for (const { graine, avant, apres } of mesures) {
      expect(apres.ecartDesFinsMs, `graine ${graine}`).toBeLessThan(avant.ecartDesFinsMs);
    }
    // Mesuré sur les huit journées : 2 584 minutes d'écart cumulé avant, 419 après.
    const total = (cle: "avant" | "apres") =>
      mesures.reduce((somme, m) => somme + m[cle].ecartDesFinsMs, 0) / MINUTE;
    expect(total("apres")).toBeLessThan(0.25 * total("avant"));
  });

  it("sans finir la journée plus tard, ni laisser un combat sans horaire", () => {
    for (const { graine, avant, apres } of mesures) {
      expect(apres.finMs - avant.finMs, `graine ${graine}`).toBeLessThan(5 * MINUTE);
      expect(apres.combatsSansHoraire, `graine ${graine}`).toBe(0);
      expect(avant.combatsSansHoraire, `graine ${graine}`).toBe(0);
    }
  });

  it("sans repos insuffisant, et sans attente excessive de plus", () => {
    for (const { graine, avant, apres } of mesures) {
      expect(apres.reposInsuffisants, `graine ${graine}`).toBe(0);
      expect(apres.attentesExcessives, `graine ${graine}`).toBeLessThanOrEqual(
        avant.attentesExcessives,
      );
    }
  });

  it("la même graine donne la même journée et la même mesure", () => {
    const categories = journeeSynthetique(GRAINES[0] as number);
    expect(planifierLaJournee(categories, "moins_charge")).toEqual(mesures[0]?.apres);
  });
});

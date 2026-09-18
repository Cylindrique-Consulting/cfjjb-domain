import { generateBracket, type BracketEntry, type GeneratedFight } from "../src/bracket-generator";
import {
  findFeederFight,
  structuralKey,
  type PropagationFight,
  type Slot,
} from "../src/bracket-propagation";
import type { CombatControle } from "../src/controles-de-planning";
import type {
  CategorieAPlanifier,
  CombatAPlanifier,
  ResultatDePlanification,
} from "../src/ordonnanceur-planning";
import {
  repartirLesCombats,
  type PlaceDeCombat,
  type TatamiDeRepartition,
} from "../src/repartition-tatamis";

export const MINUTE = 60_000;

export function heure(hhmm: string, jourMs = 0): number {
  const [h = "0", m = "0"] = hhmm.split(":");
  return jourMs + Number(h) * 60 * MINUTE + Number(m) * MINUTE;
}

export function hhmm(ms: number, jourMs = 0): string {
  const total = Math.round((ms - jourMs) / MINUTE);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function inscrits(nombre: number, prefixe = "a"): BracketEntry[] {
  return Array.from({ length: nombre }, (_, index) => ({
    registrationId: `${prefixe}${index + 1}`,
    clubId: null,
  }));
}

export function tableau(
  nombre: number,
  prefixe = "a",
  thirdPlaceMode: "pool3" | "shared_bronze" = "shared_bronze",
): GeneratedFight[] {
  const resultat = generateBracket(inscrits(nombre, prefixe), `graine-${prefixe}`, {
    thirdPlaceMode,
  });
  if (resultat.kind !== "bracket") throw new Error(`tableau non généré pour ${nombre} inscrits`);
  return resultat.fights;
}

export function tatamis(nombre: number, prefixe = "t"): TatamiDeRepartition[] {
  return Array.from({ length: nombre }, (_, index) => ({
    id: `${prefixe}${index + 1}`,
    numero: index + 1,
  }));
}

export type CategorieDeTest = {
  id: string;
  fights: GeneratedFight[];
  tatamis: TatamiDeRepartition[];
  dureeSecondes: number;
  jour?: number;
  rangDePlanning: number;
  chargeParTatami?: Readonly<Record<string, number>>;
  tatamiParCombat?: Readonly<Record<string, string>>;
};

export type MontageDePlanning = {
  categories: CategorieAPlanifier[];
  combats: CombatAPlanifier[];
  places: Map<string, PlaceDeCombat>;
};

export function monter(categories: readonly CategorieDeTest[]): MontageDePlanning {
  const sortiesCategories: CategorieAPlanifier[] = [];
  const combats: CombatAPlanifier[] = [];
  const places = new Map<string, PlaceDeCombat>();

  for (const categorie of categories) {
    sortiesCategories.push({
      id: categorie.id,
      dureeSecondes: categorie.dureeSecondes,
      jour: categorie.jour ?? 0,
      rangDePlanning: categorie.rangDePlanning,
    });
    const identifies = categorie.fights.map((fight) => ({
      ...fight,
      id: `${categorie.id}:${structuralKey(fight)}`,
    }));
    const repartition = repartirLesCombats({
      tatamis: categorie.tatamis,
      combats: identifies,
      ...(categorie.chargeParTatami === undefined
        ? {}
        : { chargeParTatami: categorie.chargeParTatami }),
      ...(categorie.tatamiParCombat === undefined
        ? {}
        : { tatamiParCombat: categorie.tatamiParCombat }),
    });
    for (const combat of identifies) {
      const place = repartition.get(combat.id);
      if (place === undefined) throw new Error(`combat non réparti : ${combat.id}`);
      places.set(combat.id, place);
      combats.push({
        id: combat.id,
        categorieId: categorie.id,
        tatamiId: place.tatamiId,
        division: combat.division,
        indexInDivision: combat.indexInDivision,
        type: combat.type,
        isBye: combat.isBye,
        athletes: [combat.slotA, combat.slotB],
      });
    }
  }

  return { categories: sortiesCategories, combats, places };
}

function versPropagation(combat: CombatAPlanifier): PropagationFight {
  return {
    id: combat.id,
    division: combat.division,
    indexInDivision: combat.indexInDivision,
    type: combat.type,
    slotA: combat.athletes?.[0] ?? null,
    slotB: combat.athletes?.[1] ?? null,
    isBye: combat.isBye === true,
    state: "scheduled",
    winner: null,
    winMethod: null,
    needsArbitration: false,
    version: 0,
  };
}

export function sourcesDuMontage(montage: MontageDePlanning): Map<string, (string | null)[]> {
  const parCategorie = new Map<string, CombatAPlanifier[]>();
  for (const combat of montage.combats) {
    const liste = parCategorie.get(combat.categorieId);
    if (liste) liste.push(combat);
    else parCategorie.set(combat.categorieId, [combat]);
  }
  const byes = new Set(montage.combats.filter((c) => c.isBye === true).map((c) => c.id));
  const sources = new Map<string, (string | null)[]>();
  const slots: Slot[] = ["A", "B"];
  for (const liste of parCategorie.values()) {
    const proxies = liste.map(versPropagation);
    for (const combat of liste) {
      const resolues = slots.map((slot, rang) => {
        if ((combat.athletes?.[rang] ?? null) !== null) return null;
        const nourricier = findFeederFight(proxies, versPropagation(combat), slot);
        if (nourricier === null || byes.has(nourricier.id)) return null;
        return nourricier.id;
      });
      sources.set(combat.id, resolues);
    }
  }
  return sources;
}

export function versControle(
  montage: MontageDePlanning,
  resultat: ResultatDePlanification,
  durees: Readonly<Record<string, number>>,
  competitionId?: string,
): CombatControle[] {
  const sources = sourcesDuMontage(montage);
  const controles: CombatControle[] = [];
  for (const combat of montage.combats) {
    const place = resultat.combats.get(combat.id);
    if (place === undefined) continue;
    controles.push({
      fightId: combat.id,
      ...(competitionId === undefined ? {} : { competitionId }),
      categorieId: combat.categorieId,
      tatamiId: place.tatamiId,
      jour: place.jour,
      rang: place.rang,
      debutMs: place.debutMs,
      finMs: place.finMs,
      division: combat.division,
      type: combat.type,
      dureeSecondes: durees[combat.categorieId] ?? 0,
      sources: sources.get(combat.id) ?? [],
    });
  }
  return controles;
}

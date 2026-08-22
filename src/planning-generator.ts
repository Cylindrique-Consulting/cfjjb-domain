import { AGE_GROUPS, WEIGHT_CLASSES, isChildAgeGroup, type AgeGroup } from "./referential";
import type { GeneratedFight } from "./bracket-generator";
import type { DrawFormat } from "./competition-format";
import type { BeltDb, DisciplineDb } from "./enums";
import { ALL_BELTS } from "./belts";

/**
 * Planning generator: distributes categories over the physical tatamis and
 * computes sequential fight start times.
 *
 * - Phases: children first (default), then juveniles/adults/masters.
 * - Assignment: LPT (longest processing time) on the cumulated tatami load.
 * - Intra-tatami order: phase, then age group, belt, weight class,
 *   discipline (spectator-friendly grouping; load balance is unchanged).
 * - Times: one timeline per PHYSICAL tatami (Jour J splits a physical mat
 *   into one fight_area per Jour J competition, but the day is sequential
 *   on the mat). Within a category: deepest division first, index
 *   ascending, then the Pool3, then the final (finalists get to rest).
 * - Byes get no start time (Jour J's planning hides fights without one).
 * - Days: a competition runs over ONE or TWO days (`second_day_date`), and
 *   les catégories sont réparties entre les jours AVANT le LPT par tatami.
 *   `planCategories` reste la brique d'un SEUL jour : à un jour,
 *   `planCategoriesOverDays` lui passe la même liste, dans le même ordre, et
 *   rend donc exactement le même planning.
 */

export type PlanningCategory = {
  id: string;
  discipline: DisciplineDb;
  belt: BeltDb;
  ageGroup: AgeGroup;
  weightClass: string;
  fightTimeSeconds: number;
  /** Real (non-bye) fights, Pool3 included. */
  realFightCount: number;
};

export type PlanningParams = {
  tatamiCount: number;
  bufferSeconds?: number;
  childrenFirst?: boolean;
};

export type TatamiPlan = {
  tatamiIndex: number; // 0-based
  categoryIds: string[]; // ordered
  totalSeconds: number;
};

// CYL-434 — c'était une DUPLICATION LITTÉRALE d'`ALL_BELTS`
// (`lib/licensees/belts.ts`), au caractère près. Deux listes de grades
// finissent toujours par diverger, et la divergence serait muette : un
// planning trierait les catégories dans un ordre, l'éligibilité dans un autre.
const BELT_ORDER: ReadonlyArray<BeltDb> = ALL_BELTS;

function categoryDurationSeconds(cat: PlanningCategory, bufferSeconds: number): number {
  return cat.realFightCount * (cat.fightTimeSeconds + bufferSeconds);
}

function intraTatamiRank(cat: PlanningCategory): number[] {
  return [
    isChildAgeGroup(cat.ageGroup) ? 0 : 1,
    AGE_GROUPS.indexOf(cat.ageGroup),
    BELT_ORDER.indexOf(cat.belt),
    WEIGHT_CLASSES.indexOf(cat.weightClass as (typeof WEIGHT_CLASSES)[number]),
    cat.discipline === "gi" ? 0 : 1,
  ];
}

function compareRanks(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * Assign categories to tatamis (LPT per phase, cumulative loads) and order
 * them inside each tatami.
 */
export function planCategories(
  categories: PlanningCategory[],
  params: PlanningParams,
): TatamiPlan[] {
  const buffer = params.bufferSeconds ?? 60;
  const childrenFirst = params.childrenFirst ?? true;
  const count = Math.max(1, params.tatamiCount);

  const loads = new Array<number>(count).fill(0);
  const assigned: PlanningCategory[][] = Array.from({ length: count }, () => []);

  const phases: PlanningCategory[][] = childrenFirst
    ? [
        categories.filter((c) => isChildAgeGroup(c.ageGroup)),
        categories.filter((c) => !isChildAgeGroup(c.ageGroup)),
      ]
    : [categories];

  for (const phase of phases) {
    const byDuration = [...phase].sort(
      (a, b) => categoryDurationSeconds(b, buffer) - categoryDurationSeconds(a, buffer),
    );
    for (const cat of byDuration) {
      let best = 0;
      for (let t = 1; t < count; t++) {
        if ((loads[t] ?? 0) < (loads[best] ?? 0)) best = t;
      }
      loads[best] = (loads[best] ?? 0) + categoryDurationSeconds(cat, buffer);
      assigned[best]?.push(cat);
    }
  }

  return assigned.map((cats, tatamiIndex) => {
    const ordered = [...cats].sort((a, b) => compareRanks(intraTatamiRank(a), intraTatamiRank(b)));
    return {
      tatamiIndex,
      categoryIds: ordered.map((c) => c.id),
      totalSeconds: loads[tatamiIndex] ?? 0,
    };
  });
}

// ------------------------------------------------------------------
// Dimension JOUR
// ------------------------------------------------------------------

/**
 * Un jour de compétition, en millisecondes epoch.
 *
 * POURQUOI CE TYPE EXISTE. Les compétitions sur deux jours sont en production
 * (`second_day_date`, `second_day_start_time`, `second_day_end_time`, affichées
 * « Jour 1 / Jour 2 »), et le générateur n'en avait aucune notion : une
 * compétition de deux jours recevait un planning d'un seul. Le planning pilote
 * la zone d'appel, l'échauffement et l'ordre de pesée — sans dimension jour,
 * l'écran de zone d'appel appelle le jour 1 des gens qui combattent le jour 2.
 *
 * `endAtMs <= startAtMs` vaut « fin inconnue » : les colonnes d'heure de fin
 * sont NULLABLES en base. Un jour sans fin connue est alors SANS BORNE — il
 * absorbe tout ce qu'on lui donne. On ne devine pas une heure de fin, et on ne
 * perd jamais une catégorie faute de place : elle serait invisible partout.
 */
export type PlanningDay = {
  startAtMs: number;
  endAtMs: number;
};

export type MultiDayPlanningParams = PlanningParams & {
  /** Ordonnés, jour 1 en tête. Un seul jour = comportement historique. */
  days: PlanningDay[];
};

export type DayPlan = {
  dayIndex: number; // 0-based, le jour 1 porte l'indice 0
  startAtMs: number;
  endAtMs: number;
  tatamis: TatamiPlan[];
  /**
   * Secondes de dépassement du tatami le plus chargé au-delà de l'heure de
   * fin. 0 = la journée tient. Le dépassement est RENDU, jamais tu : le
   * dernier jour absorbe ce qui ne tient nulle part, et l'organisateur doit
   * pouvoir le lire (ajouter un tatami, allonger la journée).
   */
  overrunSeconds: number;
};

/** Durée d'une journée en secondes ; `Infinity` si l'heure de fin est inconnue. */
function dayLengthSeconds(day: PlanningDay): number {
  const ms = day.endAtMs - day.startAtMs;
  return ms > 0 ? ms / 1000 : Number.POSITIVE_INFINITY;
}

/**
 * Répartit les catégories entre les jours, AVANT tout LPT par tatami.
 *
 * Règle : on parcourt les catégories dans l'ORDRE CANONIQUE de la compétition
 * — celui-là même qui ordonne un tatami (`intraTatamiRank` : enfants d'abord,
 * puis âge, ceinture, poids, discipline) — et on remplit les jours dans
 * l'ordre. Le jour 1 est donc un PRÉFIXE de cet ordre : un bloc d'âge ou de
 * ceinture n'est jamais coupé en deux par une petite catégorie repêchée après
 * coup, et la journée reste lisible pour le public comme pour la pesée.
 *
 * Deux conditions pour qu'une catégorie tienne dans un jour :
 *   1. sa propre durée tient dans la JOURNÉE — une catégorie se déroule sur un
 *      seul tatami, elle ne peut pas être plus longue que le jour ;
 *   2. la charge cumulée du jour tient dans `tatamiCount × durée du jour`.
 *
 * Le DERNIER jour n'est pas plafonné : il absorbe le reste. Refuser une
 * catégorie reviendrait à la faire disparaître du planning ; le dépassement
 * est rendu par `DayPlan.overrunSeconds`.
 *
 * Chaque jour rend ses catégories dans l'ORDRE D'ENTRÉE, pas dans l'ordre
 * canonique : c'est ce qui garantit qu'à un seul jour, `planCategories`
 * reçoit exactement la liste d'origine et rend exactement le même planning.
 */
export function assignCategoriesToDays(
  categories: PlanningCategory[],
  params: MultiDayPlanningParams,
): PlanningCategory[][] {
  const days = params.days;
  if (days.length === 0) {
    throw new Error("planning : au moins un jour de compétition est requis.");
  }
  if (days.length === 1) return [[...categories]];

  const buffer = params.bufferSeconds ?? 60;
  const tatamiCount = Math.max(1, params.tatamiCount);
  const lengths = days.map(dayLengthSeconds);
  const capacities = lengths.map((length) => length * tatamiCount);
  const loads = new Array<number>(days.length).fill(0);
  const lastIndex = days.length - 1;

  const canonical = [...categories].sort((a, b) =>
    compareRanks(intraTatamiRank(a), intraTatamiRank(b)),
  );

  const dayOf = new Map<string, number>();
  let cursor = 0; // on n'ouvre jamais un jour déjà refermé
  for (const cat of canonical) {
    const duration = categoryDurationSeconds(cat, buffer);
    let target = lastIndex;
    for (let d = cursor; d < lastIndex; d++) {
      const tientSurUnTatami = duration <= (lengths[d] ?? 0);
      const tientDansLaJournee = (loads[d] ?? 0) + duration <= (capacities[d] ?? 0);
      if (tientSurUnTatami && tientDansLaJournee) {
        target = d;
        break;
      }
    }
    loads[target] = (loads[target] ?? 0) + duration;
    dayOf.set(cat.id, target);
    cursor = target;
  }

  return days.map((_day, dayIndex) => categories.filter((c) => dayOf.get(c.id) === dayIndex));
}

/**
 * Planning complet : répartition par jour, puis LPT par tatami dans chaque
 * jour. À UN SEUL jour, la sortie est celle de `planCategories` — même
 * fonction, même liste, même ordre.
 *
 * Les horaires se calculent ensuite jour par jour :
 * `computeTatamiSchedule(catégories du tatami, day.startAtMs)`.
 */
export function planCategoriesOverDays(
  categories: PlanningCategory[],
  params: MultiDayPlanningParams,
): DayPlan[] {
  const perDay = assignCategoriesToDays(categories, params);

  return params.days.map((day, dayIndex) => {
    const tatamis = planCategories(perDay[dayIndex] ?? [], params);
    const busiestSeconds = tatamis.reduce((max, t) => Math.max(max, t.totalSeconds), 0);
    const length = dayLengthSeconds(day);
    return {
      dayIndex,
      startAtMs: day.startAtMs,
      endAtMs: day.endAtMs,
      tatamis,
      overrunSeconds: Number.isFinite(length) ? Math.max(0, busiestSeconds - length) : 0,
    };
  });
}

// ------------------------------------------------------------------
// Fight scheduling
// ------------------------------------------------------------------

export type SchedulableCategory = {
  id: string;
  fightTimeSeconds: number;
  fights: Array<Pick<GeneratedFight, "division" | "indexInDivision" | "type" | "isBye">>;
  /** Le format RÉELLEMENT appliqué. Absent = `single_elim`, comportement d'avant ce lot. */
  format?: DrawFormat;
};

export type FightTimeKey = string; // `${categoryId}:${division}:${indexInDivision}:${type}`

export function fightTimeKey(
  categoryId: string,
  fight: Pick<GeneratedFight, "division" | "indexInDivision" | "type">,
): FightTimeKey {
  return `${categoryId}:${fight.division}:${fight.indexInDivision}:${fight.type}`;
}

/**
 * Spectator/fighter friendly running order inside a category:
 * deepest division first (index ascending), then the Pool3, then the final.
 *
 * ┌─ POURQUOI CETTE FONCTION PREND MAINTENANT LE FORMAT ──────────────────────┐
 * │ Les trois seaux ci-dessous partent tous d'une hypothèse : `division ≥ 1`.  │
 * │ Un combat de POULE porte `division = 0`. Il n'est donc ni dans `final`     │
 * │ (`=== 1`), ni dans `earlier` (`> 1`), ni dans `pool3` (mauvais type) :     │
 * │ il DISPARAÎT purement et simplement du tableau rendu.                     │
 * │                                                                            │
 * │ Et cette fonction est le calculateur d'horaires : un combat qui n'en sort  │
 * │ pas n'a pas d'heure de début, et le planning du jour J masque les combats  │
 * │ sans heure. Une poule entière serait invisible sur la zone d'appel, sans   │
 * │ une seule erreur. C'est mesuré par un test, pas déduit d'ici.              │
 * │                                                                            │
 * │ En poule, `index_in_division` EST l'ordre de passage — c'est le contrat de │
 * │ `pool-generator.ts` — donc l'ordre s'y lit directement, et la passe        │
 * │ d'ajustement du repos serait détruite par un autre tri.                    │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
export function categoryRunningOrder<
  T extends Pick<GeneratedFight, "division" | "indexInDivision" | "type">,
>(fights: T[], opts: { format?: DrawFormat } = {}): T[] {
  if (opts.format === "pools") {
    return [...fights].sort((a, b) => a.indexInDivision - b.indexInDivision);
  }
  const regular = fights.filter((f) => f.type === "BraketFight");
  const pool3 = fights.filter((f) => f.type === "BraketFightPool3");
  const final = regular.filter((f) => f.division === 1);
  const earlier = regular
    .filter((f) => f.division > 1)
    .sort((a, b) => b.division - a.division || a.indexInDivision - b.indexInDivision);
  return [...earlier, ...pool3, ...final];
}

export type ScheduleResult = {
  /** Start time (epoch ms) per real fight; byes are absent. */
  fightTimes: Map<FightTimeKey, number>;
  /** Start time (epoch ms) of each category's first real fight. */
  categoryStarts: Map<string, number>;
  /** End of the tatami's day (epoch ms). */
  endsAt: number;
};

/**
 * Sequential schedule of one tatami: categories in order, each category's
 * real fights back-to-back (fight time + buffer).
 *
 * Le `bufferSeconds` est aussi le TAMPON DE REPOS des deux seules tailles de
 * poule où un enchaînement est structurellement inévitable (n = 3 et n = 4,
 * cf. `POOL_SIZES_WITHOUT_REST`). Le raccourcir n'est donc pas qu'un réglage
 * de fluidité.
 */
export function computeTatamiSchedule(
  orderedCategories: SchedulableCategory[],
  startAtMs: number,
  bufferSeconds = 60,
): ScheduleResult {
  const fightTimes = new Map<FightTimeKey, number>();
  const categoryStarts = new Map<string, number>();
  let cursor = startAtMs;

  for (const cat of orderedCategories) {
    const real = categoryRunningOrder(cat.fights, { format: cat.format }).filter((f) => !f.isBye);
    if (real.length > 0) categoryStarts.set(cat.id, cursor);
    for (const fight of real) {
      fightTimes.set(fightTimeKey(cat.id, fight), cursor);
      cursor += (cat.fightTimeSeconds + bufferSeconds) * 1000;
    }
  }

  return { fightTimes, categoryStarts, endsAt: cursor };
}

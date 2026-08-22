/**
 * LE PANNEAU DE DIMENSIONNEMENT : ce qu'il faut savoir AVANT de générer.
 *
 * ┌─ LA CONTRAINTE, ET ELLE N'EST PAS ÉVIDENTE ───────────────────────────────┐
 * │ `computeMedalNeed` est alimenté par des CATÉGORIES. Or une catégorie est   │
 * │ une ligne de `competition_categories`, et ces lignes n'existent qu'APRÈS   │
 * │ la génération des tableaux : l'écran /admin/competitions/[id] les lit en   │
 * │ base (`getCompetitionCategoriesForMedals`) et affiche « 0 médaille » tant  │
 * │ que rien n'a été généré.                                                   │
 * │                                                                            │
 * │ Un panneau de dimensionnement qui doit servir AVANT — pour choisir le      │
 * │ nombre de tapis, pour commander les médailles des semaines à l'avance —    │
 * │ ne peut donc pas s'en servir. Il lui faut les mêmes catégories, mais       │
 * │ VIRTUELLES : les étapes 1 à 3 du générateur, sans une seule écriture.      │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * LA RECOMMANDATION DE TAPIS S'OBTIENT EN EXÉCUTANT LE PLANNING RÉEL.
 * `recommendTatamiCount` appelle `planCategories` puis `computeTatamiSchedule`
 * pour chaque nombre de tapis candidat, sur les combats que le générateur
 * produit vraiment. Aucune estimation parallèle n'est écrite ici : une formule
 * d'estimation à côté du planning est une deuxième vérité, et la divergence
 * serait muette — l'écran recommanderait quatre tapis pendant que le planning
 * en demanderait six, sans que rien ne les confronte.
 *
 * Module pur : aucune IO, aucune dépendance.
 */

import type { BracketEntry, GeneratedFight } from "./bracket-generator";
import { generateCategoryDraw, type CategoryDraw, type DrawFallback } from "./category-draw";
import { formatForAgeGroup, type DrawFormat, type FormatByAgeGroup } from "./competition-format";
import { breakdownRegistrations, isActiveBracketStatus, type FillBreakdown } from "./capacity";
import { resolveAgeGroup, resolveWeightClass } from "./db-vocabulary";
import type { BeltDb, DisciplineDb, GenderDb, ThirdPlaceMode } from "./enums";
import { computeMedalNeed, type MedalNeed } from "./medals";
import {
  computeTatamiSchedule,
  planCategories,
  type PlanningCategory,
  type SchedulableCategory,
} from "./planning-generator";
import { MAX_POOL_SIZE_DEFAULT } from "./pool-generator";
import {
  buildCategoryFullname,
  getFightDurationSeconds,
  type AgeGroup,
  type WeightClassName,
} from "./referential";

// ===================================================================
// LA PROJECTION VIRTUELLE (étapes 1 à 3 du générateur, sans écriture)
// ===================================================================

/**
 * Une inscription telle qu'elle se lit en base, colonnes de catégorie BRUTES.
 *
 * `ageGroup` et `weightClass` sont des chaînes et non des types du référentiel,
 * parce que la colonne porte DEUX VOCABULAIRES (cf. `db-vocabulary.ts`) : des
 * codes ETL (`adult`, `u11`, indices `"0"`–`"8"`) et des libellés écrits par la
 * plateforme (`Adulte`, `Leve`). Prendre un `AgeGroup` en entrée obligerait
 * l'appelant à convertir, c'est-à-dire à réinventer la conversion.
 */
export type SizingRegistration = {
  readonly registrationId: string;
  readonly clubId?: string | null;
  readonly status: string;
  readonly discipline: DisciplineDb | null;
  readonly belt: BeltDb | null;
  readonly ageGroup: string | null;
  readonly gender: GenderDb | null;
  readonly weightClass: string | null;
};

/**
 * LA CLÉ DE TUPLE, miroir de `tupleKeyOf` (`bracket-registrations.ts`).
 *
 * ⚠ ELLE GROUPE SUR LES VALEURS BRUTES, DÉLIBÉRÉMENT. Le générateur groupe sur
 * les colonnes telles quelles : `adult` et `Adulte` y produisent DEUX
 * catégories distinctes, chacune avec son tableau et son podium. Une projection
 * qui les fusionnerait annoncerait une catégorie de moins et un jeu de
 * médailles de moins que ce qui sera réellement généré — elle serait plus
 * « juste » et complètement inutile. On prédit ce que le générateur FERA.
 */
export function sizingTupleKey(r: {
  discipline: string;
  belt: string;
  ageGroup: string;
  gender: string;
  weightClass: string;
}): string {
  return [r.discipline, r.belt, r.ageGroup, r.gender, r.weightClass].join("|");
}

/**
 * Une catégorie PROJETÉE : tout ce que la ligne de base porterait, sans la
 * ligne de base.
 */
export type VirtualCategory = {
  readonly key: string;
  readonly discipline: DisciplineDb;
  readonly belt: BeltDb;
  readonly ageGroup: AgeGroup;
  readonly gender: GenderDb;
  readonly weightClass: WeightClassName;
  readonly fullname: string;
  readonly fightTimeSeconds: number;
  readonly competitorCount: number;
  readonly singleCompetitor: boolean;
  readonly registrationIds: readonly string[];
  readonly requestedFormat: DrawFormat;
  /** Le format RÉELLEMENT appliqué : une poule trop grosse s'y lit repliée. */
  readonly appliedFormat: DrawFormat;
  /** Présent ⟺ le format demandé n'a pas pu être appliqué. */
  readonly fallback?: DrawFallback;
  /** Les combats du tirage RÉEL, byes compris. */
  readonly fights: readonly GeneratedFight[];
  /** Combats réels, byes exclus, combat de 3e place inclus. */
  readonly realFightCount: number;
};

/**
 * Ce que la projection a REFUSÉ, et pourquoi. Compté, jamais tu.
 *
 * ⚠ `getFightDurationSeconds` rend `null` sur un code non converti, et le
 * générateur le rattrape par un `?? 300` : une catégorie d'enfants recevrait
 * cinq minutes de combat au lieu de trois, et le planning entier serait faux
 * sans une seule erreur. C'est exactement le repli muet que `db-vocabulary.ts`
 * existe pour supprimer. Ici, une ligne dont on ne sait pas nommer la tranche
 * d'âge est ÉCARTÉE et COMPTÉE, jamais approximée.
 */
export type SizingRejections = {
  /** Actives, mais sans colonnes de catégorie : le `skippedLegacy` du générateur. */
  readonly colonnesManquantes: number;
  /** `age_group` hors des deux vocabulaires. */
  readonly ageNonResolu: number;
  /** `weight_class` hors des deux vocabulaires. */
  readonly classeNonResolue: number;
  /** Tranche d'âge et ceinture connues, mais combinaison absente du référentiel. */
  readonly dureeInconnue: number;
};

export type CategoryProjection = {
  readonly categories: readonly VirtualCategory[];
  /** La ventilation par statut. Le numérateur du taux vient d'ICI. */
  readonly breakdown: FillBreakdown;
  readonly rejections: SizingRejections;
};

export type ProjectionOptions = {
  readonly thirdPlaceMode: ThirdPlaceMode;
  /** Défaut : `DEFAULT_FORMAT_BY_AGE_GROUP`, c'est-à-dire élimination partout. */
  readonly formatTable?: Partial<FormatByAgeGroup>;
  /** Défaut : `MAX_POOL_SIZE_DEFAULT` (6). */
  readonly maxPoolSize?: number;
  /**
   * Graine du tirage. Le nombre et la structure des combats n'en dépendent
   * PAS — seuls les noms dans les cases changent — mais la projection reste
   * déterministe, et une capture d'écran se rejoue.
   */
  readonly seed?: string;
};

/** Les combats d'un tirage, quel que soit le format et quelle que soit sa taille. */
function drawFights(draw: CategoryDraw): {
  fights: readonly GeneratedFight[];
  realFightCount: number;
} {
  if (draw.appliedFormat === "pools") {
    return draw.pool.kind === "pool"
      ? { fights: draw.pool.fights, realFightCount: draw.pool.realFightCount }
      : { fights: [], realFightCount: 0 };
  }
  return draw.bracket.kind === "bracket"
    ? { fights: draw.bracket.fights, realFightCount: draw.bracket.realFightCount }
    : { fights: [], realFightCount: 0 };
}

/**
 * LES ÉTAPES 1 À 3 DU GÉNÉRATEUR, SANS LES ÉCRITURES.
 *
 *   1. sélection des inscriptions ACTIVES (`isActiveBracketStatus`) et des
 *      lignes réellement catégorisables ;
 *   2. regroupement par tuple de catégorie ;
 *   3. tirage de chaque catégorie dans le format qui s'y applique.
 *
 * L'étape 3 exécute le VRAI tirage (`generateCategoryDraw`) plutôt que d'en
 * estimer le volume. C'est ce qui rend la suite — planning, médailles,
 * recommandation de tapis — incapable de diverger du jour J.
 */
export function projectCategories(
  rows: readonly SizingRegistration[],
  opts: ProjectionOptions,
): CategoryProjection {
  const breakdown = breakdownRegistrations(rows.map((r) => r.status));

  let colonnesManquantes = 0;
  let ageNonResolu = 0;
  let classeNonResolue = 0;
  let dureeInconnue = 0;

  type Groupe = {
    key: string;
    discipline: DisciplineDb;
    belt: BeltDb;
    ageGroup: AgeGroup;
    gender: GenderDb;
    weightClass: WeightClassName;
    fightTimeSeconds: number;
    entries: BracketEntry[];
  };
  const groupes = new Map<string, Groupe>();

  for (const row of rows) {
    if (!isActiveBracketStatus(row.status)) continue;

    const { discipline, belt, gender } = row;
    if (!discipline || !belt || !gender || !row.ageGroup || !row.weightClass) {
      colonnesManquantes++;
      continue;
    }

    const ageGroup = resolveAgeGroup(row.ageGroup);
    if (!ageGroup) {
      ageNonResolu++;
      continue;
    }
    const weightClass = resolveWeightClass(row.weightClass);
    if (!weightClass) {
      classeNonResolue++;
      continue;
    }
    const fightTimeSeconds = getFightDurationSeconds(belt, ageGroup, discipline);
    if (fightTimeSeconds === null) {
      dureeInconnue++;
      continue;
    }

    // La clé groupe sur le BRUT : deux vocabulaires pour la même catégorie
    // produisent deux catégories chez le générateur, donc ici aussi.
    const key = sizingTupleKey({
      discipline,
      belt,
      ageGroup: row.ageGroup,
      gender,
      weightClass: row.weightClass,
    });

    const existant = groupes.get(key);
    const entry: BracketEntry = { registrationId: row.registrationId, clubId: row.clubId ?? null };
    if (existant) existant.entries.push(entry);
    else {
      groupes.set(key, {
        key,
        discipline,
        belt,
        ageGroup,
        gender,
        weightClass,
        fightTimeSeconds,
        entries: [entry],
      });
    }
  }

  const maxPoolSize = opts.maxPoolSize ?? MAX_POOL_SIZE_DEFAULT;
  const categories: VirtualCategory[] = [];

  for (const groupe of groupes.values()) {
    const fullname = buildCategoryFullname({
      belt: groupe.belt,
      ageGroup: groupe.ageGroup,
      gender: groupe.gender,
      weightClass: groupe.weightClass,
    });
    const requestedFormat = formatForAgeGroup(groupe.ageGroup, opts.formatTable);
    const draw = generateCategoryDraw(
      groupe.entries,
      `${opts.seed ?? "dimensionnement"}:${fullname}`,
      {
        format: requestedFormat,
        thirdPlaceMode: opts.thirdPlaceMode,
        maxPoolSize,
      },
    );
    const { fights, realFightCount } = drawFights(draw);

    categories.push({
      key: groupe.key,
      discipline: groupe.discipline,
      belt: groupe.belt,
      ageGroup: groupe.ageGroup,
      gender: groupe.gender,
      weightClass: groupe.weightClass,
      fullname,
      fightTimeSeconds: groupe.fightTimeSeconds,
      competitorCount: groupe.entries.length,
      singleCompetitor: groupe.entries.length === 1,
      registrationIds: groupe.entries.map((e) => e.registrationId),
      requestedFormat,
      appliedFormat: draw.appliedFormat,
      ...(draw.appliedFormat === "single_elim" && draw.fallback ? { fallback: draw.fallback } : {}),
      fights,
      realFightCount,
    });
  }

  return {
    categories,
    breakdown,
    rejections: { colonnesManquantes, ageNonResolu, classeNonResolue, dureeInconnue },
  };
}

// ===================================================================
// LE PLANNING RÉEL, EXÉCUTÉ POUR CHAQUE NOMBRE DE TAPIS CANDIDAT
// ===================================================================

/**
 * Les catégories telles que le PLANNING les reçoit.
 *
 * Le filtre `singleCompetitor` reproduit le générateur : un inscrit unique
 * obtient l'or sans combattre, il n'occupe pas une minute de tatami et n'entre
 * donc pas dans la charge.
 */
export function toPlanningCategories(categories: readonly VirtualCategory[]): PlanningCategory[] {
  return categories
    .filter((c) => !c.singleCompetitor)
    .map((c) => ({
      id: c.key,
      discipline: c.discipline,
      belt: c.belt,
      ageGroup: c.ageGroup,
      weightClass: c.weightClass,
      fightTimeSeconds: c.fightTimeSeconds,
      realFightCount: c.realFightCount,
    }));
}

/** Les catégories telles que le CALCULATEUR D'HORAIRES les reçoit. */
export function toSchedulableCategories(
  categories: readonly VirtualCategory[],
): Map<string, SchedulableCategory> {
  const out = new Map<string, SchedulableCategory>();
  for (const c of categories) {
    if (c.singleCompetitor) continue;
    out.set(c.key, {
      id: c.key,
      fightTimeSeconds: c.fightTimeSeconds,
      fights: [...c.fights],
      format: c.appliedFormat,
    });
  }
  return out;
}

/** Un nombre de tapis, et ce que le planning RÉEL en fait. */
export type TatamiCandidate = {
  readonly tatamiCount: number;
  /** Fin du tapis le plus tardif (epoch ms). */
  readonly endsAtMs: number;
  /** Charge du tapis le plus long, en secondes. */
  readonly longestTatamiSeconds: number;
  /** Secondes au-delà de l'heure de fin. 0 = la journée tient. */
  readonly overrunSeconds: number;
  readonly fits: boolean;
};

export type TatamiRecommendationOptions = {
  readonly dayStartMs: number;
  /**
   * `dayEndMs <= dayStartMs` vaut « FIN INCONNUE », même convention que
   * `PlanningDay` : les colonnes d'heure de fin sont nullables en base. Une
   * journée sans fin connue est SANS BORNE, donc un seul tapis suffit — on ne
   * devine pas une heure de fin pour recommander du matériel.
   */
  readonly dayEndMs: number;
  readonly bufferSeconds?: number;
  /**
   * Défaut 99 : la borne de `competitions_tatami_count_check`, elle-même dictée
   * par l'encodage de l'identifiant d'aire du jour J
   * (`fight_area = competition × 100 + sort_order`).
   */
  readonly maxTatamiCount?: number;
  /** Le `tatami_count` déclaré, évalué en plus pour être comparé au minimum. */
  readonly declaredTatamiCount?: number;
};

export const MAX_TATAMI_COUNT = 99;

/**
 * Le planning RÉEL pour un nombre de tapis donné : `planCategories` puis
 * `computeTatamiSchedule`, les deux mêmes fonctions que la génération.
 */
export function evaluateTatamiCount(
  categories: readonly VirtualCategory[],
  tatamiCount: number,
  opts: TatamiRecommendationOptions,
): TatamiCandidate {
  const bufferSeconds = opts.bufferSeconds;
  const plans = planCategories(toPlanningCategories(categories), {
    tatamiCount,
    ...(bufferSeconds === undefined ? {} : { bufferSeconds }),
  });
  const schedulables = toSchedulableCategories(categories);

  let endsAtMs = opts.dayStartMs;
  for (const plan of plans) {
    const ordonnees = plan.categoryIds.flatMap((id) => {
      const cat = schedulables.get(id);
      return cat ? [cat] : [];
    });
    const schedule = computeTatamiSchedule(ordonnees, opts.dayStartMs, bufferSeconds);
    if (schedule.endsAt > endsAtMs) endsAtMs = schedule.endsAt;
  }

  const finInconnue = opts.dayEndMs <= opts.dayStartMs;
  const overrunMs = finInconnue ? 0 : Math.max(0, endsAtMs - opts.dayEndMs);
  return {
    tatamiCount,
    endsAtMs,
    longestTatamiSeconds: (endsAtMs - opts.dayStartMs) / 1000,
    overrunSeconds: overrunMs / 1000,
    fits: finInconnue || endsAtMs <= opts.dayEndMs,
  };
}

export type TatamiRecommendation = {
  /** Le plus PETIT nombre de tapis qui tient dans la journée. `null` = aucun. */
  readonly recommended: number | null;
  /** Les candidats évalués, de 1 jusqu'au premier qui tient. */
  readonly candidates: readonly TatamiCandidate[];
  /** Le `tatami_count` déclaré, évalué par le MÊME planning. */
  readonly declared?: TatamiCandidate;
};

/**
 * LE NOMBRE DE TAPIS RECOMMANDÉ.
 *
 * On monte de 1 jusqu'au premier candidat qui tient dans la journée, en
 * EXÉCUTANT le planning à chaque pas. Aucune formule fermée n'est écrite ici,
 * et c'est le fond de la fonction : une estimation parallèle (« charge totale
 * divisée par la durée de journée, arrondie au-dessus ») donnerait un nombre
 * plausible et faux, parce qu'elle ignorerait le LPT, l'ordre intra-tapis et
 * l'indivisibilité d'une catégorie. Elle serait par ailleurs libre de dériver
 * du planning au premier changement de l'un ou de l'autre.
 *
 * `recommended: null` = même `maxTatamiCount` tapis ne suffisent pas. C'est une
 * réponse, et elle vaut mieux qu'un nombre qu'on ne peut pas installer.
 */
export function recommendTatamiCount(
  categories: readonly VirtualCategory[],
  opts: TatamiRecommendationOptions,
): TatamiRecommendation {
  const max = Math.max(1, Math.floor(opts.maxTatamiCount ?? MAX_TATAMI_COUNT));
  const candidates: TatamiCandidate[] = [];
  let recommended: number | null = null;

  for (let t = 1; t <= max; t++) {
    const candidate = evaluateTatamiCount(categories, t, opts);
    candidates.push(candidate);
    if (candidate.fits) {
      recommended = t;
      break;
    }
  }

  const declaredCount = opts.declaredTatamiCount;
  const declared =
    declaredCount === undefined
      ? undefined
      : (candidates.find((c) => c.tatamiCount === declaredCount) ??
        evaluateTatamiCount(categories, Math.max(1, Math.floor(declaredCount)), opts));

  return { recommended, candidates, ...(declared ? { declared } : {}) };
}

// ===================================================================
// LE PANNEAU
// ===================================================================

export type SizingPanel = {
  readonly projection: CategoryProjection;
  /** Catégories projetées, inscrits uniques compris. */
  readonly categoryCount: number;
  /** Combattants réellement placés : le numérateur, et rien d'autre. */
  readonly competitorCount: number;
  /** Catégories à un seul inscrit : or automatique, aucun combat. */
  readonly singleCompetitorCount: number;
  /** Combats réels, byes exclus. */
  readonly fightCount: number;
  /** Charge cumulée de tous les tapis, en secondes. */
  readonly totalFightSeconds: number;
  /** Les médailles à commander, calculées AVANT toute génération. */
  readonly medals: MedalNeed;
  readonly recommendation: TatamiRecommendation;
};

export type SizingPanelOptions = ProjectionOptions & TatamiRecommendationOptions;

/**
 * LE PANNEAU COMPLET, depuis les inscriptions brutes.
 *
 * Les médailles passent par `computeMedalNeed` en lui donnant le format
 * RÉELLEMENT appliqué de chaque catégorie : une poule repliée en élimination
 * directe distribue ses médailles comme une élimination directe, et un bronze
 * de trop se commande des semaines à l'avance.
 */
export function buildSizingPanel(
  rows: readonly SizingRegistration[],
  opts: SizingPanelOptions,
): SizingPanel {
  const projection = projectCategories(rows, opts);
  const { categories } = projection;

  const bufferSeconds = opts.bufferSeconds ?? 60;
  let competitorCount = 0;
  let singleCompetitorCount = 0;
  let fightCount = 0;
  let totalFightSeconds = 0;
  for (const c of categories) {
    competitorCount += c.competitorCount;
    if (c.singleCompetitor) singleCompetitorCount++;
    else {
      fightCount += c.realFightCount;
      totalFightSeconds += c.realFightCount * (c.fightTimeSeconds + bufferSeconds);
    }
  }

  const medals = computeMedalNeed(
    categories.map((c) => ({
      competitorCount: c.competitorCount,
      singleCompetitor: c.singleCompetitor,
      format: c.appliedFormat,
    })),
    { thirdPlaceMode: opts.thirdPlaceMode },
  );

  return {
    projection,
    categoryCount: categories.length,
    competitorCount,
    singleCompetitorCount,
    fightCount,
    totalFightSeconds,
    medals,
    recommendation: recommendTatamiCount(categories, opts),
  };
}

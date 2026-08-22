/**
 * LE POINT D'ENTRÉE UNIQUE du tirage d'une catégorie : arbre ou poule.
 *
 * POURQUOI UN DISPATCHEUR, ET PAS UN `if` CHEZ L'APPELANT. Le format n'est pas
 * qu'un aiguillage : c'est LA donnée dont dépendent le nombre de médailles à
 * commander, l'ordre de passage sur le tatami et le droit de permuter deux
 * têtes de série. Un `if` recopié chez chaque appelant, c'est trois copies qui
 * divergent — et la divergence est muette : personne ne voit qu'une catégorie
 * a été tirée en poule et comptée en médailles comme une élimination.
 *
 * Ici, un seul endroit décide, et il rend le format RÉELLEMENT APPLIQUÉ. Les
 * modules en aval (`medals.ts`, `planning-generator.ts`) prennent ce format en
 * paramètre plutôt que de le redéduire.
 *
 * LE REPLI EST RAPPORTÉ, JAMAIS SILENCIEUX. Une poule au-delà du plafond
 * bascule en élimination directe, et le dit. Les deux alternatives ont été
 * écartées :
 *
 * - refuser toute la génération bloquerait la compétition entière pour une
 *   catégorie trop grosse, le matin du jour J ;
 * - replier en silence ferait commander le mauvais nombre de médailles, et le
 *   podium ne se rattrape pas.
 *
 * Module pur : aucune IO, aucune dépendance.
 */

import { generateBracket, type BracketEntry, type BracketResult } from "./bracket-generator";
import type { DrawFormat } from "./competition-format";
import type { ThirdPlaceMode } from "./enums";
import {
  generatePool,
  MAX_POOL_SIZE_DEFAULT,
  poolFightCount,
  type PoolResult,
} from "./pool-generator";
import type { SeedingPlan } from "./seeding-plan";

/**
 * Le repli, avec de quoi le comprendre SANS relire le code : ce qui a été
 * demandé, ce qui a été fait, et les deux volumes qui justifient la bascule.
 */
export type DrawFallback = {
  readonly code: "pool-too-large";
  readonly requestedFormat: "pools";
  readonly appliedFormat: "single_elim";
  readonly competitorCount: number;
  readonly maxPoolSize: number;
  /** C(n,2) : ce que la poule aurait coûté. */
  readonly poolFightCount: number;
  /** n−1 : ce que l'arbre coûte à la place, byes exclus. */
  readonly bracketFightCount: number;
};

export type CategoryDraw =
  | {
      readonly appliedFormat: "single_elim";
      readonly requestedFormat: DrawFormat;
      /** Présent ⟺ le format demandé n'a pas pu être appliqué. */
      readonly fallback?: DrawFallback;
      readonly bracket: BracketResult;
    }
  | {
      readonly appliedFormat: "pools";
      readonly requestedFormat: "pools";
      readonly pool: PoolResult;
    };

export type CategoryDrawOptions = {
  readonly format: DrawFormat;
  readonly thirdPlaceMode: ThirdPlaceMode;
  /** Défaut : `MAX_POOL_SIZE_DEFAULT` (6). */
  readonly maxPoolSize?: number;
  readonly seedingPlan?: SeedingPlan;
};

/**
 * La DÉCISION de format, isolée pour être testable seule et lisible en revue.
 *
 * Une poule d'un seul inscrit n'est pas un repli : il n'y a pas de tirage du
 * tout, et `generatePool` rend `single`, comme `generateBracket`. Le plafond
 * ne s'applique donc qu'à partir de deux.
 */
export function resolveDrawFormat(
  requested: DrawFormat,
  competitorCount: number,
  maxPoolSize: number = MAX_POOL_SIZE_DEFAULT,
): { applied: DrawFormat; fallback?: DrawFallback } {
  if (requested !== "pools") return { applied: "single_elim" };
  if (competitorCount <= maxPoolSize) return { applied: "pools" };
  return {
    applied: "single_elim",
    fallback: {
      code: "pool-too-large",
      requestedFormat: "pools",
      appliedFormat: "single_elim",
      competitorCount,
      maxPoolSize,
      poolFightCount: poolFightCount(competitorCount),
      bracketFightCount: competitorCount - 1,
    },
  };
}

/** Le tirage d'une catégorie, dans le format qui s'y applique réellement. */
export function generateCategoryDraw(
  entries: BracketEntry[],
  seed: string,
  opts: CategoryDrawOptions,
): CategoryDraw {
  const maxPoolSize = opts.maxPoolSize ?? MAX_POOL_SIZE_DEFAULT;
  const decision = resolveDrawFormat(opts.format, entries.length, maxPoolSize);

  if (decision.applied === "pools") {
    return {
      appliedFormat: "pools",
      requestedFormat: "pools",
      pool: generatePool(entries, seed, { maxSize: maxPoolSize }),
    };
  }

  const bracket = generateBracket(entries, seed, {
    thirdPlaceMode: opts.thirdPlaceMode,
    ...(opts.seedingPlan ? { seedingPlan: opts.seedingPlan } : {}),
  });

  return {
    appliedFormat: "single_elim",
    requestedFormat: opts.format,
    // Clé ABSENTE quand il n'y a rien à dire : une élimination demandée et
    // obtenue ne doit pas porter un champ que l'appelant lirait comme un repli.
    ...(decision.fallback ? { fallback: decision.fallback } : {}),
    bracket,
  };
}

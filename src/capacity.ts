/**
 * LA CAPACITÉ D'UNE COMPÉTITION, ET SON TAUX DE REMPLISSAGE.
 *
 * ┌─ CE QUI N'EXISTAIT PAS ───────────────────────────────────────────────────┐
 * │ `competitions` n'a AUCUNE notion de capacité. Elle porte `tatami_count`    │
 * │ (un entier 1..99, déclaré par l'organisateur), `start_time`, `end_time` —  │
 * │ et rien qui dise combien de gens tiennent dans la journée. La fédération   │
 * │ ouvre donc les inscriptions sans savoir où est le plafond, et le découvre  │
 * │ le jour J, sur le tatami.                                                  │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * LA CAPACITÉ EST CALCULÉE, JAMAIS SAISIE. Une capacité saisie est un chiffre
 * que personne ne recalcule quand la compétition change ; elle vieillit en
 * silence et reste affichée. Ici elle se dérive :
 *
 *     combats     = tatamis × heures exploitables ÷ (durée moyenne + espacement)
 *     combattants = combats ÷ ratio combats-par-combattant
 *
 * LE RATIO DÉPEND DU FORMAT, ET LE FORMAT PÈSE PLUS QUE L'EFFECTIF. Une poule
 * de quatre produit SIX combats pour quatre combattants (1,5 chacun) ; une
 * élimination directe en produit TROIS (0,75 chacun), quatre si le mode de 3e
 * place programme un combat. Basculer une tranche d'âge en poule DIVISE donc la
 * capacité par deux au moins, à tatamis constants. C'est voulu, et c'est
 * précisément ce qui doit être visible : `explainCapacity` rend les termes du
 * calcul un par un pour que l'écran puisse les montrer, plutôt qu'un nombre
 * tombé du ciel.
 *
 * Module pur : aucune IO, aucune dépendance.
 */

import { resolveDrawFormat, type DrawFallback } from "./category-draw";
import type { DrawFormat } from "./competition-format";
import type { ThirdPlaceMode } from "./enums";
import { MAX_POOL_SIZE_DEFAULT, poolFightCount } from "./pool-generator";

// ===================================================================
// LE NUMÉRATEUR, ET LES DEUX POPULATIONS QU'IL NE FAUT PAS CONFONDRE
// ===================================================================

/**
 * Les six valeurs de l'enum Postgres `registration_status`.
 *
 * Déclaré ICI et non dans `enums.ts`, comme `BracketModeDb` l'est dans
 * `competition-format.ts` et pour la même raison : ce vocabulaire ne se lit
 * JAMAIS seul. Il n'a de sens qu'accompagné des deux partitions ci-dessous,
 * qui décident ce qu'on en retient. Un type de vocabulaire séparé de ses
 * partitions invite à refiltrer les statuts à la main chez l'appelant,
 * c'est-à-dire à recréer exactement la confusion que ce module existe pour
 * empêcher.
 *
 * Source : `Database["public"]["Enums"]["registration_status"]`, relevé le
 * 21/08/2026 sur `cfjjb-platform`.
 */
export type RegistrationStatusDb =
  "pre_registered" | "registered" | "validated" | "paid" | "withdrawn" | "no_show";

/** L'enum complet, dans l'ordre du cycle de vie. */
export const REGISTRATION_STATUSES = [
  "pre_registered",
  "registered",
  "validated",
  "paid",
  "withdrawn",
  "no_show",
] as const satisfies readonly RegistrationStatusDb[];

/**
 * LES TROIS STATUTS QUE LE GÉNÉRATEUR PLACE, et le numérateur du taux.
 *
 * Miroir EXACT de `isActiveBracketStatus` (`cfjjb-platform`,
 * `lib/competitions/bracket-registrations.ts`) : `validated` (cycle CYL-110),
 * `registered` (legacy) et `paid`. Le paiement ne conditionne pas le tirage
 * (CYL-75).
 *
 * ⚠ LE PIÈGE, ET IL EST MESURÉ. La plateforme expose déjà un compteur
 * d'inscrits, `competition_registration_counts.total`, et il est TENTANT de
 * s'en servir comme numérateur : il est en base, il est exact, il est déjà lu
 * par /admin/competitions. Sa définition est
 * `count(*) filter (where status <> 'withdrawn')` — donc « tout sauf retiré »,
 * ce qui INCLUT les pré-inscrits ET les absents déclarés.
 *
 * Or le taux de remplissage répond à « à quel point les tapis sont-ils
 * remplis », et les tapis sont remplis par les combattants que le GÉNÉRATEUR
 * placera. Un pré-inscrit n'a pas validé son inscription : il n'entre dans
 * aucun tableau, il n'occupe aucune minute de tatami. Le compter, c'est
 * double-compter le pipeline commercial dans une mesure d'occupation
 * physique — et la fédération commande ses médailles sur ces nombres.
 *
 * Les pré-inscrits s'affichent SÉPARÉMENT (`FillBreakdown.preRegistered`).
 * `tests/capacity.test.ts` verrouille la NON-DÉRIVE des deux ensembles.
 */
export const ACTIVE_BRACKET_STATUSES = [
  "registered",
  "validated",
  "paid",
] as const satisfies readonly RegistrationStatusDb[];

/** Vrai ⟺ le générateur placera cette inscription dans un tableau. */
export function isActiveBracketStatus(status: string): boolean {
  return (ACTIVE_BRACKET_STATUSES as readonly string[]).includes(status);
}

/** Vrai ⟺ le statut appartient au vocabulaire de la colonne. */
export function isRegistrationStatus(status: string): status is RegistrationStatusDb {
  return (REGISTRATION_STATUSES as readonly string[]).includes(status);
}

/**
 * Vrai ⟺ la ligne entre dans le `total` de `competition_registration_counts`.
 *
 * Reproduit la définition SQL au caractère près : tout sauf `withdrawn`. Cette
 * fonction n'est PAS le numérateur du taux — elle existe pour que l'écart
 * entre les deux notions soit un objet nommé et testable, et non une
 * différence que personne ne relit.
 */
export function countsInRegistrationTotal(status: string): boolean {
  return isRegistrationStatus(status) && status !== "withdrawn";
}

/**
 * LES STATUTS COMPTÉS PAR LA PLATEFORME MAIS JAMAIS PLACÉS SUR UN TATAMI.
 *
 * C'est l'écart entre les deux ensembles, rendu comme une valeur. Le test de
 * non-dérive s'appuie dessus : élargir l'un des deux ensembles change cette
 * liste, et le test NOMME la valeur qui a bougé.
 */
export function statusesCountedButNotDrawn(): RegistrationStatusDb[] {
  return REGISTRATION_STATUSES.filter(
    (s) => countsInRegistrationTotal(s) && !isActiveBracketStatus(s),
  );
}

/**
 * La ventilation d'une population d'inscriptions par statut.
 *
 * `countedTotal` est rendu POUR ÊTRE AFFICHÉ à côté du taux, jamais pour
 * servir de numérateur : c'est le nombre que l'organisateur reconnaît (celui
 * de la colonne « Inscrits »), et le masquer ferait croire à une erreur.
 */
export type FillBreakdown = {
  /** LE NUMÉRATEUR : exactement `ACTIVE_BRACKET_STATUSES`. */
  readonly active: number;
  /** Affichés SÉPARÉMENT. Jamais additionnés au numérateur. */
  readonly preRegistered: number;
  /** Absents déclarés le jour J : comptés par la plateforme, jamais placés. */
  readonly noShow: number;
  readonly withdrawn: number;
  /** `competition_registration_counts.total` : tout sauf retiré. */
  readonly countedTotal: number;
  /** Statuts hors vocabulaire : comptés NULLE PART, jamais approximés. */
  readonly unknown: number;
};

/** Ventile une liste de statuts bruts. Une valeur inconnue n'est jamais rangée d'office. */
export function breakdownRegistrations(statuses: readonly string[]): FillBreakdown {
  let active = 0;
  let preRegistered = 0;
  let noShow = 0;
  let withdrawn = 0;
  let countedTotal = 0;
  let unknown = 0;

  for (const brut of statuses) {
    const status = brut.trim();
    if (!isRegistrationStatus(status)) {
      unknown++;
      continue;
    }
    if (countsInRegistrationTotal(status)) countedTotal++;
    if (isActiveBracketStatus(status)) active++;
    else if (status === "pre_registered") preRegistered++;
    else if (status === "no_show") noShow++;
    else withdrawn++;
  }

  return { active, preRegistered, noShow, withdrawn, countedTotal, unknown };
}

// ===================================================================
// LE RATIO COMBATS-PAR-COMBATTANT
// ===================================================================

/**
 * LE GABARIT de catégorie sur lequel la capacité se calcule.
 *
 * Ce n'est pas une catégorie réelle : c'est l'hypothèse de dimensionnement,
 * celle qu'on tient AVANT d'avoir un seul inscrit. `competitorsPerCategory`
 * est la taille typique d'une catégorie, et c'est elle qui, avec le format,
 * fixe le ratio.
 */
export type CategoryShape = {
  /** Taille TYPIQUE d'une catégorie. Sous 2, il n'y a aucun combat. */
  readonly competitorsPerCategory: number;
  readonly format: DrawFormat;
  /**
   * SANS OBJET en poule — la table classe tout le monde, il n'y a pas de combat
   * de 3e place. Défaut `pool3`, qui est le défaut de la colonne
   * `competitions.third_place_mode` et le plus coûteux des deux : sous-estimer
   * la capacité est l'erreur qu'on préfère.
   */
  readonly thirdPlaceMode?: ThirdPlaceMode;
  /** Défaut : `MAX_POOL_SIZE_DEFAULT` (6). */
  readonly maxPoolSize?: number;
};

/**
 * COMBIEN DE COMBATS COÛTE UN COMBATTANT, dans ce format et à cette taille.
 *
 * - poule de n : C(n,2) ÷ n = (n−1)/2 — 1,5 à quatre, 2,5 à six ;
 * - élimination de n : (n−1) combats, plus le combat de 3e place quand le mode
 *   est `pool3` et n ≥ 4, le tout ÷ n — 0,75 à quatre.
 *
 * LE PLAFOND DE POULE EST CONSULTÉ PAR `resolveDrawFormat`, jamais recopié :
 * une poule demandée au-delà de six se replie en élimination directe, et son
 * ratio doit se replier avec elle. Réimplémenter ce seuil ici ferait dériver
 * la capacité affichée du tirage réel — exactement la duplication que ce
 * paquet existe pour supprimer.
 *
 * ⚠ UN GABARIT FRACTIONNAIRE S'ARRONDIT AU-DESSUS. « 4,6 combattants par
 * catégorie en moyenne » est une entrée légitime, et il faut en faire un
 * entier : une catégorie contient des personnes. On prend le PLAFOND, parce
 * que les deux erreurs ne se valent pas — arrondir en dessous sous-estime le
 * coût par combattant, donc SURÉVALUE la capacité, donc remplit une salle
 * qu'on n'a pas. En poule, 4,6 arrondi à 4 rendrait 1,5 au lieu de 2,0, soit
 * un tiers de capacité annoncée en trop.
 */
export function fightsPerCompetitor(shape: CategoryShape): number {
  const n = Math.ceil(shape.competitorsPerCategory);
  if (!Number.isFinite(n) || n < 2) return 0;

  const maxPoolSize = shape.maxPoolSize ?? MAX_POOL_SIZE_DEFAULT;
  const { applied } = resolveDrawFormat(shape.format, n, maxPoolSize);

  if (applied === "pools") return poolFightCount(n) / n;

  const thirdPlace = (shape.thirdPlaceMode ?? "pool3") === "pool3" && n >= 4 ? 1 : 0;
  return (n - 1 + thirdPlace) / n;
}

// ===================================================================
// LA CAPACITÉ
// ===================================================================

/** Le tampon entre deux combats, aligné sur `computeTatamiSchedule`. */
export const DEFAULT_BUFFER_SECONDS = 60;

export type CapacityParams = {
  /** Le nombre de tapis PHYSIQUES. `competitions.tatami_count` en production. */
  readonly tatamiCount: number;
  /** Les heures EXPLOITABLES d'un tapis, en secondes (pauses déjà déduites). */
  readonly usableSecondsPerTatami: number;
  /** La durée MOYENNE d'un combat, en secondes. */
  readonly averageFightSeconds: number;
  /** L'espacement entre deux combats. Défaut 60 s. */
  readonly bufferSeconds?: number;
};

/**
 * COMBIEN DE COMBATS TIENNENT DANS LA JOURNÉE.
 *
 * Le plancher se prend PAR TAPIS, puis se multiplie — et non l'inverse. Une
 * catégorie se déroule sur UN seul tapis (`planCategories`), et la journée d'un
 * tapis est séquentielle (`computeTatamiSchedule`) : un demi-créneau restant
 * sur chacun de quatre tapis ne fait pas deux combats de plus, il ne fait
 * rien. Arrondir sur le total inventerait des combats qu'aucun tapis ne peut
 * accueillir.
 */
export function computeFightCapacity(params: CapacityParams): number {
  const tatamis = Math.floor(params.tatamiCount);
  const slotSeconds = params.averageFightSeconds + (params.bufferSeconds ?? DEFAULT_BUFFER_SECONDS);
  if (!Number.isFinite(tatamis) || tatamis < 1) return 0;
  if (!Number.isFinite(slotSeconds) || slotSeconds <= 0) return 0;
  if (!Number.isFinite(params.usableSecondsPerTatami) || params.usableSecondsPerTatami <= 0) {
    return 0;
  }
  return Math.floor(params.usableSecondsPerTatami / slotSeconds) * tatamis;
}

/**
 * COMBIEN DE COMBATTANTS TIENNENT DANS LA JOURNÉE.
 *
 * Un ratio nul (gabarit sous deux combattants : personne ne combat) rend une
 * capacité NULLE, et non infinie. « Aucun combat » ne veut pas dire « une
 * salle sans limite » : cela veut dire que le gabarit ne décrit aucune
 * compétition, donc qu'on ne sait pas répondre. Le taux vaudra `null`.
 */
export function computeCompetitorCapacity(params: CapacityParams, shape: CategoryShape): number {
  const ratio = fightsPerCompetitor(shape);
  if (ratio <= 0) return 0;
  return Math.floor(computeFightCapacity(params) / ratio);
}

/**
 * LE TAUX DE REMPLISSAGE, ou `null`.
 *
 * ⚠ `null` QUAND LA CAPACITÉ EST NULLE, JAMAIS `0`. Un zéro se lit comme un
 * fait mesuré — « la compétition est vide » — alors que l'information réelle
 * est « on ne sait pas ». À l'écran, `null` s'affiche « - ». La fédération
 * commande ses médailles sur ces nombres : un plafond inconnu ne doit jamais
 * ressembler à un plafond atteint, ni à une salle déserte.
 */
export function computeFillRate(
  activeCompetitors: number,
  competitorCapacity: number,
): number | null {
  if (!Number.isFinite(competitorCapacity) || competitorCapacity <= 0) return null;
  return activeCompetitors / competitorCapacity;
}

/**
 * LES TERMES DU CALCUL, UN PAR UN.
 *
 * La capacité doit BOUGER quand on change les tapis ou un format, et ce
 * mouvement doit être lisible : un nombre qui a chuté de moitié sans que rien
 * n'explique pourquoi sera pris pour un bug et contourné. Cette structure
 * existe pour que l'écran montre la chaîne complète, y compris le repli de
 * format quand le gabarit dépasse le plafond de poule.
 */
export type CapacityExplanation = {
  readonly tatamiCount: number;
  readonly usableSecondsPerTatami: number;
  /** Durée moyenne + espacement : ce qu'un combat consomme réellement. */
  readonly slotSeconds: number;
  readonly fightsPerTatami: number;
  readonly fightCapacity: number;
  readonly fightsPerCompetitor: number;
  readonly competitorCapacity: number;
  /** Le format demandé au gabarit. */
  readonly requestedFormat: DrawFormat;
  /** Le format RÉELLEMENT retenu pour le ratio. */
  readonly appliedFormat: DrawFormat;
  /** Présent ⟺ le gabarit dépasse le plafond de poule. */
  readonly fallback?: DrawFallback;
};

export function explainCapacity(params: CapacityParams, shape: CategoryShape): CapacityExplanation {
  const tatamiCount = Math.max(0, Math.floor(params.tatamiCount));
  const slotSeconds = params.averageFightSeconds + (params.bufferSeconds ?? DEFAULT_BUFFER_SECONDS);
  const fightCapacity = computeFightCapacity(params);
  const ratio = fightsPerCompetitor(shape);
  // Même arrondi que `fightsPerCompetitor` : le format expliqué doit être
  // celui qui a servi au ratio, sans quoi l'explication contredit le calcul.
  const n = Math.ceil(shape.competitorsPerCategory);
  const decision = resolveDrawFormat(
    shape.format,
    Number.isFinite(n) ? n : 0,
    shape.maxPoolSize ?? MAX_POOL_SIZE_DEFAULT,
  );

  return {
    tatamiCount,
    usableSecondsPerTatami: params.usableSecondsPerTatami,
    slotSeconds,
    fightsPerTatami: tatamiCount > 0 ? fightCapacity / tatamiCount : 0,
    fightCapacity,
    fightsPerCompetitor: ratio,
    competitorCapacity: computeCompetitorCapacity(params, shape),
    requestedFormat: shape.format,
    appliedFormat: decision.applied,
    ...(decision.fallback ? { fallback: decision.fallback } : {}),
  };
}

/**
 * LE TAUX DE REMPLISSAGE COMPLET : capacité, numérateur, et ce qui l'entoure.
 *
 * Le point d'entrée que doit appeler un écran. Il prend les STATUTS BRUTS et
 * ventile lui-même : c'est ce qui rend impossible de brancher par mégarde le
 * `total` de la base sur le numérateur.
 */
export type FillReport = CapacityExplanation & {
  readonly breakdown: FillBreakdown;
  /** `null` ⟺ capacité nulle. Jamais `0`. */
  readonly fillRate: number | null;
};

export function computeFillReport(input: {
  readonly statuses: readonly string[];
  readonly capacity: CapacityParams;
  readonly shape: CategoryShape;
}): FillReport {
  const explanation = explainCapacity(input.capacity, input.shape);
  const breakdown = breakdownRegistrations(input.statuses);
  return {
    ...explanation,
    breakdown,
    fillRate: computeFillRate(breakdown.active, explanation.competitorCapacity),
  };
}

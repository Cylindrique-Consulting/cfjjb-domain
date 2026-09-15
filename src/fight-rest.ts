import type { FightState, WinMethod } from "./bracket-propagation";

/**
 * LE REPOS D'UN ATHLÈTE ENTRE DEUX COMBATS — la règle pure, sans consommateur
 * dans cette version.
 *
 * Réponses du client du 15/09/2026 (T9.1, T9.3, TR1.1, DQ4.5) et IBJJF Rules
 * Book 6.1, GCG art. 1.4 :
 *
 *   · tout combat RÉELLEMENT DISPUTÉ ouvre un repos, compté depuis sa fin
 *     RÉELLE ;
 *   · le repos vaut UNE durée de combat avant un tour ordinaire, demi-finales
 *     comprises (la 2e demi-finale d'un tableau de trois aussi) ;
 *   · il vaut DEUX durées avant une finale (catégorie, absolut, tableau de
 *     trois), tous âges confondus ;
 *   · la durée de référence est celle de la catégorie du COMBAT À VENIR ;
 *   · un bye, une victoire ou une défaite par forfait n'ouvrent AUCUN repos :
 *     si la 2e demi-finale est gagnée par forfait, le repos avant la finale se
 *     compte depuis la fin de la 1re demi-finale.
 *
 * Une seule règle sert quatre usages à venir : le planning publié, les heures
 * estimées, l'alerte « Lancer quand même » et le placement du jour J. Ils sont
 * livrés par d'autres versions ; les écrire chacun de leur côté produirait
 * quatre définitions du repos qui divergeraient en silence.
 *
 * Décision interne notée : le combat pour la 3e place est un repos SIMPLE. Il
 * n'est pas une finale au sens de la règle (il ne désigne pas le champion).
 */

/**
 * Les méthodes de fin qui ne font PAS un combat disputé.
 *
 * La « désignation entre coéquipiers » (guide des points v1.2 §7.2) y entrera
 * avec le moteur de podium, qui crée cette méthode.
 */
export const METHODES_SANS_COMBAT: readonly WinMethod[] = ["bye", "wo", "double_wo"];

export type EntreeCombatDispute = {
  state: FightState;
  winMethod: WinMethod | null;
  /**
   * Le chrono a-t-il été lancé ? Fourni par l'appelant depuis
   * `competition_fight_events` (kind `start`), et non depuis `started_at` :
   * une correction remet `started_at` à NULL, et la cascade de forfait pose
   * `started_at` sur des W.O.
   */
  chronoLance: boolean;
};

/**
 * « A disputé un combat » (T2.1, T9.1) : le chrono a été lancé, ou le combat
 * est terminé par une méthode autre qu'un bye ou un forfait.
 *
 * Un combat lancé puis soldé par forfait RESTE disputé : l'athlète est monté
 * sur le tapis.
 */
export function aDisputeLeCombat({ state, winMethod, chronoLance }: EntreeCombatDispute): boolean {
  if (chronoLance) return true;
  if (state !== "finished" || winMethod === null) return false;
  return !METHODES_SANS_COMBAT.includes(winMethod);
}

/**
 * Le nombre de durées de combat de repos exigé AVANT ce combat : 2 pour une
 * finale (division 1 d'un tableau, catégorie ou absolut), 1 pour tout autre
 * tour, 2e demi-finale et combat pour la 3e place compris.
 */
export function multiplicateurDeRepos({
  division,
  type,
}: {
  division: number;
  type?: string | null;
}): 1 | 2 {
  const combatOrdinaire = type === undefined || type === null || type === "BraketFight";
  return division === 1 && combatOrdinaire ? 2 : 1;
}

export type CombatAVenir = {
  id: string;
  division: number;
  type?: string | null;
  /** La durée de combat de la catégorie du combat à venir, en secondes. */
  dureeSecondes: number;
};

/**
 * La fin du repos ouvert par un combat disputé terminé à `finReelleMs`, avant
 * le combat à venir : fin réelle + k × durée du combat à venir.
 */
export function finDeRepos(finReelleMs: number, combatAVenir: CombatAVenir): number {
  return finReelleMs + multiplicateurDeRepos(combatAVenir) * combatAVenir.dureeSecondes * 1000;
}

export type CombatPasse = EntreeCombatDispute & {
  id: string;
  /** Fin réelle du combat (epoch ms) ; `null` tant qu'il n'est pas terminé. */
  finReelleMs: number | null;
};

/**
 * La fin du repos d'un athlète avant `combatAVenir`, d'après ses combats.
 *
 * Seul le DERNIER combat disputé et terminé compte. Le combat à venir lui-même
 * est exclu (même identifiant), pour qu'un appelant puisse passer la liste
 * entière des combats de l'athlète. `null` : aucun repos à respecter.
 */
export function finDeReposDeLAthlete(
  combats: readonly CombatPasse[],
  combatAVenir: CombatAVenir,
): number | null {
  let derniereFin: number | null = null;
  for (const c of combats) {
    if (c.id === combatAVenir.id) continue;
    if (c.finReelleMs === null) continue;
    if (!aDisputeLeCombat(c)) continue;
    if (derniereFin === null || c.finReelleMs > derniereFin) derniereFin = c.finReelleMs;
  }
  return derniereFin === null ? null : finDeRepos(derniereFin, combatAVenir);
}

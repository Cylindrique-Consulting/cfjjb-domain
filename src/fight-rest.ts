import type { FightState, WinMethod } from "./bracket-propagation";

export const METHODES_SANS_COMBAT: readonly WinMethod[] = ["bye", "wo", "double_wo", "designation"];

/**
 * L'ATTENTE MAXIMALE D'UN ATHLÈTE ENTRE DEUX COMBATS DE SON TABLEAU : 30 minutes
 * (retour du client du 28/09/2026, « presque 3 h entre le premier combat et le
 * deuxième »).
 *
 * Elle se compte de la FIN d'un combat au DÉBUT du suivant, et seulement À
 * L'INTÉRIEUR D'UN MÊME TABLEAU : deux catégories d'un même athlète (sa classe
 * de poids et l'absolut, le Gi et le No-Gi) ne se contraignent pas l'une
 * l'autre, leurs combats n'étant pas liés. C'est un PLAFOND, pas une cible : le
 * repos minimum reste `multiplicateurDeRepos`, une durée de combat hors finale
 * et deux avant elle.
 *
 * L'ordonnanceur la tient en PRIORITÉ, jamais en garantie : un tapis ne reste
 * pas vide pour la respecter (§18, objectif 2). Ce qu'il ne tient pas,
 * `controlerLePlanning` le SIGNALE (`attente_excessive`), sans bloquer la
 * publication : décision du client du 28/09/2026, « signaler plutôt que
 * retarder ».
 */
export const ATTENTE_MAXIMALE_PAR_DEFAUT_SECONDES = 30 * 60;

export type EntreeCombatDispute = {
  state: FightState;
  winMethod: WinMethod | null;
  chronoLance: boolean;
};

export function aDisputeLeCombat({ state, winMethod, chronoLance }: EntreeCombatDispute): boolean {
  if (chronoLance) return true;
  if (state !== "finished" || winMethod === null) return false;
  return !METHODES_SANS_COMBAT.includes(winMethod);
}

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
  dureeSecondes: number;
};

export function finDeRepos(finReelleMs: number, combatAVenir: CombatAVenir): number {
  return finReelleMs + multiplicateurDeRepos(combatAVenir) * combatAVenir.dureeSecondes * 1000;
}

export type CombatPasse = EntreeCombatDispute & {
  id: string;
  finReelleMs: number | null;
};

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

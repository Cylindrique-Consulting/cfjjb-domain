import type { FightState, WinMethod } from "./bracket-propagation";

export const METHODES_SANS_COMBAT: readonly WinMethod[] = ["bye", "wo", "double_wo", "designation"];

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

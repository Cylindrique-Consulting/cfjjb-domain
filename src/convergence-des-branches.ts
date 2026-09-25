import type { BracketFightType } from "./bracket-generator";
import { estNombreDeTatamisAdmis, partiesDuCombat } from "./repartition-tatamis";

/**
 * LA CONVERGENCE DES BRANCHES D'UNE CATÉGORIE RÉPARTIE (réponses du client du
 * 25/09/2026, REP.5 C et REP.6 A).
 *
 * La convergence progressive (PL1.4 C) reste la règle : chaque combat qui
 * réunit plusieurs parties se joue sur l'un de leurs tatamis. Ce module donne
 * au générateur deux retouches qu'il ne garde que si elles ne retardent pas la
 * fin de la journée (c'est à l'appelant de le mesurer) :
 *
 *   · REP.5 C, `regrouperLesDerniersTours` : les derniers tours de
 *     regroupement avant la finale passent sur le tatami de la finale, pour
 *     qu'un athlète ne passe plus par un troisième tatami (§12) ;
 *   · REP.6 A, `debutsPourRapprocherLesBranches` : une branche qui finirait
 *     bien avant les autres commence plus tard (§9, « légèrement décalées afin
 *     que leur convergence arrive au même moment »), son tatami faisant passer
 *     d'autres catégories en attendant.
 */

export type CombatDeBranche = {
  id: string;
  division: number;
  indexInDivision: number;
  type: BracketFightType;
  isBye?: boolean;
};

export type HoraireDeBranche = {
  debutMs: number;
  finMs: number;
};

export type BrancheDuPlan = {
  /** Indice de la partie (0 = premier tatami de la répartition). */
  partie: number;
  /** Début du premier et fin du dernier combat joué dans la partie seule. */
  debutMs: number;
  finMs: number;
  combats: number;
};

function combatsJoues<T extends CombatDeBranche>(combats: readonly T[]): T[] {
  return combats.filter((combat) => combat.isBye !== true);
}

function estRegroupement(combat: CombatDeBranche, parties: number): boolean {
  return (
    combat.type === "BraketFight" &&
    combat.division >= 2 &&
    partiesDuCombat(combat, parties).convergence
  );
}

/**
 * Le nombre de tours de regroupement avant la finale : ceux dont au moins un
 * combat réunit plusieurs parties. 0 à une ou deux parties (seule la finale y
 * réunit les branches), 1 à trois ou quatre parties (les demi-finales), jusqu'à
 * 2 à huit parties (quarts et demi-finales).
 */
export function toursDeRegroupement(combats: readonly CombatDeBranche[], parties: number): number {
  if (parties <= 1 || !estNombreDeTatamisAdmis(parties)) return 0;
  const divisions = new Set<number>();
  for (const combat of combatsJoues(combats)) {
    if (estRegroupement(combat, parties)) divisions.add(combat.division);
  }
  return divisions.size;
}

/**
 * REP.5 C : les combats de regroupement des `tours` derniers tours avant la
 * finale (1 = les demi-finales, 2 = les quarts aussi…) passent sur le tatami
 * de la finale ; tous les autres combats gardent leur tatami. Sans finale
 * placée, ou à `tours` nul, le plan est rendu tel quel.
 */
export function regrouperLesDerniersTours(
  combats: readonly CombatDeBranche[],
  parties: number,
  tatamiDuCombat: ReadonlyMap<string, string>,
  tours: number,
): Map<string, string> {
  const regroupe = new Map(tatamiDuCombat);
  if (tours <= 0 || parties <= 1 || !estNombreDeTatamisAdmis(parties)) return regroupe;
  const joues = combatsJoues(combats);
  const finale = joues.find((combat) => combat.type === "BraketFight" && combat.division === 1);
  const tatamiDeLaFinale = finale === undefined ? undefined : tatamiDuCombat.get(finale.id);
  if (tatamiDeLaFinale === undefined) return regroupe;
  const divisions = [
    ...new Set(joues.filter((c) => estRegroupement(c, parties)).map((c) => c.division)),
  ].sort((a, b) => a - b);
  const regroupees = new Set(divisions.slice(0, tours));
  for (const combat of joues) {
    if (!regroupees.has(combat.division) || !estRegroupement(combat, parties)) continue;
    if (tatamiDuCombat.has(combat.id)) regroupe.set(combat.id, tatamiDeLaFinale);
  }
  return regroupe;
}

/**
 * Les branches d'une catégorie répartie, lues sur un plan : pour chaque partie,
 * le début de son premier et la fin de son dernier combat joué dans la partie
 * seule (hors regroupements). Une partie sans combat placé n'a pas de branche.
 */
export function branchesDuPlan(
  combats: readonly CombatDeBranche[],
  parties: number,
  horaires: ReadonlyMap<string, HoraireDeBranche>,
): BrancheDuPlan[] {
  if (parties <= 1 || !estNombreDeTatamisAdmis(parties)) return [];
  const branches = new Map<number, BrancheDuPlan>();
  for (const combat of combatsJoues(combats)) {
    const horaire = horaires.get(combat.id);
    if (horaire === undefined) continue;
    const decoupe = partiesDuCombat(combat, parties);
    if (decoupe.convergence) continue;
    const branche = branches.get(decoupe.partie);
    if (branche === undefined) {
      branches.set(decoupe.partie, {
        partie: decoupe.partie,
        debutMs: horaire.debutMs,
        finMs: horaire.finMs,
        combats: 1,
      });
    } else {
      branche.debutMs = Math.min(branche.debutMs, horaire.debutMs);
      branche.finMs = Math.max(branche.finMs, horaire.finMs);
      branche.combats += 1;
    }
  }
  return [...branches.values()].sort((a, b) => a.partie - b.partie);
}

/** L'écart entre la fin de la première et de la dernière branche, 0 sous deux branches. */
export function ecartDesBranchesMs(branches: readonly BrancheDuPlan[]): number {
  if (branches.length < 2) return 0;
  const fins = branches.map((branche) => branche.finMs);
  return Math.max(...fins) - Math.min(...fins);
}

/**
 * REP.6 A : le début au plus tôt proposé pour chaque branche qui finit au
 * moins `margeMs` avant la plus tardive, par indice de partie. La branche
 * commence plus tard de `fraction` de son avance (1 : elle vise la fin de la
 * plus tardive). La plus tardive, et les branches qui finissent avec elle, ne
 * bougent pas. Aucune proposition sous deux branches.
 */
export function debutsPourRapprocherLesBranches(
  branches: readonly BrancheDuPlan[],
  options: { fraction?: number; margeMs?: number } = {},
): Map<number, number> {
  const debuts = new Map<number, number>();
  if (branches.length < 2) return debuts;
  const fraction = Math.min(1, Math.max(0, options.fraction ?? 1));
  const marge = Math.max(0, options.margeMs ?? 0);
  const finLaPlusTardive = Math.max(...branches.map((branche) => branche.finMs));
  for (const branche of branches) {
    const avance = finLaPlusTardive - branche.finMs;
    if (avance <= 0 || avance < marge) continue;
    const decalage = Math.floor(avance * fraction);
    if (decalage <= 0) continue;
    debuts.set(branche.partie, branche.debutMs + decalage);
  }
  return debuts;
}

import type { BracketFightType } from "./bracket-generator";
import {
  verdictDePublication,
  type Constat,
  type VerdictDePublication,
} from "./controles-de-planning";
import { estNombreDeTatamisAdmis, partiesDuCombat } from "./repartition-tatamis";

/**
 * LA CONTINUITÉ DES TATAMIS (§12 de la spécification du client du 24/09/2026 ;
 * REP.5 C, réponse du 25/09/2026).
 *
 * « Une branche de tableau doit rester autant que possible sur le même
 * tatami » (§12.1) et « un déplacement vers un troisième tatami doit rester
 * exceptionnel » (§12.5). Le générateur les tient par construction : chaque
 * combat se joue sur le tatami de sa partie, et un combat qui réunit des
 * parties sur l'un de leurs tatamis. Une retouche manuelle peut les défaire ;
 * deux avertissements le disent, sans rien bloquer : comme les autres
 * avertissements, ils se confirment avant la validation.
 *
 *   · `combat_hors_de_sa_branche` : un combat se joue hors des tatamis de sa
 *     branche. Sa branche, c'est le tatami de sa partie, ou celui de la
 *     catégorie quand elle n'est pas répartie. Un combat qui réunit plusieurs
 *     parties reste dans sa branche sur l'un des tatamis de ces parties, ou
 *     sur celui de la finale, où REP.5 C regroupe les derniers tours ;
 *   · `finale_loin_des_demi_finales` : dans une catégorie répartie, la finale
 *     se joue sur un tatami où aucune de ses demi-finales jouées ne s'est
 *     jouée : ses deux finalistes changent de tatami pour elle. Une finale
 *     déjà hors de sa branche n'est signalée qu'une fois.
 *
 * Fonction pure : les combats placés et les tatamis des parties de chaque
 * catégorie en entrée, les constats en sortie, dans l'ordre des combats. Leur
 * clé suit celle des autres constats (`construireConstat`), tatami compris :
 * déplacer le combat de nouveau demande une nouvelle confirmation.
 */

export type TypeDeConstatDeContinuite =
  "combat_hors_de_sa_branche" | "finale_loin_des_demi_finales";

export type ConstatDeContinuite = {
  type: TypeDeConstatDeContinuite;
  gravite: "avertissement";
  cle: string;
  combatId: string;
  categorieId: string;
  competitionId?: string;
  /** Le tatami où le combat se joue. */
  tatamiId: string;
  jour: number;
  /**
   * Les tatamis où il resterait dans la continuité : ceux de sa branche, ou,
   * pour une finale loin de ses demi-finales, ceux de ses demi-finales.
   */
  tatamisAttendus: string[];
};

export type CombatDeContinuite = {
  fightId: string;
  categorieId: string;
  competitionId?: string;
  tatamiId: string;
  jour: number;
  division: number;
  indexInDivision: number;
  type: BracketFightType;
  /** Ses combats sources joués (un exempt n'en est pas un), comme pour `CombatControle`. */
  sources?: readonly (string | null)[];
};

export type CategorieDeContinuite = {
  id: string;
  /**
   * Les tatamis des parties, dans l'ordre des parties (la partie k se joue sur
   * le k-ième) : un seul pour une catégorie qui n'est pas répartie.
   */
  tatamisDesParties: readonly string[];
};

export type EntreeDeContinuite = {
  combats: readonly CombatDeContinuite[];
  categories: readonly CategorieDeContinuite[];
};

function estLaFinale(combat: Pick<CombatDeContinuite, "type" | "division">): boolean {
  return combat.type === "BraketFight" && combat.division === 1;
}

function cleDeContinuite(
  type: TypeDeConstatDeContinuite,
  combat: Pick<CombatDeContinuite, "fightId" | "competitionId" | "tatamiId" | "jour">,
): string {
  return [
    type,
    combat.competitionId ?? "",
    combat.fightId,
    "",
    "",
    combat.tatamiId,
    String(combat.jour),
  ].join("|");
}

function constat(
  type: TypeDeConstatDeContinuite,
  combat: CombatDeContinuite,
  tatamisAttendus: readonly string[],
): ConstatDeContinuite {
  return {
    type,
    gravite: "avertissement",
    cle: cleDeContinuite(type, combat),
    combatId: combat.fightId,
    categorieId: combat.categorieId,
    ...(combat.competitionId === undefined ? {} : { competitionId: combat.competitionId }),
    tatamiId: combat.tatamiId,
    jour: combat.jour,
    tatamisAttendus: [...new Set(tatamisAttendus)],
  };
}

/**
 * Les tatamis de la branche d'un combat, ou `null` quand la catégorie n'a pas
 * de répartition lisible (aucun tatami, ou un nombre de parties non admis).
 */
function tatamisDeLaBranche(
  combat: CombatDeContinuite,
  parties: readonly string[],
  tatamiDeLaFinale: string | undefined,
): string[] | null {
  if (parties.length === 0 || !estNombreDeTatamisAdmis(parties.length)) return null;
  if (parties.length === 1) return [parties[0] as string];
  const decoupe = partiesDuCombat(combat, parties.length);
  const siennes = decoupe.partiesReunies
    .map((partie) => parties[partie])
    .filter((id): id is string => id !== undefined);
  if (!decoupe.convergence) return siennes;
  return !estLaFinale(combat) && tatamiDeLaFinale !== undefined
    ? [...siennes, tatamiDeLaFinale]
    : siennes;
}

export function controlerLaContinuite(entree: EntreeDeContinuite): ConstatDeContinuite[] {
  const parties = new Map(entree.categories.map((c) => [c.id, c.tatamisDesParties] as const));
  const parId = new Map(entree.combats.map((c) => [c.fightId, c] as const));
  const tatamiDeLaFinale = new Map<string, string>();
  for (const combat of entree.combats) {
    if (estLaFinale(combat)) tatamiDeLaFinale.set(combat.categorieId, combat.tatamiId);
  }

  const constats: ConstatDeContinuite[] = [];
  for (const combat of entree.combats) {
    const siennes = parties.get(combat.categorieId);
    if (siennes === undefined) continue;
    const branche = tatamisDeLaBranche(combat, siennes, tatamiDeLaFinale.get(combat.categorieId));
    if (branche === null) continue;
    if (!branche.includes(combat.tatamiId)) {
      constats.push(constat("combat_hors_de_sa_branche", combat, branche));
      continue;
    }
    if (!estLaFinale(combat) || siennes.length < 2) continue;
    const demiFinales = (combat.sources ?? [])
      .filter((id): id is string => id !== null)
      .map((id) => parId.get(id))
      .filter((c): c is CombatDeContinuite => c !== undefined);
    if (demiFinales.length === 0) continue;
    if (demiFinales.some((d) => d.tatamiId === combat.tatamiId)) continue;
    constats.push(
      constat(
        "finale_loin_des_demi_finales",
        combat,
        demiFinales.map((d) => d.tatamiId),
      ),
    );
  }
  return constats;
}

/** Les constats d'un planning : ceux de `controlerLePlanning`, et ceux de la continuité. */
export type ConstatAvecLaContinuite = Constat | ConstatDeContinuite;

export type VerdictAvecLaContinuite = Omit<VerdictDePublication, "aConfirmer"> & {
  aConfirmer: ConstatAvecLaContinuite[];
};

/**
 * Le verdict de publication, avertissements de continuité compris : ils sont
 * à confirmer comme les autres avertissements et ne sont jamais bloquants.
 * Pour le reste, le verdict de `verdictDePublication`, inchangé.
 */
export function verdictAvecLaContinuite(
  constats: readonly Constat[],
  continuite: readonly ConstatDeContinuite[],
  confirmations: readonly string[] = [],
): VerdictAvecLaContinuite {
  const verdict = verdictDePublication(constats, confirmations);
  const confirmees = new Set(confirmations);
  const aConfirmer: ConstatAvecLaContinuite[] = [
    ...verdict.aConfirmer,
    ...continuite.filter((c) => !confirmees.has(c.cle)),
  ];
  const presentes = new Set(continuite.map((c) => c.cle));
  return {
    ...verdict,
    publiable:
      verdict.refus.length === 0 && verdict.bloquants.length === 0 && aConfirmer.length === 0,
    aConfirmer,
    confirmationsInutiles: verdict.confirmationsInutiles.filter((cle) => !presentes.has(cle)),
  };
}

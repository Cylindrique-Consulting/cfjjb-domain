import type { BracketEntry, GeneratedFight } from "./bracket-generator";

export type RencontreInterne = {
  readonly division: number;
  readonly indexInDivision: number;
  readonly entiteId: string;
  readonly registrationA: string;
  readonly registrationB: string;
};

export type EntiteSurchargee = {
  readonly entiteId: string;
  readonly effectif: number;
};

export type VerdictSeparation = {
  readonly rencontres: readonly RencontreInterne[];
  readonly surchargees: readonly EntiteSurchargee[];
};

function entiteDe(e: BracketEntry): string | null {
  return e.teamId ?? e.clubId ?? null;
}

export const MAX_PAR_ENTITE = 2;

export function verifierSeparationDEquipe(
  fights: readonly GeneratedFight[],
  entries: readonly BracketEntry[],
): VerdictSeparation {
  const parInscription = new Map<string, string>();
  const effectifs = new Map<string, number>();

  for (const e of entries) {
    const entite = entiteDe(e);
    if (entite === null) continue;
    parInscription.set(e.registrationId, entite);
    effectifs.set(entite, (effectifs.get(entite) ?? 0) + 1);
  }

  const rencontres: RencontreInterne[] = [];
  for (const f of fights) {
    if (f.isBye || f.slotA === null || f.slotB === null) continue;
    const a = parInscription.get(f.slotA);
    const b = parInscription.get(f.slotB);
    if (a === undefined || a !== b) continue;
    rencontres.push({
      division: f.division,
      indexInDivision: f.indexInDivision,
      entiteId: a,
      registrationA: f.slotA,
      registrationB: f.slotB,
    });
  }

  const surchargees: EntiteSurchargee[] = [...effectifs.entries()]
    .filter(([, n]) => n > MAX_PAR_ENTITE)
    .map(([entiteId, effectif]) => ({ entiteId, effectif }))
    .sort((x, y) => y.effectif - x.effectif || x.entiteId.localeCompare(y.entiteId));

  return { rencontres, surchargees };
}

export function separationTenue(verdict: VerdictSeparation): boolean {
  return verdict.rencontres.length === 0;
}

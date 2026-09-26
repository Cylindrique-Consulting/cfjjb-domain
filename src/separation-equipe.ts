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

export type PaireAvantLaFinale = {
  readonly entiteId: string;
  readonly registrationA: string;
  readonly registrationB: string;
};

/**
 * CE QUE LE GUIDE INTERDIT AU-DELÀ DU PREMIER TOUR (guide v1.3, §5 et §6).
 *
 * `paires` : deux inscrits d'une même entité dans une même moitié du tableau, à
 * partir de quatre ; dans la 1re demi-finale, à trois. `inevitables` : combien de ces
 * paires aucun placement conforme ne peut éviter. En placement par rang, la réponse
 * vient d'une recherche exhaustive (au plus 17 inscrits) sur les moitiés, avec #1 et
 * #2 opposés, #1 puis #2 exemptés et un seul tour blanc réattribué. Au-delà, et sans
 * rang, seul l'effectif l'impose : k athlètes d'une entité en mettent au moins
 * C(⌈k/2⌉, 2) + C(⌊k/2⌋, 2) paires dans une même moitié.
 */
export type SeparationAvantLaFinale = {
  readonly paires: readonly PaireAvantLaFinale[];
  readonly inevitables: number;
};

export type VerdictSeparation = {
  readonly rencontres: readonly RencontreInterne[];
  readonly surchargees: readonly EntiteSurchargee[];
  readonly avantLaFinale: SeparationAvantLaFinale;
};

export type OptionsDeSeparation = {
  /** Le tableau a été placé au rang sportif (`entries[].rank`). */
  readonly parRang?: boolean;
};

function entiteDe(e: BracketEntry): string | null {
  return e.teamId ?? e.clubId ?? null;
}

export const MAX_PAR_ENTITE = 2;

export function verifierSeparationDEquipe(
  fights: readonly GeneratedFight[],
  entries: readonly BracketEntry[],
  options: OptionsDeSeparation = {},
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

  return {
    rencontres,
    surchargees,
    avantLaFinale: verifierSeparationAvantLaFinale(fights, entries, options),
  };
}

const RANG_MAX_DE_LA_RECHERCHE = 17;

const pairesDe = (k: number): number => (k * (k - 1)) / 2;

export function verifierSeparationAvantLaFinale(
  fights: readonly GeneratedFight[],
  entries: readonly BracketEntry[],
  options: OptionsDeSeparation = {},
): SeparationAvantLaFinale {
  const n = entries.length;
  const entiteDeLInscription = new Map<string, string>();
  for (const e of entries) {
    const entite = entiteDe(e);
    if (entite !== null) entiteDeLInscription.set(e.registrationId, entite);
  }
  if (n < 3) return { paires: [], inevitables: 0 };

  const profondeur = Math.max(0, ...fights.map((f) => f.division));
  const duPremierTour = fights
    .filter((f) => f.division === profondeur && f.type === "BraketFight")
    .sort((x, y) => x.indexInDivision - y.indexInDivision);

  const paires: PaireAvantLaFinale[] = [];
  const retenir = (a: string, b: string): void => {
    const x = entiteDeLInscription.get(a);
    if (x !== undefined && x === entiteDeLInscription.get(b)) {
      paires.push({ entiteId: x, registrationA: a, registrationB: b });
    }
  };

  if (n === 3) {
    // La 1re demi-finale est le seul combat plein du premier tour ; l'exempté attend.
    const demi = duPremierTour.find((f) => f.slotA !== null && f.slotB !== null);
    if (demi) retenir(demi.slotA as string, demi.slotB as string);
    const entites = new Set(entries.map((e) => entiteDe(e)));
    const toutesLesTrois = entites.size === 1 && !entites.has(null);
    return { paires, inevitables: paires.length > 0 && toutesLesTrois ? 1 : 0 };
  }

  const places = 2 * 2 ** (profondeur - 1);
  const moitieDe = new Map<string, number>();
  for (const f of duPremierTour) {
    const base = 2 * f.indexInDivision;
    if (f.slotA !== null) moitieDe.set(f.slotA, base < places / 2 ? 0 : 1);
    if (f.slotB !== null) moitieDe.set(f.slotB, base + 1 < places / 2 ? 0 : 1);
  }
  const inscrits = entries.filter((e) => moitieDe.has(e.registrationId));
  for (let i = 0; i < inscrits.length; i++) {
    for (let j = i + 1; j < inscrits.length; j++) {
      const a = inscrits[i] as BracketEntry;
      const b = inscrits[j] as BracketEntry;
      if (moitieDe.get(a.registrationId) === moitieDe.get(b.registrationId)) {
        retenir(a.registrationId, b.registrationId);
      }
    }
  }
  if (paires.length === 0) return { paires, inevitables: 0 };

  const parEffectif = minimumParEffectif(entries);
  const minimum =
    options.parRang === true && n <= RANG_MAX_DE_LA_RECHERCHE
      ? Math.max(parEffectif, minimumAuRang(entries))
      : parEffectif;
  return { paires, inevitables: Math.min(paires.length, minimum) };
}

function minimumParEffectif(entries: readonly BracketEntry[]): number {
  const effectifs = new Map<string, number>();
  for (const e of entries) {
    const entite = entiteDe(e);
    if (entite !== null) effectifs.set(entite, (effectifs.get(entite) ?? 0) + 1);
  }
  let total = 0;
  for (const k of effectifs.values())
    total += pairesDe(Math.ceil(k / 2)) + pairesDe(Math.floor(k / 2));
  return total;
}

/**
 * Le moins de paires dans une même moitié que permet le guide au rang sportif :
 * #1 et #2 opposés, les tours blancs aux mieux classés de chaque moitié, #1 puis #2
 * exemptés, un seul tour blanc réattribué (guide v1.3, §4 et §5).
 */
function minimumAuRang(entries: readonly BracketEntry[]): number {
  const n = entries.length;
  const ordre = entries
    .map((e, index) => ({ e, index, rang: e.rank ?? null }))
    .sort((a, b) => {
      if (a.rang === null && b.rang === null) return a.index - b.index;
      if (a.rang === null) return 1;
      if (b.rang === null) return -1;
      return a.rang - b.rang || a.index - b.index;
    })
    .map((x) => entiteDe(x.e));
  const places = 2 ** Math.ceil(Math.log2(n));
  const combatsParMoitie = places / 4;
  const toursBlancs = places - n;
  let meilleur = Number.POSITIVE_INFINITY;
  for (let masque = 0; masque < 1 << n; masque++) {
    const cote = (i: number): number => (masque >> i) & 1;
    if (cote(0) === cote(1)) continue;
    const effectifs = [0, 0];
    for (let i = 0; i < n; i++) effectifs[cote(i)]! += 1;
    if (effectifs.some((e) => e < combatsParMoitie || e > 2 * combatsParMoitie)) continue;
    let reattribues = 0;
    let protegees = true;
    for (const m of [0, 1]) {
      let aDonner = 2 * combatsParMoitie - effectifs[m]!;
      for (let i = 0; i < n && aDonner > 0; i++) {
        if (cote(i) !== m) continue;
        aDonner -= 1;
        if (i >= toursBlancs) reattribues += 1;
      }
    }
    for (let i = 0; i < Math.min(2, toursBlancs); i++) {
      let exempte = false;
      const m = cote(i);
      let rangDansLaMoitie = 0;
      for (let j = 0; j <= i; j++) if (cote(j) === m) rangDansLaMoitie += 1;
      exempte = rangDansLaMoitie <= 2 * combatsParMoitie - effectifs[m]!;
      if (!exempte) protegees = false;
    }
    if (!protegees || reattribues > 1) continue;
    const parMoitie = [new Map<string, number>(), new Map<string, number>()];
    for (let i = 0; i < n; i++) {
      const entite = ordre[i];
      if (entite === null || entite === undefined) continue;
      const vus = parMoitie[cote(i)]!;
      vus.set(entite, (vus.get(entite) ?? 0) + 1);
    }
    let total = 0;
    for (const vus of parMoitie) for (const k of vus.values()) total += pairesDe(k);
    if (total < meilleur) meilleur = total;
    if (meilleur === 0) break;
  }
  return Number.isFinite(meilleur) ? meilleur : 0;
}

export function separationTenue(verdict: VerdictSeparation): boolean {
  return verdict.rencontres.length === 0;
}

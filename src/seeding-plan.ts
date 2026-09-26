import type { BracketEntry } from "./bracket-generator";
import { shuffle } from "./prng";

export class SeedingPlanError extends Error {}

export type SeparationKey = "club" | "team" | "national-team" | "source-category";

export function separationKeyOf(entry: BracketEntry | null, key: SeparationKey): string | null {
  if (entry === null) return null;
  switch (key) {
    case "club":
      return entry.clubId ?? null;
    case "team":
      return entry.teamId ?? null;
    case "national-team":
      return entry.nationalTeam === true ? "national-team" : null;
    case "source-category":
      return entry.sourceCategoryId ?? null;
  }
}

export type SeparationScope = { kind: "round"; round: number } | { kind: "half" };

export type SeparationConstraint = {
  readonly name: string;
  readonly enabled: boolean;
  readonly key: SeparationKey;
  readonly scope: SeparationScope;
  readonly tier: number;
  readonly weight: number;
};

export type SeedOrderStep =
  | { readonly kind: "interleave"; readonly enabled: boolean; readonly key: SeparationKey }
  | { readonly kind: "source-place"; readonly enabled: boolean }
  | {
      readonly kind: "rank-bonus";
      readonly enabled: boolean;
      readonly key: SeparationKey;
      readonly bonus: number;
    }
  | {
      readonly kind: "protected-ranking";
      readonly enabled: boolean;
      readonly count: number;
      readonly whenExceedingByes: "degrade" | "reject";
    }
  | { readonly kind: "rang-sportif"; readonly enabled: boolean };

export type PinRule =
  | { readonly kind: "empty-leaves" }
  | { readonly kind: "bye-holders" }
  | { readonly kind: "leaves"; readonly leaves: readonly number[] };

export type ReparationDuPlacement = "libre" | "rang-voisin";

export type SeedingPlan = {
  readonly order: readonly SeedOrderStep[];
  readonly constraints: readonly SeparationConstraint[];
  readonly pins: readonly PinRule[];
  readonly reparation?: ReparationDuPlacement;
};

export type SeedingWarning =
  | {
      readonly code: "protected-ranking-missing-rank";
      readonly requested: number;
      readonly ranked: number;
    }
  | {
      readonly code: "protected-ranking-exceeds-byes";
      readonly protectedCount: number;
      readonly byeCount: number;
    }
  | { readonly code: "rang-sportif-manquant"; readonly sansRang: number };

export type EchangeDeSeparation = {
  readonly deplace: string;
  readonly avec: string;
  readonly contrainte: string;
};

export type SeedingOutcome = {
  readonly seedOrder: readonly BracketEntry[];
  readonly placement: readonly (BracketEntry | null)[];
  readonly leaves: readonly (BracketEntry | null)[];
  readonly warnings: readonly SeedingWarning[];
  readonly echanges: readonly EchangeDeSeparation[];
};

export const DEFAULT_SEEDING_PLAN: SeedingPlan = {
  order: [
    { kind: "interleave", enabled: true, key: "club" },
    { kind: "rank-bonus", enabled: false, key: "national-team", bonus: 4 },
    { kind: "protected-ranking", enabled: false, count: 0, whenExceedingByes: "degrade" },
    { kind: "source-place", enabled: false },
  ],
  constraints: [
    {
      name: "meme-club-premier-tour",
      enabled: true,
      key: "club",
      scope: { kind: "round", round: 1 },
      tier: 0,
      weight: 1,
    },
    {
      name: "meme-club-quart-de-tableau",
      enabled: true,
      key: "club",
      scope: { kind: "round", round: 2 },
      tier: 1,
      weight: 1,
    },
    {
      name: "meme-equipe-premier-tour",
      enabled: false,
      key: "team",
      scope: { kind: "round", round: 1 },
      tier: 0,
      weight: 1,
    },
    {
      name: "meme-equipe-meme-moitie",
      enabled: false,
      key: "team",
      scope: { kind: "half" },
      tier: 2,
      weight: 1,
    },
    {
      name: "equipe-de-France-meme-moitie",
      enabled: false,
      key: "national-team",
      scope: { kind: "half" },
      tier: 2,
      weight: 1,
    },
    {
      name: "meme-categorie-source-premier-tour",
      enabled: false,
      key: "source-category",
      scope: { kind: "round", round: 1 },
      tier: 0,
      weight: 1,
    },
  ],
  pins: [{ kind: "empty-leaves" }],
};

export function describeSeedingPlan(plan: SeedingPlan = DEFAULT_SEEDING_PLAN): string[] {
  const state = (on: boolean) => (on ? "actif" : "éteint");
  const scope = (s: SeparationScope) =>
    s.kind === "half" ? "moitié de tableau" : `bloc du tour ${s.round}`;
  return [
    ...plan.order.map((step) => {
      switch (step.kind) {
        case "interleave":
          return `1. ordre des graines / entrelacement par ${step.key} (${state(step.enabled)})`;
        case "source-place":
          return `1. ordre des graines / place source puis catégorie la plus lourde (${state(step.enabled)})`;
        case "rank-bonus":
          return `1. ordre des graines / bonus de rang ${step.bonus} pour ${step.key} (${state(step.enabled)})`;
        case "protected-ranking":
          return `1. ordre des graines / classement protégé sur ${step.count}, débordement : ${step.whenExceedingByes} (${state(step.enabled)})`;
        case "rang-sportif":
          return `1. ordre des graines / rang sportif, #1 en tête (${state(step.enabled)})`;
      }
    }),
    "2. placement standard (graines aux positions canoniques)",
    ...(plan.reparation === "rang-voisin"
      ? [
          "3. réparation / au rang voisin : le moins bien classé de deux coéquipiers est échangé avec le rang le plus proche, #1 et #2 restent dans deux moitiés, aucun bye ne change de main ; au premier tour, puis entre les deux moitiés du tableau quand le plan le demande",
        ]
      : []),
    ...plan.constraints.map(
      (c) =>
        `3. réparation / ${c.name} : ${c.key} par ${scope(c.scope)}, palier ${c.tier}, poids ${c.weight} (${state(c.enabled)})`,
    ),
    ...plan.pins.map((p) =>
      p.kind === "leaves"
        ? `3. réparation / figé : positions ${p.leaves.join(", ")}`
        : `3. réparation / figé : ${p.kind}`,
    ),
  ];
}

export function seedPositions(size: number): number[] {
  let arr = [1];
  while (arr.length < size) {
    const len = arr.length * 2;
    const next: number[] = [];
    for (const s of arr) {
      next.push(s, len + 1 - s);
    }
    arr = next;
  }
  return arr;
}

function interleaveByKey(
  entries: readonly BracketEntry[],
  key: SeparationKey,
  rng: () => number,
): BracketEntry[] {
  const groups = new Map<string, BracketEntry[]>();
  entries.forEach((entry, i) => {
    const k = separationKeyOf(entry, key) ?? `__solo_${i}`;
    const group = groups.get(k);
    if (group) group.push(entry);
    else groups.set(k, [entry]);
  });

  const shuffledGroups = shuffle(
    [...groups.values()].map((g) => shuffle(g, rng)),
    rng,
  ).sort((a, b) => b.length - a.length);

  const out: BracketEntry[] = [];
  let added = true;
  let round = 0;
  while (added) {
    added = false;
    for (const group of shuffledGroups) {
      const item = group[round];
      if (item !== undefined) {
        out.push(item);
        added = true;
      }
    }
    round++;
  }
  return out;
}

export type SourcePlaceAndWeight = Pick<BracketEntry, "sourcePlace" | "sourceWeightRank">;

export function compareSourcePlaceThenWeight(
  a: SourcePlaceAndWeight,
  b: SourcePlaceAndWeight,
): number {
  const cmp = (x: number, y: number) => (x < y ? -1 : x > y ? 1 : 0);
  return (
    cmp(a.sourcePlace ?? Number.POSITIVE_INFINITY, b.sourcePlace ?? Number.POSITIVE_INFINITY) ||
    cmp(
      b.sourceWeightRank ?? Number.NEGATIVE_INFINITY,
      a.sourceWeightRank ?? Number.NEGATIVE_INFINITY,
    )
  );
}

function applySourcePlaceOrder(order: readonly BracketEntry[]): BracketEntry[] {
  return order
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => compareSourcePlaceThenWeight(a.entry, b.entry) || a.index - b.index)
    .map((x) => x.entry);
}

function applyRankBonus(
  order: readonly BracketEntry[],
  key: SeparationKey,
  bonus: number,
): BracketEntry[] {
  return order
    .map((entry, index) => ({
      entry,
      index,
      adjusted: index - (separationKeyOf(entry, key) !== null ? bonus : 0),
    }))
    .sort((a, b) => a.adjusted - b.adjusted || a.index - b.index)
    .map((x) => x.entry);
}

function applyProtectedRanking(
  order: readonly BracketEntry[],
  step: Extract<SeedOrderStep, { kind: "protected-ranking" }>,
  size: number,
  warnings: SeedingWarning[],
): BracketEntry[] {
  const ranked = order
    .map((entry, index) => ({ entry, index, rank: entry.rank ?? null }))
    .filter((x): x is { entry: BracketEntry; index: number; rank: number } => x.rank !== null)
    .sort((a, b) => a.rank - b.rank || a.index - b.index);

  const count = Math.min(step.count, ranked.length);
  if (count < step.count) {
    warnings.push({
      code: "protected-ranking-missing-rank",
      requested: step.count,
      ranked: ranked.length,
    });
  }

  const byeCount = size - order.length;
  if (count > byeCount) {
    if (step.whenExceedingByes === "reject") {
      throw new SeedingPlanError(
        `Classement protégé : ${count} protégés pour ${byeCount} bye(s) disponible(s). ` +
          `Un tableau de taille ${size} pour ${order.length} inscrits ne peut pas faire sauter ` +
          `un tour à tout le monde.`,
      );
    }
    warnings.push({ code: "protected-ranking-exceeds-byes", protectedCount: count, byeCount });
  }

  const chosen = ranked.slice(0, count);
  const chosenIndexes = new Set(chosen.map((x) => x.index));
  return [...chosen.map((x) => x.entry), ...order.filter((_, i) => !chosenIndexes.has(i))];
}

function applyRangSportif(
  order: readonly BracketEntry[],
  warnings: SeedingWarning[],
): BracketEntry[] {
  const lus = order.map((entry, index) => ({ entry, index, rank: entry.rank ?? null }));
  const sansRang = lus.filter((x) => x.rank === null).length;
  if (sansRang > 0) warnings.push({ code: "rang-sportif-manquant", sansRang });
  return lus
    .sort((a, b) => {
      if (a.rank === null && b.rank === null) return a.index - b.index;
      if (a.rank === null) return 1;
      if (b.rank === null) return -1;
      return a.rank - b.rank || a.index - b.index;
    })
    .map((x) => x.entry);
}

type Leaf = BracketEntry | null;

function blockSizeOf(scope: SeparationScope, size: number): number {
  const raw = scope.kind === "half" ? size / 2 : 2 ** scope.round;
  return Math.max(1, Math.floor(raw));
}

function penaltyOf(leaves: readonly Leaf[], constraint: SeparationConstraint): number {
  const size = leaves.length;
  const block = blockSizeOf(constraint.scope, size);
  let pairs = 0;
  for (let start = 0; start < size; start += block) {
    const counts = new Map<string, number>();
    const end = Math.min(size, start + block);
    for (let l = start; l < end; l++) {
      const k = separationKeyOf(leaves[l] ?? null, constraint.key);
      if (k !== null) counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    for (const n of counts.values()) pairs += (n * (n - 1)) / 2;
  }
  return pairs * constraint.weight;
}

function scoreOf(leaves: readonly Leaf[], constraints: readonly SeparationConstraint[]): number[] {
  const tiers = constraints.reduce((max, c) => Math.max(max, c.tier + 1), 0);
  const out = new Array<number>(tiers).fill(0);
  for (const c of constraints) out[c.tier] = (out[c.tier] ?? 0) + penaltyOf(leaves, c);
  return out;
}

function isBetter(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}

function isInertSwap(a: Leaf, b: Leaf, constraints: readonly SeparationConstraint[]): boolean {
  if ((a === null) !== (b === null)) return false;
  return constraints.every((c) => separationKeyOf(a, c.key) === separationKeyOf(b, c.key));
}

function pinnedLeaves(leaves: readonly Leaf[], pins: readonly PinRule[]): Set<number> {
  const out = new Set<number>();
  for (const pin of pins) {
    switch (pin.kind) {
      case "empty-leaves":
        leaves.forEach((leaf, i) => {
          if (leaf === null) out.add(i);
        });
        break;
      case "bye-holders":
        for (let f = 0; 2 * f + 1 < leaves.length; f++) {
          const a = leaves[2 * f] ?? null;
          const b = leaves[2 * f + 1] ?? null;
          if (a === null && b !== null) out.add(2 * f + 1);
          if (b === null && a !== null) out.add(2 * f);
        }
        break;
      case "leaves":
        for (const i of pin.leaves) out.add(i);
        break;
    }
  }
  return out;
}

function leavesAnEmptyFight(leaves: readonly Leaf[], ...touched: number[]): boolean {
  for (const l of touched) {
    const fight = Math.floor(l / 2);
    if ((leaves[2 * fight] ?? null) === null && (leaves[2 * fight + 1] ?? null) === null) {
      return true;
    }
  }
  return false;
}

function repair(placement: readonly Leaf[], plan: SeedingPlan): Leaf[] {
  const out = [...placement];
  const size = out.length;
  const constraints = plan.constraints.filter((c) => c.enabled);
  const pinned = pinnedLeaves(out, plan.pins);
  const movable: number[] = [];
  for (let i = 0; i < size; i++) if (!pinned.has(i)) movable.push(i);

  let score = scoreOf(out, constraints);
  let improved = true;
  let guard = size * 2;

  while (improved && score.some((v) => v > 0) && guard-- > 0) {
    improved = false;
    outer: for (const i of movable) {
      for (const j of movable) {
        if (j <= i) continue;
        const a = out[i] ?? null;
        const b = out[j] ?? null;
        if (isInertSwap(a, b, constraints)) continue;
        [out[i], out[j]] = [b, a];
        if (leavesAnEmptyFight(out, i, j)) {
          [out[i], out[j]] = [a, b];
          continue;
        }
        const next = scoreOf(out, constraints);
        if (isBetter(next, score)) {
          score = next;
          improved = true;
          break outer;
        }
        [out[i], out[j]] = [a, b];
      }
    }
  }
  return out;
}

function trierParPalier(contraintes: readonly SeparationConstraint[]): SeparationConstraint[] {
  return contraintes
    .map((c, ordre) => ({ c, ordre }))
    .sort((a, b) => a.c.tier - b.c.tier || a.ordre - b.ordre)
    .map((x) => x.c);
}

function conflitSelon(
  contraintes: readonly SeparationConstraint[],
  a: Leaf,
  b: Leaf,
): SeparationConstraint | null {
  if (a === null || b === null) return null;
  for (const c of contraintes) {
    const cle = separationKeyOf(a, c.key);
    if (cle !== null && cle === separationKeyOf(b, c.key)) return c;
  }
  return null;
}

function parVoisinage(cible: number): (gx: number, gy: number) => number {
  return (gx, gy) => {
    const dx = Math.abs(gx - cible);
    const dy = Math.abs(gy - cible);
    if (dx !== dy) return dx - dy;
    const moinsBienX = gx > cible ? 0 : 1;
    const moinsBienY = gy > cible ? 0 : 1;
    return moinsBienX - moinsBienY || gx - gy;
  };
}

/**
 * LE TOUR BLANC QU'UNE CATÉGORIE PEUT RÉATTRIBUER, UNE SEULE FOIS (guide v1.3, §4).
 *
 * Quand aucun échange entre combats pleins ne sépare deux coéquipiers, un tour
 * blanc change de main : « Le générateur ne réattribue qu'un seul tour blanc. Il
 * protège d'abord #1, puis #2, puis les rangs suivants. » Le même compteur sert au
 * premier tour et aux moitiés : jamais deux tours blancs réattribués dans une
 * catégorie.
 */
type BudgetDeTourBlanc = { reattribue: boolean };

/**
 * La revanche (même catégorie source, absolut) ne déplace jamais un tour blanc :
 * « Cette règle n'est appliquée que si elle ne pénalise aucun mieux classé »
 * (guide v1.3, §7), et céder son tour blanc pénalise celui qui le perd.
 */
function peutReattribuerUnTourBlanc(contrainte: SeparationConstraint): boolean {
  return contrainte.key !== "source-category";
}

function reparerAuRangVoisin(
  placement: readonly Leaf[],
  seedOrder: readonly BracketEntry[],
  plan: SeedingPlan,
): { leaves: Leaf[]; echanges: EchangeDeSeparation[] } {
  const out = [...placement];
  const size = out.length;
  const echanges: EchangeDeSeparation[] = [];
  const contraintes = trierParPalier(
    plan.constraints.filter((c) => c.enabled && c.scope.kind === "round" && c.scope.round === 1),
  );
  const contraintesDeMoitie = trierParPalier(
    plan.constraints.filter((c) => c.enabled && c.scope.kind === "half"),
  );
  if ((contraintes.length === 0 && contraintesDeMoitie.length === 0) || size < 4) {
    return { leaves: out, echanges };
  }

  const effectif = out.filter((l) => l !== null).length;
  const graines = new Map(seedOrder.map((e, i) => [e.registrationId, i + 1] as const));
  const graineDe = (l: Leaf): number =>
    l === null
      ? Number.POSITIVE_INFINITY
      : (graines.get(l.registrationId) ?? Number.POSITIVE_INFINITY);
  const conflit = (a: Leaf, b: Leaf): SeparationConstraint | null =>
    conflitSelon(contraintes, a, b);
  // UN ÉCHANGE N'EST REFUSÉ QUE PAR UN CONFLIT AU MOINS AUSSI IMPORTANT que celui
  // qu'il répare : séparer deux coéquipiers peut créer une revanche de catégorie
  // source (absolut, palier plus bas), jamais l'inverse.
  const bloque = (x: Leaf, y: Leaf, palier: number): boolean => {
    const c = conflit(x, y);
    return c !== null && c.tier <= palier;
  };
  const moitie = (feuille: number): number => (feuille < size / 2 ? 0 : 1);
  const partenaire = (feuille: number): number => feuille ^ 1;
  const tetesDeSerieOpposees = (): boolean => {
    const premier = out.findIndex((l) => graineDe(l) === 1);
    const second = out.findIndex((l) => graineDe(l) === 2);
    if (premier < 0 || second < 0) return true;
    return moitie(premier) !== moitie(second);
  };
  // À partir de quatre, #1 et #2 gardent leur tour blanc. À trois, le format du
  // guide (§6) : #2 et #3 coéquipiers, #1 affronte #3 et #2 attend la 2e demi.
  const peutCederSonTourBlanc = (l: Leaf): boolean => effectif === 3 || graineDe(l) > 2;
  const budget: BudgetDeTourBlanc = { reattribue: false };

  const irreparables = new Set<number>();
  for (let garde = 0; garde <= size; garde++) {
    let choisi: {
      combat: number;
      feuilleA: number;
      feuilleB: number;
      contrainte: SeparationConstraint;
    } | null = null;
    for (let combat = 0; combat < size / 2; combat++) {
      if (irreparables.has(combat)) continue;
      const haut = out[2 * combat] ?? null;
      const bas = out[2 * combat + 1] ?? null;
      const contrainte = conflit(haut, bas);
      if (contrainte === null) continue;
      const feuilleB = graineDe(haut) > graineDe(bas) ? 2 * combat : 2 * combat + 1;
      if (
        choisi === null ||
        contrainte.tier < choisi.contrainte.tier ||
        (contrainte.tier === choisi.contrainte.tier &&
          graineDe(out[feuilleB] ?? null) < graineDe(out[choisi.feuilleB] ?? null))
      ) {
        choisi = { combat, feuilleA: partenaire(feuilleB), feuilleB, contrainte };
      }
    }
    if (choisi === null) break;

    const a = out[choisi.feuilleA] as BracketEntry;
    const b = out[choisi.feuilleB] as BracketEntry;
    const { contrainte } = choisi;
    const graineB = graineDe(b);

    const candidats: number[] = [];
    for (let feuille = 0; feuille < size; feuille++) {
      if (feuille === choisi.feuilleA || feuille === choisi.feuilleB) continue;
      if ((out[feuille] ?? null) === null) continue;
      if ((out[partenaire(feuille)] ?? null) === null) continue;
      candidats.push(feuille);
    }
    // AU RANG LE PLUS PROCHE ; à distance égale, celui qui laisse les deux
    // coéquipiers dans deux moitiés (un seul échange au lieu de deux, comme
    // l'exemple du guide §5, #16 avec #15), puis le moins bien classé.
    const moitiesApres = new Map<number, number>();
    if (contraintesDeMoitie.length > 0) {
      for (const feuille of candidats) {
        const c = out[feuille] ?? null;
        out[choisi.feuilleB] = c;
        out[feuille] = b;
        moitiesApres.set(
          feuille,
          contraintesDeMoitie.reduce((somme, cm) => somme + penaltyOf(out, cm), 0),
        );
        out[choisi.feuilleB] = b;
        out[feuille] = c;
      }
    }
    const auVoisinage = parVoisinage(graineB);
    candidats.sort((x, y) => {
      const gx = graineDe(out[x] ?? null);
      const gy = graineDe(out[y] ?? null);
      const ecart = Math.abs(gx - graineB) - Math.abs(gy - graineB);
      if (ecart !== 0) return ecart;
      const moities = (moitiesApres.get(x) ?? 0) - (moitiesApres.get(y) ?? 0);
      return moities !== 0 ? moities : auVoisinage(gx, gy);
    });

    let tenu = false;
    for (const feuille of candidats) {
      const c = out[feuille] as BracketEntry;
      const d = out[partenaire(feuille)] as BracketEntry;
      if (bloque(a, c, contrainte.tier) || bloque(b, d, contrainte.tier)) continue;
      out[choisi.feuilleB] = c;
      out[feuille] = b;
      if (!tetesDeSerieOpposees()) {
        out[choisi.feuilleB] = b;
        out[feuille] = c;
        continue;
      }
      echanges.push({
        deplace: b.registrationId,
        avec: c.registrationId,
        contrainte: contrainte.name,
      });
      tenu = true;
      break;
    }
    // PLUS AUCUN COMBAT PLEIN NE LES SÉPARE : le mieux classé des deux prend le
    // tour blanc du moins bien classé des exemptés qui peut le céder, et celui-ci
    // affronte l'autre coéquipier (guide §4 : à cinq, #4 et #5 coéquipiers
    // donnent les tours blancs #1, #2 et #4 et le combat #3/#5).
    if (!tenu && !budget.reattribue && peutReattribuerUnTourBlanc(contrainte)) {
      const exemptes: number[] = [];
      for (let feuille = 0; feuille < size; feuille++) {
        if (feuille === choisi.feuilleA || feuille === choisi.feuilleB) continue;
        const l = out[feuille] ?? null;
        if (l === null || (out[partenaire(feuille)] ?? null) !== null) continue;
        if (peutCederSonTourBlanc(l)) exemptes.push(feuille);
      }
      exemptes.sort((x, y) => graineDe(out[y] ?? null) - graineDe(out[x] ?? null));
      for (const feuille of exemptes) {
        const c = out[feuille] as BracketEntry;
        if (bloque(c, b, contrainte.tier)) continue;
        out[choisi.feuilleA] = c;
        out[feuille] = a;
        if (!tetesDeSerieOpposees()) {
          out[choisi.feuilleA] = a;
          out[feuille] = c;
          continue;
        }
        echanges.push({
          deplace: a.registrationId,
          avec: c.registrationId,
          contrainte: contrainte.name,
        });
        budget.reattribue = true;
        tenu = true;
        break;
      }
    }
    if (!tenu) irreparables.add(choisi.combat);
  }
  // Les moitiés, à partir de quatre combattants seulement (guide §5) : à trois,
  // le format de la 1re demi-finale suffit, et il est conservé tel quel.
  if (contraintesDeMoitie.length > 0 && effectif >= 4) {
    separerLesMoities(
      out,
      graineDe,
      [...contraintes, ...contraintesDeMoitie],
      echanges,
      budget,
      peutCederSonTourBlanc,
    );
  }
  return { leaves: out, echanges };
}

function separerLesMoities(
  out: Leaf[],
  graineDe: (l: Leaf) => number,
  contraintes: readonly SeparationConstraint[],
  echanges: EchangeDeSeparation[],
  budget: BudgetDeTourBlanc,
  peutCederSonTourBlanc: (l: Leaf) => boolean,
): void {
  const size = out.length;
  const contraintesDeMoitie = contraintes.filter((c) => c.scope.kind === "half");
  const moitie = (feuille: number): number => (feuille < size / 2 ? 0 : 1);
  const partenaire = (feuille: number): number => feuille ^ 1;
  const tetesDeSerieOpposees = (): boolean => {
    const premier = out.findIndex((l) => graineDe(l) === 1);
    const second = out.findIndex((l) => graineDe(l) === 2);
    if (premier < 0 || second < 0) return true;
    return moitie(premier) !== moitie(second);
  };
  let score = scoreOf(out, contraintes);
  const retenir = (): boolean => {
    if (!tetesDeSerieOpposees()) return false;
    const suivant = scoreOf(out, contraintes);
    if (!isBetter(suivant, score)) return false;
    score = suivant;
    return true;
  };

  const echangerLAthlete = (feuille: number, contrainte: SeparationConstraint): boolean => {
    const b = out[feuille] as BracketEntry;
    const exempte = (out[partenaire(feuille)] ?? null) === null;
    const candidats: number[] = [];
    for (let f = 0; f < size; f++) {
      if (moitie(f) === moitie(feuille)) continue;
      if ((out[f] ?? null) === null) continue;
      if (((out[partenaire(f)] ?? null) === null) !== exempte) continue;
      candidats.push(f);
    }
    const auVoisinage = parVoisinage(graineDe(b));
    candidats.sort((x, y) => auVoisinage(graineDe(out[x] ?? null), graineDe(out[y] ?? null)));
    for (const f of candidats) {
      const c = out[f] as BracketEntry;
      out[feuille] = c;
      out[f] = b;
      if (retenir()) {
        echanges.push({
          deplace: b.registrationId,
          avec: c.registrationId,
          contrainte: contrainte.name,
        });
        return true;
      }
      out[feuille] = b;
      out[f] = c;
    }
    return false;
  };

  const tete = (combat: number): number =>
    Math.min(graineDe(out[2 * combat] ?? null), graineDe(out[2 * combat + 1] ?? null));

  const echangerLeCombat = (feuille: number, contrainte: SeparationConstraint): boolean => {
    const combat = Math.floor(feuille / 2);
    const candidats: number[] = [];
    for (let k = 0; k < size / 2; k++) {
      if (moitie(2 * k) === moitie(2 * combat)) continue;
      if ((out[2 * k] ?? null) === null && (out[2 * k + 1] ?? null) === null) continue;
      candidats.push(k);
    }
    const auVoisinage = parVoisinage(tete(combat));
    candidats.sort((x, y) => auVoisinage(tete(x), tete(y)));
    for (const k of candidats) {
      const p = out[2 * combat] ?? null;
      const q = out[2 * combat + 1] ?? null;
      const r = out[2 * k] ?? null;
      const s = out[2 * k + 1] ?? null;
      out[2 * combat] = r;
      out[2 * combat + 1] = s;
      out[2 * k] = p;
      out[2 * k + 1] = q;
      if (retenir()) {
        for (const [x, y] of [
          [p, r],
          [q, s],
        ] as const) {
          if (x === null || y === null) continue;
          echanges.push({
            deplace: x.registrationId,
            avec: y.registrationId,
            contrainte: contrainte.name,
          });
        }
        return true;
      }
      out[2 * combat] = p;
      out[2 * combat + 1] = q;
      out[2 * k] = r;
      out[2 * k + 1] = s;
    }
    return false;
  };

  // LE DERNIER RECOURS, UNE FOIS PAR CATÉGORIE (guide §4) : l'athlète passe dans
  // l'autre moitié en échangeant sa place avec un athlète de statut contraire, et
  // un tour blanc change de main. Il est pris au moins bien classé des exemptés
  // qui peuvent le céder : à cinq, #1+#4 et #2+#5 coéquipiers, #4 prend le tour
  // blanc de #3, qui affronte #5.
  const reattribuerUnTourBlanc = (feuille: number, contrainte: SeparationConstraint): boolean => {
    if (budget.reattribue || !peutReattribuerUnTourBlanc(contrainte)) return false;
    const x = out[feuille] as BracketEntry;
    const exempte = (out[partenaire(feuille)] ?? null) === null;
    if (exempte && !peutCederSonTourBlanc(x)) return false;
    const candidats: number[] = [];
    for (let f = 0; f < size; f++) {
      if (moitie(f) === moitie(feuille)) continue;
      const y = out[f] ?? null;
      if (y === null) continue;
      const yExempte = (out[partenaire(f)] ?? null) === null;
      if (yExempte === exempte) continue;
      if (yExempte && !peutCederSonTourBlanc(y)) continue;
      candidats.push(f);
    }
    const cedant = (f: number): number => (exempte ? graineDe(x) : graineDe(out[f] ?? null));
    const auVoisinage = parVoisinage(graineDe(x));
    candidats.sort(
      (p, q) =>
        cedant(q) - cedant(p) || auVoisinage(graineDe(out[p] ?? null), graineDe(out[q] ?? null)),
    );
    for (const f of candidats) {
      const y = out[f] as BracketEntry;
      out[feuille] = y;
      out[f] = x;
      if (retenir()) {
        budget.reattribue = true;
        echanges.push({
          deplace: x.registrationId,
          avec: y.registrationId,
          contrainte: contrainte.name,
        });
        return true;
      }
      out[feuille] = x;
      out[f] = y;
    }
    return false;
  };

  const irreparables = new Set<string>();
  for (let garde = 0; garde <= 2 * size; garde++) {
    let choisi: { feuilleA: number; feuilleB: number; contrainte: SeparationConstraint } | null =
      null;
    for (let i = 0; i < size; i++) {
      for (let j = i + 1; j < size; j++) {
        if (moitie(i) !== moitie(j)) continue;
        const x = out[i] ?? null;
        const y = out[j] ?? null;
        const contrainte = conflitSelon(contraintesDeMoitie, x, y);
        if (contrainte === null) continue;
        const [feuilleA, feuilleB] = graineDe(x) > graineDe(y) ? [j, i] : [i, j];
        if (irreparables.has((out[feuilleB] as BracketEntry).registrationId)) continue;
        if (
          choisi === null ||
          graineDe(out[feuilleB] ?? null) < graineDe(out[choisi.feuilleB] ?? null)
        ) {
          choisi = { feuilleA, feuilleB, contrainte };
        }
      }
    }
    if (choisi === null) break;
    const { feuilleA, feuilleB, contrainte } = choisi;
    const b = out[feuilleB] as BracketEntry;
    if (
      !echangerLAthlete(feuilleB, contrainte) &&
      !echangerLeCombat(feuilleB, contrainte) &&
      !echangerLAthlete(feuilleA, contrainte) &&
      !echangerLeCombat(feuilleA, contrainte) &&
      !reattribuerUnTourBlanc(feuilleB, contrainte) &&
      !reattribuerUnTourBlanc(feuilleA, contrainte)
    ) {
      irreparables.add(b.registrationId);
    }
  }
}

export function applySeedingPlan(
  entries: readonly BracketEntry[],
  size: number,
  rng: () => number,
  plan: SeedingPlan = DEFAULT_SEEDING_PLAN,
): SeedingOutcome {
  const warnings: SeedingWarning[] = [];

  let order: readonly BracketEntry[] = entries;
  for (const step of plan.order) {
    if (!step.enabled) continue;
    switch (step.kind) {
      case "interleave":
        order = interleaveByKey(order, step.key, rng);
        break;
      case "source-place":
        order = applySourcePlaceOrder(order);
        break;
      case "rank-bonus":
        order = applyRankBonus(order, step.key, step.bonus);
        break;
      case "protected-ranking":
        order = applyProtectedRanking(order, step, size, warnings);
        break;
      case "rang-sportif":
        order = applyRangSportif(order, warnings);
        break;
    }
  }

  const placement: Leaf[] = seedPositions(size).map((seedNumber) => order[seedNumber - 1] ?? null);

  if (plan.reparation === "rang-voisin") {
    const { leaves, echanges } = reparerAuRangVoisin(placement, order, plan);
    return { seedOrder: order, placement, leaves, warnings, echanges };
  }

  const leaves = repair(placement, plan);

  return { seedOrder: order, placement, leaves, warnings, echanges: [] };
}

/**
 * Le PIPELINE de contraintes de placement d'un tableau, en trois étapes
 * nommées.
 *
 *   1. ORDRE DES GRAINES  — des règles décident du rang d'entrée 1..N ;
 *   2. PLACEMENT STANDARD — les graines vont aux positions canoniques ;
 *   3. RÉPARATION         — les contraintes pondérées sont satisfaites au
 *                           mieux, par amélioration lexicographique.
 *
 * POURQUOI CE DÉCOUPAGE. Le placement était monolithique : une fonction
 * « anti-club » et une passe de swap, toutes deux écrites en dur au milieu du
 * générateur. Les règles de tirage de la fédération ne sont pas stables
 * (classement protégé, équipe de France, équipes de club), et chacune se
 * payait jusqu'ici d'une réécriture du générateur par la personne qui l'avait
 * écrit. Ici les règles sont des DONNÉES : les ajouter, les pondérer ou les
 * éteindre est un réglage, pas un chantier.
 *
 * CE QUI NE CHANGE PAS. `DEFAULT_SEEDING_PLAN` reproduit le comportement
 * d'avant le pipeline À L'IDENTIQUE, pour la même graine : même consommation
 * du tirage, même ordre de parcours des échanges, même score. Un plan par
 * défaut qui dériverait d'un cheveu changerait des tableaux réels sans que
 * rien ne le signale ; `tests/seeding-plan.test.ts` gèle donc la sortie
 * d'avant-le-lot dans un littéral.
 *
 * Module pur : aucune IO, aucune lecture de base. Les clés d'équipe, les rangs
 * de classement et les sélections en équipe de France sont FOURNIS par
 * l'appelant sur chaque `BracketEntry` ; ce paquet ne les devine jamais.
 */

import type { BracketEntry } from "./bracket-generator";
import { shuffle } from "./prng";

export class SeedingPlanError extends Error {}

// ------------------------------------------------------------------
// Clés de séparation
// ------------------------------------------------------------------

/**
 * Ce sur quoi une contrainte sépare. Chaque clé est lue sur l'entrée telle que
 * l'appelant l'a remplie ; une clé absente vaut « pas de contrainte » et
 * n'entre dans aucun décompte.
 */
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

/**
 * L'ENSEMBLE de feuilles sur lequel une contrainte compte les rencontres.
 *
 * - `{ kind: "round", round: r }` : les blocs de 2^r feuilles consécutives,
 *   c'est-à-dire les gens qui peuvent se rencontrer au plus tard au tour `r`.
 *   `round: 1` = le combat du premier tour, `round: 2` = le quart de tableau.
 * - `{ kind: "half" }` : les deux moitiés du tableau, celles qui ne se
 *   rencontrent qu'en finale.
 */
export type SeparationScope = { kind: "round"; round: number } | { kind: "half" };

/**
 * Une contrainte de séparation : « deux porteurs de la même clé ne devraient
 * pas se retrouver dans le même bloc ».
 *
 * `tier` est le PALIER lexicographique (0 est le plus fort) : la réparation
 * n'accepte un échange que s'il améliore le premier palier où quelque chose
 * bouge. `weight` pondère à l'intérieur d'un palier. Le pénalité d'un bloc est
 * le nombre de PAIRES de même clé qu'il contient.
 */
export type SeparationConstraint = {
  readonly name: string;
  readonly enabled: boolean;
  readonly key: SeparationKey;
  readonly scope: SeparationScope;
  readonly tier: number;
  readonly weight: number;
};

// ------------------------------------------------------------------
// Étape 1 : l'ordre des graines
// ------------------------------------------------------------------

/**
 * Les règles qui décident du rang d'entrée. Elles s'appliquent DANS L'ORDRE DU
 * TABLEAU `order`, chacune transformant la liste rendue par la précédente ;
 * une règle éteinte est sautée et ne consomme AUCUN tirage (sans quoi
 * l'éteindre changerait le tableau des autres).
 *
 * - `interleave` : les groupes d'une même clé sont mélangés puis entrelacés en
 *   tourniquet, les plus gros groupes d'abord. C'est l'anti-club historique.
 * - `rank-bonus` : bonus de rang pour les porteurs d'une clé (forme « bonus »
 *   de l'équipe de France) — chaque porteur remonte de `bonus` places, à
 *   égalité l'ordre d'arrivée tranche.
 * - `protected-ranking` : les `count` premiers du classement prennent les
 *   graines 1..count. Le placement standard appariant DÉJÀ les graines
 *   1..(taille−N) avec les byes, « le classé saute un tour » ne demande rien
 *   de plus. Voir `whenExceedingByes` pour le seul cas réellement neuf.
 * - `source-place` : l'ordre d'un ABSOLUT — d'abord la place obtenue dans la
 *   catégorie source, puis, à place égale, la catégorie de poids la plus
 *   lourde. C'est la seule règle d'ordre qui ne consomme AUCUN tirage : un
 *   absolut ne se tire pas au sort, il se classe.
 */
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
      /**
       * Que faire quand on protège plus de monde qu'il n'y a de byes
       * (`count > taille − N`) — le seul cas que le placement standard ne
       * traite pas tout seul.
       *
       * - `"degrade"` (défaut) : les `count` protégés prennent bien les
       *   graines 1..count, mais seuls les `taille − N` premiers sautent un
       *   tour ; les suivants combattent au premier tour. Le classement est
       *   respecté, la protection est partielle, et le manque est RENDU dans
       *   `warnings` plutôt que tu.
       * - `"reject"` : `SeedingPlanError`. À choisir le jour où la fédération
       *   décidera qu'une protection partielle est pire que pas de tableau.
       *
       * Le choix du défaut : un tableau qui n'existe pas est toujours pire
       * qu'un tableau imparfait le matin d'une compétition.
       */
      readonly whenExceedingByes: "degrade" | "reject";
    };

// ------------------------------------------------------------------
// Étape 3 : ce qui ne bouge pas
// ------------------------------------------------------------------

/**
 * Ce que la réparation n'a pas le droit de déplacer.
 *
 * `empty-leaves` NOMME une propriété que le code d'avant tenait par accident,
 * en n'itérant que sur les feuilles occupées : les emplacements de bye ne
 * bougent jamais, donc leur NOMBRE et leur POSITION sont figés par le
 * placement standard.
 *
 * Attention à ce que cette règle NE dit PAS, et qu'on lui prête volontiers :
 * elle ne fige pas QUI saute un tour. Un compétiteur assis à côté d'un bye
 * peut être échangé avec un autre compétiteur, et le bye change alors de
 * mains. Mesure sur le code d'avant le lot : sur 10 200 tirages comportant au
 * moins un bye, 5 460 (53 %) déplacent un bye d'une personne à une autre.
 * `bye-holders` est la règle qui figerait vraiment le bénéficiaire ; elle
 * existe donc ici, éteinte, plutôt que d'être crue acquise.
 */
export type PinRule =
  | { readonly kind: "empty-leaves" }
  | { readonly kind: "bye-holders" }
  | { readonly kind: "leaves"; readonly leaves: readonly number[] };

// ------------------------------------------------------------------
// Le plan
// ------------------------------------------------------------------

export type SeedingPlan = {
  readonly order: readonly SeedOrderStep[];
  readonly constraints: readonly SeparationConstraint[];
  readonly pins: readonly PinRule[];
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
    };

export type SeedingOutcome = {
  /** Étape 1 : l'ordre des graines, du rang 1 au rang N. */
  readonly seedOrder: readonly BracketEntry[];
  /** Étape 2 : les feuilles telles que le placement standard les pose. */
  readonly placement: readonly (BracketEntry | null)[];
  /** Étape 3 : les feuilles après réparation. C'est ce que le tableau utilise. */
  readonly leaves: readonly (BracketEntry | null)[];
  readonly warnings: readonly SeedingWarning[];
};

/**
 * LE PLAN PAR DÉFAUT, qui reproduit au bit près le placement d'avant le
 * pipeline. Toutes les règles neuves y figurent ÉTEINTES : leur arrivée sera
 * un réglage, pas une réécriture. Aucune n'est allumée parce que chacune
 * porte une question ouverte côté fédération (combien de classés protège-t-on,
 * l'équipe de France est-elle un bonus ou une séparation, qu'est-ce qu'une
 * « équipe » quand un club en aligne trois).
 */
export const DEFAULT_SEEDING_PLAN: SeedingPlan = {
  order: [
    // Allumée : c'est l'anti-club historique, et il tient le comportement.
    { kind: "interleave", enabled: true, key: "club" },
    // Équipe de France, forme « bonus de rang ».
    { kind: "rank-bonus", enabled: false, key: "national-team", bonus: 4 },
    // Classement protégé.
    { kind: "protected-ranking", enabled: false, count: 0, whenExceedingByes: "degrade" },
    // Ordre d'absolut. Éteint ici : une catégorie ordinaire n'a pas de place
    // source, et la règle y serait donc un tri sur des champs vides.
    { kind: "source-place", enabled: false },
  ],
  constraints: [
    // Les deux contraintes historiques, et leurs deux paliers : d'abord
    // aucun clubmate au premier tour, ensuite le moins possible dans le
    // même quart de tableau.
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
    // Même ÉQUIPE (clé fournie par l'appelant) : l'extension de l'anti-club
    // au-delà du club, y compris « pas des deux côtés du tableau ».
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
    // Équipe de France, forme « séparation » (l'alternative au bonus de rang).
    {
      name: "equipe-de-France-meme-moitie",
      enabled: false,
      key: "national-team",
      scope: { kind: "half" },
      tier: 2,
      weight: 1,
    },
    // Absolut : deux médaillés de la MÊME catégorie source viennent de se
    // rencontrer, parfois en finale. Les réapparier au premier tour de
    // l'absolut est la même famille de faute que l'anti-club, et se répare donc
    // par le même mécanisme.
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

/** Rend le plan lisible, ligne à ligne. Un tirage contesté doit s'expliquer sans lire le code. */
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
      }
    }),
    "2. placement standard (graines aux positions canoniques)",
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

// ------------------------------------------------------------------
// Étape 2 : le placement standard
// ------------------------------------------------------------------

/**
 * Positions des feuilles d'un tableau complet de taille S (puissance de deux),
 * de sorte que la graine 1 rencontre la graine S au premier tour, que les deux
 * meilleures graines soient dans des moitiés opposées et que les byes (graines
 * > N) s'apparient avec les meilleures graines, dans des combats distincts.
 * seedPositions(8) = [1, 8, 4, 5, 2, 7, 3, 6].
 */
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

// ------------------------------------------------------------------
// Étape 1 : les règles d'ordre des graines
// ------------------------------------------------------------------

/**
 * Groupes d'une même clé mélangés, puis entrelacés en tourniquet, les plus
 * gros groupes d'abord. Une clé absente fait un groupe SINGLETON (elle ne peut
 * entrer en conflit avec personne).
 *
 * L'ordre de consommation du tirage fait partie du contrat : les groupes sont
 * mélangés un à un dans l'ordre de PREMIÈRE APPARITION dans la liste d'entrée,
 * puis la liste des groupes est mélangée à son tour, puis triée par taille
 * décroissante — un tri stable, qui conserve donc le mélange à taille égale.
 */
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

/**
 * L'ORDRE D'UN ABSOLUT : place source d'abord, catégorie la plus lourde ensuite.
 *
 * Les deux champs sont FOURNIS par l'appelant sur l'entrée (`sourcePlace`,
 * `sourceWeightRank`) : ce module ne connaît ni les podiums ni le référentiel
 * des poids, exactement comme il ne devine ni le club ni le classement.
 *
 * Les deux absences se traitent en sens OPPOSÉ, et ce n'est pas un détail :
 *
 * - `sourcePlace` absente = le combattant n'a pas de podium source (une ceinture
 *   noire entre à l'absolut sans condition de podium). Elle passe DERRIÈRE
 *   toutes les places connues : lui inventer une place le ferait passer devant
 *   des médaillés sur la foi d'une donnée manquante ;
 * - `sourceWeightRank` absent = poids source inconnu. Il passe derrière tous les
 *   poids connus À PLACE ÉGALE, c'est-à-dire qu'il est traité comme le plus
 *   LÉGER — même raison, en sens inverse : le traiter comme le plus lourd lui
 *   offrirait la meilleure graine faute d'information.
 *
 * À égalité complète, l'ordre d'arrivée tranche, comme dans `applyRankBonus` et
 * `applyProtectedRanking`. Le cas est rare et il est nommé : deux personnes ne
 * peuvent partager une place QUE si elles viennent de deux catégories sources
 * différentes de même rang de poids (deux ceintures, un même poids).
 */
function applySourcePlaceOrder(order: readonly BracketEntry[]): BracketEntry[] {
  // Comparaison explicite plutôt qu'une soustraction : les absences valent
  // ±Infinity, et `Infinity - Infinity` est `NaN`, qu'un comparateur de tri lit
  // comme « égal » de façon instable.
  const cmp = (x: number, y: number) => (x < y ? -1 : x > y ? 1 : 0);
  return order
    .map((entry, index) => ({
      entry,
      index,
      place: entry.sourcePlace ?? Number.POSITIVE_INFINITY,
      weight: entry.sourceWeightRank ?? Number.NEGATIVE_INFINITY,
    }))
    .sort((a, b) => cmp(a.place, b.place) || cmp(b.weight, a.weight) || a.index - b.index)
    .map((x) => x.entry);
}

/** Chaque porteur de la clé remonte de `bonus` places ; à égalité, l'ordre d'arrivée tranche. */
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

/** Les `count` premiers du classement prennent les graines 1..count, dans l'ordre du classement. */
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

  // LE SEUL CAS RÉELLEMENT NEUF : plus de protégés que de byes disponibles.
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

// ------------------------------------------------------------------
// Étape 3 : la réparation
// ------------------------------------------------------------------

type Leaf = BracketEntry | null;

function blockSizeOf(scope: SeparationScope, size: number): number {
  const raw = scope.kind === "half" ? size / 2 : 2 ** scope.round;
  // Jamais zéro : un pas nul boucle sans fin. Un bloc d'une feuille ne
  // contient aucune paire, donc ne pénalise rien - ce qui est le bon
  // comportement pour « la moitié » d'un tableau de deux.
  return Math.max(1, Math.floor(raw));
}

/** Pénalité d'une contrainte : le nombre de paires de même clé par bloc, pondéré. */
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

/** Le score : une pénalité par palier, comparée lexicographiquement (palier 0 d'abord). */
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

/**
 * Un échange est INERTE quand aucune contrainte active ne voit de différence
 * entre les deux occupants : l'essayer coûterait un score pour rien. Deux
 * clubmates, ou deux compétiteurs sans club, sont interchangeables ; un
 * compétiteur et un emplacement vide ne le sont jamais.
 */
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

/** Un combat du premier tour sans aucun compétiteur : structurellement interdit. */
function leavesAnEmptyFight(leaves: readonly Leaf[], ...touched: number[]): boolean {
  for (const l of touched) {
    const fight = Math.floor(l / 2);
    if ((leaves[2 * fight] ?? null) === null && (leaves[2 * fight + 1] ?? null) === null) {
      return true;
    }
  }
  return false;
}

/**
 * Amélioration lexicographique par échanges locaux : tant qu'un échange de
 * deux feuilles NON FIGÉES fait strictement baisser le score, l'appliquer.
 *
 * Le parcours (i croissant, puis j > i, premier gain accepté) et le garde-fou
 * de boucle font partie du contrat d'identité : deux ordres de parcours
 * différents donnent deux tableaux différents, tous deux « corrects », et
 * personne ne verrait la bascule.
 */
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

// ------------------------------------------------------------------
// Le pipeline
// ------------------------------------------------------------------

/**
 * Les trois étapes, dans l'ordre. `rng` est le tirage PARTAGÉ du générateur :
 * le pipeline y puise, il ne s'en fabrique jamais un.
 */
export function applySeedingPlan(
  entries: readonly BracketEntry[],
  size: number,
  rng: () => number,
  plan: SeedingPlan = DEFAULT_SEEDING_PLAN,
): SeedingOutcome {
  const warnings: SeedingWarning[] = [];

  // 1. Ordre des graines.
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
    }
  }

  // 2. Placement standard.
  const placement: Leaf[] = seedPositions(size).map((seedNumber) => order[seedNumber - 1] ?? null);

  // 3. Réparation.
  const leaves = repair(placement, plan);

  return { seedOrder: order, placement, leaves, warnings };
}

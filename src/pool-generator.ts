/**
 * LE MOTEUR DE POULES — round-robin par la méthode du cercle.
 *
 * ┌─ CE QUI N'EXISTAIT PAS ───────────────────────────────────────────────────┐
 * │ Aucun round-robin n'existait dans ces dépôts. `BraketFightPool3` n'en est  │
 * │ pas un : malgré son nom, c'est le COMBAT DE 3e PLACE d'un arbre à          │
 * │ élimination directe. Chercher « pool » dans le code d'avant ce lot ne      │
 * │ ramène donc que des fausses pistes.                                        │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * LES COMBATS DE POULE SONT DES LIGNES DE COMBAT ORDINAIRES. `division = 0`,
 * `indexInDivision` = ordre de passage, `type = "BraketFight"`. C'est ce qui
 * évite un cas particulier dans la TV, l'écran opérateur, le planning et le
 * journal : tout ce qui sait lire un `GeneratedFight` sait lire une poule.
 * `division = 0` est libre et non ambigu — un arbre numérote ses divisions à
 * partir de 1 (1 = finale) — et `bracket-propagation.findNextSlot` refuse déjà
 * `division <= 1`, donc un combat de poule ne propage rien tout seul, ce qui
 * est exactement ce qu'on veut : c'est le CLASSEMENT qui décide (pool-ranking).
 *
 * LA MÉTHODE DU CERCLE. Un compétiteur est fixé, les autres tournent d'un cran
 * à chaque tour. n pair : n−1 tours de n/2 combats. n impair : on ajoute un
 * fantôme, ce qui donne n tours de (n−1)/2 combats, et le fantôme désigne à
 * chaque tour celui qui se repose. Dans les deux cas chaque compétiteur
 * combat AU PLUS UNE FOIS par tour, donc le repos est réparti PAR
 * CONSTRUCTION, pas par une passe d'équilibrage qu'il faudrait vérifier.
 *
 * Module pur : aucune IO, aucune dépendance, déterministe pour une graine
 * donnée. Le tirage passe par `prng.ts`, jamais par `Math.random()`.
 */

import type { BracketEntry, GeneratedFight } from "./bracket-generator";
import { fnv1a, mulberry32, shuffle } from "./prng";

export class PoolTooLargeError extends Error {}

/**
 * LE PLAFOND, et pourquoi il n'est pas négociable.
 *
 * Une poule coûte C(n,2) combats là où une élimination en coûte n−1 :
 *
 *   n  |  6  |  8  |  10 |  12 |  16
 *   ---+-----+-----+-----+-----+-----
 *   RR |  15 |  28 |  45 |  66 | 120
 *   ED |   5 |   7 |   9 |  11 |  15
 *
 * À 16 inscrits, la poule demande HUIT FOIS la journée de tatami de l'arbre
 * équivalent. Le plafond par défaut est donc 6 (15 combats, la charge d'un
 * arbre de 16). Au-delà, `category-draw.ts` replie en élimination directe et
 * RAPPORTE le repli.
 */
export const MAX_POOL_SIZE_DEFAULT = 6;

/** Nombre de combats d'une poule de `n` : C(n,2). */
export function poolFightCount(n: number): number {
  return n < 2 ? 0 : (n * (n - 1)) / 2;
}

/** Nombre de tours d'une poule de `n` : n−1 si n est pair, n s'il est impair. */
export function poolRoundCount(n: number): number {
  if (n < 2) return 0;
  return n % 2 === 0 ? n - 1 : n;
}

/**
 * LES DEUX TAILLES OÙ « PERSONNE N'ENCHAÎNE » EST STRUCTURELLEMENT IMPOSSIBLE.
 *
 * Ce n'est pas une faiblesse de la passe d'ajustement : AUCUN ordre des
 * combats ne convient, quelle que soit la méthode.
 *
 * - n = 3 : trois combats, trois compétiteurs. Deux combats consécutifs
 *   mobilisent 4 places pour 3 personnes — au moins une revient (tiroirs).
 * - n = 4 : six combats. Le seul combat disjoint de {a,b} est {c,d}, et ces
 *   deux-là sont exactement les deux combats d'un même tour, donc déjà joués
 *   l'un après l'autre. Le graphe de compatibilité des six combats est un
 *   couplage parfait (trois arêtes disjointes) : il n'admet aucun chemin
 *   hamiltonien, et la plus longue suite sans enchaînement vaut 2.
 *
 * Les deux bornes sont vérifiées par ÉNUMÉRATION EXHAUSTIVE dans
 * `tests/pool-generator.test.ts`, pas déduites de ce commentaire.
 *
 * Ce que la poule fait alors : elle le DIT (`PoolWarning`) au lieu de le
 * masquer. Ce qui compense, c'est le tampon de repos du planning
 * (`bufferSeconds`, 60 s par défaut, entre deux combats du même tatami) — un
 * répit court mais réel, et c'est à l'organisateur de savoir qu'il repose sur
 * lui, pas au générateur d'en décider à sa place.
 */
export const POOL_SIZES_WITHOUT_REST: readonly number[] = [3, 4];

/** Un tour de poule : les combats qui s'y jouent, et qui s'y repose. */
export type PoolRound = {
  readonly round: number;
  /** `indexInDivision` des combats de ce tour, dans l'ordre de passage. */
  readonly fightIndexes: readonly number[];
  /** Le compétiteur au repos (n impair), ou `null` (n pair). */
  readonly restingRegistrationId: string | null;
};

/**
 * Ce que la poule n'a pas pu tenir. RAPPORTÉ, jamais tu — un enchaînement
 * subi sans le savoir se lit sur le tatami, pas dans le planning.
 */
export type PoolWarning = {
  readonly code: "back-to-back-unavoidable";
  readonly competitorCount: number;
  /** Nombre d'enchaînements subsistants. */
  readonly occurrences: number;
  /** `indexInDivision` du SECOND combat de chaque enchaînement. */
  readonly fightIndexes: readonly number[];
};

export type PoolResult =
  | { readonly kind: "empty" }
  | { readonly kind: "single"; readonly registrationId: string }
  | {
      readonly kind: "pool";
      /** L'ordre de poule, après tirage. C'est lui qui fixe le cercle. */
      readonly competitorIds: readonly string[];
      /** Des lignes de combat ORDINAIRES : division 0, index = ordre de passage. */
      readonly fights: GeneratedFight[];
      readonly rounds: readonly PoolRound[];
      /** Une poule n'a pas de bye : c'est C(n,2). */
      readonly realFightCount: number;
      /** Clé ABSENTE quand il n'y a rien à dire. */
      readonly warnings?: PoolWarning[];
    };

// ------------------------------------------------------------------
// La méthode du cercle
// ------------------------------------------------------------------

/** Une paire d'indices dans `competitorIds` ; `-1` = le fantôme (n impair). */
type Pairing = readonly [number, number];

const PHANTOM = -1;

/**
 * Les tours bruts de la méthode du cercle, sur les indices `0..n-1`.
 *
 * Le siège 0 est fixe, les autres tournent d'un cran par tour. C'est cette
 * rotation, et elle seule, qui garantit que chaque paire se rencontre
 * EXACTEMENT une fois : les n−1 (ou n) tours produisent n(n−1)/2 appariements
 * tous distincts.
 */
function circleRounds(n: number): Pairing[][] {
  const odd = n % 2 === 1;
  const m = odd ? n + 1 : n;
  let seats: number[] = [];
  for (let i = 0; i < n; i++) seats.push(i);
  if (odd) seats.push(PHANTOM);

  const rounds: Pairing[][] = [];
  for (let r = 0; r < m - 1; r++) {
    const pairs: Pairing[] = [];
    for (let i = 0; i < m / 2; i++) {
      const a = seats[i] ?? PHANTOM;
      const b = seats[m - 1 - i] ?? PHANTOM;
      // La paire au fantôme n'est pas un combat : c'est un repos.
      if (a !== PHANTOM && b !== PHANTOM) pairs.push([a, b]);
    }
    rounds.push(pairs);
    const head = seats[0] ?? PHANTOM;
    const rest = seats.slice(1);
    const tail = rest.pop();
    if (tail !== undefined) rest.unshift(tail);
    seats = [head, ...rest];
  }
  return rounds;
}

/** Qui se repose à chaque tour, ou `null` partout si n est pair. */
function restingPerRound(n: number, rounds: readonly Pairing[][]): (number | null)[] {
  if (n % 2 === 0) return rounds.map(() => null);
  return rounds.map((pairs) => {
    const busy = new Set<number>();
    for (const [a, b] of pairs) {
      busy.add(a);
      busy.add(b);
    }
    for (let i = 0; i < n; i++) if (!busy.has(i)) return i;
    return null;
  });
}

function sharesCompetitor(x: Pairing, y: Pairing): boolean {
  return x[0] === y[0] || x[0] === y[1] || x[1] === y[0] || x[1] === y[1];
}

/**
 * LA PASSE D'AJUSTEMENT : personne n'enchaîne à la charnière entre deux tours.
 *
 * À l'intérieur d'un tour, aucun enchaînement n'est possible — les combats y
 * sont disjoints par construction. Le seul point de contact est donc la
 * CHARNIÈRE : le dernier combat du tour r et le premier du tour r+1. La passe
 * permute les combats À L'INTÉRIEUR de chaque tour (jamais entre deux tours,
 * ce qui détruirait la répartition du repos) pour mettre en tête un combat
 * disjoint du précédent.
 *
 * Le parcours est déterministe : premier candidat non conflictuel dans l'ordre
 * du cercle. Deux parcours différents donneraient deux planning corrects mais
 * différents, et personne ne verrait la bascule.
 *
 * Mesuré sur n = 2..32 : la passe ramène les enchaînements à ZÉRO pour tout
 * n ≥ 5, y compris n = 5 où le cercle brut en laisse deux. Elle n'y arrive pas
 * à n = 3 ni à n = 4, et c'est démontré impossible (`POOL_SIZES_WITHOUT_REST`).
 */
function adjustHinges(rounds: Pairing[][]): { rounds: Pairing[][]; unresolvedRounds: number[] } {
  const out = rounds.map((r) => [...r]);
  const unresolvedRounds: number[] = [];

  for (let r = 1; r < out.length; r++) {
    const previous = out[r - 1] ?? [];
    const current = out[r] ?? [];
    const last = previous[previous.length - 1];
    const first = current[0];
    if (!last || !first) continue;
    if (!sharesCompetitor(last, first)) continue;

    let swapWith = -1;
    for (let i = 1; i < current.length; i++) {
      const candidate = current[i];
      if (candidate && !sharesCompetitor(last, candidate)) {
        swapWith = i;
        break;
      }
    }
    if (swapWith < 0) {
      unresolvedRounds.push(r);
      continue;
    }
    const head = current[0] as Pairing;
    current[0] = current[swapWith] as Pairing;
    current[swapWith] = head;
  }

  return { rounds: out, unresolvedRounds };
}

// ------------------------------------------------------------------
// Génération
// ------------------------------------------------------------------

/**
 * La poule d'une catégorie.
 *
 * POURQUOI LE PIPELINE DE PLACEMENT (`seeding-plan.ts`) N'EST PAS RÉUTILISÉ.
 * Ses contraintes séparent des gens qui ne DOIVENT pas se rencontrer trop
 * tôt ; en poule tout le monde rencontre tout le monde, et « pas au premier
 * tour » n'a plus de contenu. Le seul degré de liberté restant est l'ORDRE DE
 * PASSAGE, et il se tire simplement — avec le tirage PARTAGÉ, donc rejouable :
 * un club qui conteste l'ordre reçoit la graine, pas une explication.
 *
 * `maxSize` est un GARDE-FOU DU MOTEUR, et il lève : un appelant direct qui
 * demanderait une poule de 20 obtiendrait 190 combats sans s'en apercevoir.
 * La POLITIQUE de repli, elle, vit dans `category-draw.ts`, qui vérifie avant
 * d'appeler et n'atteint donc jamais cette exception.
 */
export function generatePool(
  entries: readonly BracketEntry[],
  seed: string,
  opts: { maxSize?: number } = {},
): PoolResult {
  const n = entries.length;
  if (n === 0) return { kind: "empty" };
  const first = entries[0];
  if (n === 1 && first) return { kind: "single", registrationId: first.registrationId };

  const maxSize = opts.maxSize ?? MAX_POOL_SIZE_DEFAULT;
  if (n > maxSize) {
    throw new PoolTooLargeError(
      `Poule de ${n} inscrits pour un plafond de ${maxSize} : ${poolFightCount(n)} combats ` +
        `au lieu de ${n - 1} en élimination directe. Le repli est une décision de format ` +
        `(voir generateCategoryDraw), pas une décision du moteur.`,
    );
  }

  const rng = mulberry32(fnv1a(seed));
  const ordered = shuffle(entries, rng);
  const competitorIds = ordered.map((e) => e.registrationId);

  const raw = circleRounds(n);
  const resting = restingPerRound(n, raw);
  const adjusted = adjustHinges(raw);

  // Aplatissement : l'ordre des tours, puis l'ordre à l'intérieur du tour.
  // `indexInDivision` EST l'ordre de passage, et c'est tout ce que la TV,
  // l'écran opérateur et le planning ont besoin de savoir.
  const fights: GeneratedFight[] = [];
  const rounds: PoolRound[] = [];
  adjusted.rounds.forEach((pairs, r) => {
    const fightIndexes: number[] = [];
    for (const [a, b] of pairs) {
      fightIndexes.push(fights.length);
      fights.push({
        division: 0,
        indexInDivision: fights.length,
        type: "BraketFight",
        slotA: competitorIds[a] ?? null,
        slotB: competitorIds[b] ?? null,
        isBye: false,
      });
    }
    const rest = resting[r] ?? null;
    rounds.push({
      round: r + 1,
      fightIndexes,
      restingRegistrationId: rest === null ? null : (competitorIds[rest] ?? null),
    });
  });

  // Le rapport d'enchaînement se relit sur la sortie APLATIE, et non sur les
  // charnières prévues : c'est la suite réellement jouée qui compte.
  const backToBack: number[] = [];
  for (let i = 1; i < fights.length; i++) {
    const previous = fights[i - 1];
    const current = fights[i];
    if (!previous || !current) continue;
    const shared =
      previous.slotA === current.slotA ||
      previous.slotA === current.slotB ||
      previous.slotB === current.slotA ||
      previous.slotB === current.slotB;
    if (shared) backToBack.push(current.indexInDivision);
  }

  const warnings: PoolWarning[] =
    backToBack.length > 0
      ? [
          {
            code: "back-to-back-unavoidable",
            competitorCount: n,
            occurrences: backToBack.length,
            fightIndexes: backToBack,
          },
        ]
      : [];

  return {
    kind: "pool",
    competitorIds,
    fights,
    rounds,
    realFightCount: fights.length,
    // Clé ABSENTE quand il n'y a rien à dire : une poule sans enchaînement ne
    // doit pas porter un tableau vide que l'appelant pourrait afficher.
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

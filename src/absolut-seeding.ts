/**
 * LE SEEDING DE L'ABSOLUT.
 *
 * Un absolut réunit les MÉDAILLÉS de plusieurs catégories sources dans une
 * catégorie sans limite de poids. Son tirage a deux exigences, et elles ne sont
 * pas de même nature : la première est un ORDRE, la seconde une SÉPARATION.
 *
 *   1. l'ordre des graines suit la PLACE obtenue dans la catégorie source ; à
 *      place égale, la catégorie de poids la plus LOURDE passe devant ;
 *   2. deux médaillés d'une MÊME catégorie source ne doivent pas se retrouver
 *      au premier tour — ils viennent de se rencontrer, parfois en finale.
 *
 * ┌─ NI L'UNE NI L'AUTRE N'EST UN PLACEMENT PARALLÈLE ─────────────────────────┐
 * │ Les deux s'expriment dans le pipeline de `seeding-plan.ts`, qui existe      │
 * │ exactement pour ça : l'ordre est une règle d'étape 1 (`source-place`), la   │
 * │ séparation est une contrainte d'étape 3 sur une nouvelle clé               │
 * │ (`source-category`), de la même famille que l'anti-club.                    │
 * │                                                                            │
 * │ Un second placement écrit à côté aurait sa propre notion de bye, sa propre  │
 * │ passe d'échanges et sa propre façon de compter les paires — et les deux     │
 * │ divergeraient en silence, puisque rien ne les confronte. Ce module ne fait  │
 * │ donc que TRADUIRE le vocabulaire de l'absolut vers celui du pipeline.       │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * L'ABSOLUT NE SE TIRE PAS AU SORT, IL SE CLASSE. `ABSOLUT_SEEDING_PLAN`
 * n'active aucune règle qui consomme le tirage : l'entrelacement anti-club est
 * ÉTEINT (il mélangerait les graines, donc détruirait l'ordre par place), et
 * l'ordre par place source est un tri. Deux graines de compétition différentes
 * rendent donc le même absolut, ce que `tests/absolut-seeding.test.ts` affirme.
 *
 * Module pur : aucune IO, aucune dépendance.
 */

import {
  generateBracket,
  type BracketEntry,
  type BracketResult,
  type ThirdPlaceMode,
} from "./bracket-generator";
import { resolveWeightClass } from "./db-vocabulary";
import { WEIGHT_CLASSES } from "./referential";
import { applySeedingPlan, SeedingPlanError, type SeedingPlan } from "./seeding-plan";

// ===================================================================
// Le vocabulaire de la base, traduit une seule fois
// ===================================================================

/**
 * Une inscription à un absolut, telle que `competition_absolut_registrations`
 * la porte (lot 2f, PR plateforme #756).
 *
 * `sourcePlace` et `sourceCategoryId` y sont FIGÉS à l'inscription : un podium
 * source corrigé après coup ne doit pas changer rétroactivement un tirage déjà
 * annoncé. Ce module ne les recalcule donc jamais, il les lit.
 */
export type AbsolutRegistration = {
  readonly registrationId: string;
  /** Club, pour l'anti-club. `null` est accepté : il ne sépare de personne. */
  readonly clubId?: string | null;
  /** La catégorie d'où vient le médaillé. Clé de la séparation du premier tour. */
  readonly sourceCategoryId?: string | null;
  /** La place obtenue dans cette catégorie : 1, 2 ou 3. */
  readonly sourcePlace?: number | null;
  /**
   * La classe de poids de la catégorie source, VALEUR BRUTE de la base : un nom
   * (`"Leve"`) ou un indice (`"3"`). `db-vocabulary.resolveWeightClass` sait
   * déjà lire les deux vocabulaires de la colonne ; ce module n'en réécrit pas
   * un troisième.
   */
  readonly sourceWeightClass?: string | null;
  /**
   * `active` | `cancelled`. Une inscription d'absolut n'est JAMAIS supprimée
   * (un désistement pris au micro doit rester rejouable s'il est contesté) :
   * la table garde donc des lignes qu'il ne faut pas placer.
   */
  readonly status?: "active" | "cancelled";
};

/**
 * Rang de poids d'une catégorie source : 0 pour la plus légère, 8 pour la plus
 * lourde, `null` si la valeur n'est pas lisible.
 *
 * `null` n'est pas 0. Un poids illisible traité comme « Galo » ferait passer le
 * combattant pour le plus léger de l'absolut sur la foi d'une donnée absente ;
 * `applySourcePlaceOrder` le range derrière les poids CONNUS, ce qui est le
 * même verdict mais pour la bonne raison, et se dit à l'écran.
 */
export function sourceWeightRank(stored: string | null | undefined): number | null {
  const resolved = resolveWeightClass(stored);
  if (resolved === null) return null;
  const rank = (WEIGHT_CLASSES as readonly string[]).indexOf(resolved);
  return rank < 0 ? null : rank;
}

/**
 * Les inscriptions ACTIVES, traduites en entrées de tableau.
 *
 * LE FILTRE DES ANNULÉES EST ICI, ET C'EST DÉLIBÉRÉ. La table conserve les
 * désistements en `cancelled` pour toujours ; un appelant qui oublie le filtre
 * ne voit rien d'anormal — il obtient un tableau complet, avec un absent placé
 * dedans, et la faute se découvre au bord du tapis. La seule place sûre pour ce
 * filtre est le point d'entrée du tirage.
 */
export function absolutEntries(registrations: readonly AbsolutRegistration[]): BracketEntry[] {
  return registrations
    .filter((r) => (r.status ?? "active") !== "cancelled")
    .map((r) => ({
      registrationId: r.registrationId,
      clubId: r.clubId ?? null,
      sourceCategoryId: r.sourceCategoryId ?? null,
      sourcePlace: r.sourcePlace ?? null,
      sourceWeightRank: sourceWeightRank(r.sourceWeightClass),
    }));
}

// ===================================================================
// Le plan
// ===================================================================

/**
 * LE PLAN DE TIRAGE D'UN ABSOLUT, énoncé en entier plutôt que dérivé du plan
 * par défaut : ce n'est pas « le tirage habituel avec une option », c'est un
 * autre tirage, et une règle ajoutée un jour au plan par défaut n'a aucune
 * raison de s'inviter ici sans qu'on l'ait décidé.
 *
 * TROIS PALIERS, ET LEUR ORDRE EST L'ARGUMENT :
 *
 * - palier 0, même catégorie source au premier tour. Plus fort que l'anti-club,
 *   parce que ces deux-là viennent LITTÉRALEMENT de se battre : les réapparier
 *   d'entrée transforme l'absolut en rejeu de la finale précédente ;
 * - palier 1, même club au premier tour ;
 * - palier 2, même club dans le même quart de tableau.
 *
 * CE QUI N'Y FIGURE PAS, ET POURQUOI. Aucune contrainte « même catégorie source
 * dans le même quart » : la consigne ne demande que le premier tour, et chaque
 * contrainte ajoutée fait bouger des gens par rapport à leur place classée. Le
 * seeding par place est la garantie principale ; on ne l'érode que pour ce
 * qu'on a décidé de payer.
 *
 * ET `interleave` EST ÉTEINT — mais PAS pour la raison qu'on croit, et c'est la
 * mesure qui a corrigé ce commentaire. Placé AVANT l'ordre par place, comme il
 * l'est ici, l'entrelacement ne détruit rien du tout : le tri par (place,
 * poids) est TOTAL sur les médaillés et efface le mélange. Ce qu'il change
 * réellement tient en deux points, et chacun suffit à le laisser éteint :
 *
 * - il CONSOMME le tirage, donc l'absolut cesserait d'être rejouable depuis son
 *   seul classement — « voici la graine, rejouez » remplacerait « voici le
 *   classement, vérifiez », alors qu'un absolut se conteste sur les places ;
 * - il n'agit plus que sur les ÉGALITÉS COMPLÈTES (même place, même rang de
 *   poids). Mesuré sur le corpus de `tests/absolut-seeding.test.ts` : 7 graines
 *   sur 10 échangent les deux ceintures noires sans podium, et NE TOUCHENT À
 *   RIEN D'AUTRE.
 *
 * Placé APRÈS l'ordre par place, en revanche, il détruirait tout. L'ORDRE DES
 * ÉTAPES EST PORTANT, et le test le montre plutôt que de le supposer.
 */
export const ABSOLUT_SEEDING_PLAN: SeedingPlan = {
  order: [
    { kind: "interleave", enabled: false, key: "club" },
    { kind: "source-place", enabled: true },
  ],
  constraints: [
    {
      name: "meme-categorie-source-premier-tour",
      enabled: true,
      key: "source-category",
      scope: { kind: "round", round: 1 },
      tier: 0,
      weight: 1,
    },
    {
      name: "meme-club-premier-tour",
      enabled: true,
      key: "club",
      scope: { kind: "round", round: 1 },
      tier: 1,
      weight: 1,
    },
    {
      name: "meme-club-quart-de-tableau",
      enabled: true,
      key: "club",
      scope: { kind: "round", round: 2 },
      tier: 2,
      weight: 1,
    },
  ],
  pins: [{ kind: "empty-leaves" }],
};

// ===================================================================
// L'ordre des graines, rendu lisible
// ===================================================================

/**
 * Un tirage d'absolut ne consomme AUCUN aléa. Ce générateur le prouve au lieu
 * de le supposer : si une règle consommatrice était un jour allumée dans
 * `ABSOLUT_SEEDING_PLAN`, `absolutSeedOrder` échouerait bruyamment plutôt que
 * de rendre un ordre stable par accident (un `() => 0` aurait rendu un mélange
 * parfaitement déterministe, donc invisible).
 */
const TIRAGE_INTERDIT = (): number => {
  throw new SeedingPlanError(
    "Absolut : une règle du plan a consommé le tirage. L'ordre d'un absolut est un " +
      "classement par place source, pas un tirage au sort - vérifiez ABSOLUT_SEEDING_PLAN.",
  );
};

/**
 * Les inscriptions dans l'ORDRE DES GRAINES, du n°1 au dernier. C'est l'ordre à
 * afficher dans la console podium : un absolut se conteste, et « voici le
 * classement des graines » est la réponse.
 *
 * Rendu par le pipeline lui-même, jamais par un tri recopié ici : deux tris
 * jumeaux finiraient par diverger, et la divergence serait muette.
 */
export function absolutSeedOrder(
  registrations: readonly AbsolutRegistration[],
): AbsolutRegistration[] {
  const entries = absolutEntries(registrations);
  if (entries.length === 0) return [];
  const size = 2 ** Math.ceil(Math.log2(Math.max(2, entries.length)));
  const outcome = applySeedingPlan(entries, size, TIRAGE_INTERDIT, ABSOLUT_SEEDING_PLAN);
  const byId = new Map(registrations.map((r) => [r.registrationId, r]));
  const out: AbsolutRegistration[] = [];
  for (const entry of outcome.seedOrder) {
    const found = byId.get(entry.registrationId);
    if (found) out.push(found);
  }
  return out;
}

/**
 * Le tableau d'un absolut. Même générateur, même arbre, mêmes identités de
 * combats que n'importe quelle catégorie : c'est tout l'intérêt d'avoir
 * matérialisé de vraies inscriptions côté base plutôt que des colonnes dédiées.
 */
export function generateAbsolutBracket(
  registrations: readonly AbsolutRegistration[],
  seed: string,
  opts: { thirdPlaceMode: ThirdPlaceMode },
): BracketResult {
  return generateBracket(absolutEntries(registrations), seed, {
    thirdPlaceMode: opts.thirdPlaceMode,
    seedingPlan: ABSOLUT_SEEDING_PLAN,
  });
}

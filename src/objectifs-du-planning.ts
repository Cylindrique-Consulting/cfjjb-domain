import { findFeederFight, type PropagationFight, type Slot } from "./bracket-propagation";
import { branchesDuPlan, ecartDesBranchesMs } from "./convergence-des-branches";
import { multiplicateurDeRepos } from "./fight-rest";
import {
  ESPACEMENT_PAR_DEFAUT_SECONDES,
  type CombatAPlanifier,
  type EntreeDePlanification,
  type PlacementDeCombat,
  type ResultatDePlanification,
} from "./ordonnanceur-planning";
import { estNombreDeTatamisAdmis, partiesDuCombat } from "./repartition-tatamis";

/**
 * LES OBJECTIFS DU PLANNING ET LA COMPARAISON DE DEUX PLANS (§18 de la
 * spécification du générateur, réponse ORD.9 B du client du 25/09/2026).
 *
 * Le §18 classe six objectifs d'optimisation, dans cet ordre :
 *
 *   1. réduire l'heure de fin globale ;
 *   2. éviter qu'un tatami reste inutilisé lorsqu'un combat peut être lancé ;
 *   3. répartir intelligemment les grands tableaux sur plusieurs tatamis ;
 *   4. respecter la hiérarchie qualitative des tatamis ;
 *   5. conserver autant que possible les branches sur leurs tatamis ;
 *   6. offrir un repos supérieur au minimum lorsque cela ne pénalise pas la
 *      compétition.
 *
 * ORD.9 B : « Marge de 5 minutes : entre deux organisations dont les heures de
 * fin diffèrent de moins de 5 minutes, les objectifs suivants départagent, dans
 * l'ordre du §18. » `comparerLesPlans` applique cet ordre à deux évaluations
 * d'une même journée (`evaluerLaJournee`). Les objectifs mesurés en temps (2 et
 * l'écart des branches du 3) gardent la même marge : un écart de moins de 5
 * minutes y compte pour une égalité, comme pour l'heure de fin. Les autres se
 * comparent exactement. Si tout est égal, la fin la plus précoce l'emporte.
 */

/** ORD.9 B : deux fins de journée à moins de 5 minutes l'une de l'autre sont départagées par les objectifs suivants. */
export const MARGE_ENTRE_PLANS_MINUTES = 5;

const MINUTE_MS = 60_000;

/** Les objectifs du §18, dans l'ordre. */
export const OBJECTIFS_DU_PLANNING = [
  "fin_de_journee",
  "tatami_inutilise",
  "repartition_des_tableaux",
  "hierarchie_des_tatamis",
  "continuite_des_branches",
  "repos_de_confort",
] as const;

export type ObjectifDuPlanning = (typeof OBJECTIFS_DU_PLANNING)[number];

/** Le dernier rang de la liste du §8 (`rangTatamiPrioritaire` : ceinture ou tranche inconnue). */
const DERNIER_RANG_PRIORITAIRE = 13;

export type EvaluationDeJournee = {
  jour: number;
  /**
   * Combats joués (hors bye) des catégories de la journée restés sans horaire :
   * un préalable plutôt qu'un objectif, le plan qui en laisse le moins
   * l'emporte toujours.
   */
  combatsSansHoraire: number;
  /** 1. Fin du dernier combat de la journée, null sans combat. */
  finMs: number | null;
  /**
   * 2. Temps pendant lequel un tatami reste vide alors qu'un combat de sa file
   * pourrait commencer : ses sources sont jouées et ses athlètes ont eu le
   * repos que le plan leur accorde (réglementaire, ou de confort quand le plan
   * l'offre, RPS.5 A). Une branche décalée qui attend alors qu'elle pourrait
   * partir compte.
   */
  tatamiInutiliseMs: number;
  /** 3a. Catégories réparties sur un nombre de tatamis qui n'est pas 2, 4 ou 8 (REP.1 A). */
  repartitionsDesequilibrees: number;
  /** 3b. Somme, sur les catégories réparties, de l'écart entre la fin de leur première et de leur dernière branche (§9, REP.6 A). */
  ecartDesBranchesMs: number;
  /**
   * 4. Écart à la hiérarchie des tatamis : pour chaque combat joué dans sa
   * branche (hors regroupement), le poids de sa catégorie dans la liste du §8
   * (13 pour la noire adulte, 1 au dernier rang) fois le rang de qualité de
   * son tatami moins un. Nul quand chacun est sur un meilleur tatami.
   */
  ecartALaHierarchie: number;
  /** 5a. Parcours d'athlète, du premier combat à la finale, qui passent par trois tatamis ou plus (§12). */
  parcoursSurTroisTatamis: number;
  /** 5b. Changements de tatami sur l'ensemble de ces parcours. */
  changementsDeTatami: number;
  /**
   * 6. Repos de confort manqués : un combat dont un athlète, venu d'un combat
   * de la même catégorie, a moins de deux durées réglementaires de repos
   * (§11, RPS.4 A). La finale en a toujours deux, au minimum réglementaire.
   */
  reposDeConfortManques: number;
};

export type ContexteDEvaluation = {
  /** Rang de qualité de chaque tatami, 1 = meilleur (ORD.2 A). Absent : 1. */
  rangQualiteParTatami?: ReadonlyMap<string, number>;
  /** Rang de chaque catégorie dans la liste du §8, 1 = prioritaire. Absent : le dernier. */
  rangPrioritaireParCategorie?: ReadonlyMap<string, number>;
  /** Nombre de parties de chaque catégorie répartie (1 à 8). Absent : une. */
  partiesParCategorie?: ReadonlyMap<string, number>;
  /** Sources de chaque combat (`sourcesDesCombats`), quand l'appelant les garde déjà. */
  sources?: ReadonlyMap<string, readonly (string | null)[]>;
};

export type CombatPourLesSources = Pick<
  CombatAPlanifier,
  "id" | "categorieId" | "division" | "indexInDivision" | "type" | "isBye" | "athletes"
>;

const SLOTS: readonly Slot[] = ["A", "B"];

function versPropagation(combat: CombatPourLesSources): PropagationFight {
  return {
    id: combat.id,
    division: combat.division,
    indexInDivision: combat.indexInDivision,
    type: combat.type,
    slotA: combat.athletes?.[0] ?? null,
    slotB: combat.athletes?.[1] ?? null,
    isBye: combat.isBye === true,
    state: "scheduled",
    winner: null,
    winMethod: null,
    needsArbitration: false,
    version: 0,
  };
}

/**
 * Le combat qui fournit chaque coin d'un combat, dans sa catégorie : null pour
 * un athlète déjà connu ou venu d'un bye. Même lecture que l'ordonnanceur.
 */
export function sourcesDesCombats(
  combats: readonly CombatPourLesSources[],
): Map<string, (string | null)[]> {
  const parCategorie = new Map<string, CombatPourLesSources[]>();
  for (const combat of combats) {
    const liste = parCategorie.get(combat.categorieId);
    if (liste) liste.push(combat);
    else parCategorie.set(combat.categorieId, [combat]);
  }
  const byes = new Set(combats.filter((c) => c.isBye === true).map((c) => c.id));
  const sources = new Map<string, (string | null)[]>();
  for (const liste of parCategorie.values()) {
    const proxies = liste.map(versPropagation);
    for (const combat of liste) {
      const proxy = versPropagation(combat);
      sources.set(
        combat.id,
        SLOTS.map((slot, rang) => {
          if ((combat.athletes?.[rang] ?? null) !== null) return null;
          const nourricier = findFeederFight(proxies, proxy, slot);
          if (nourricier === null || byes.has(nourricier.id)) return null;
          return nourricier.id;
        }),
      );
    }
  }
  return sources;
}

function estPuissanceDeDeux(n: number): boolean {
  return n >= 1 && (n & (n - 1)) === 0;
}

/**
 * Les mesures des six objectifs du §18 sur UNE journée d'un plan calculé par
 * `planifierCombats` : l'entrée donnée à l'ordonnanceur et son résultat.
 */
export function evaluerLaJournee(
  entree: EntreeDePlanification,
  resultat: ResultatDePlanification,
  jour: number,
  contexte: ContexteDEvaluation = {},
): EvaluationDeJournee {
  const espacementMs =
    Math.max(0, entree.espacementSecondes ?? ESPACEMENT_PAR_DEFAUT_SECONDES) * 1000;
  const categories = new Map(entree.categories.map((c) => [c.id, c] as const));
  const tatamis = new Map(entree.tatamis.map((t) => [t.id, t] as const));
  const sources = contexte.sources ?? sourcesDesCombats(entree.combats);

  const places: Array<{ combat: CombatAPlanifier; place: PlacementDeCombat }> = [];
  for (const combat of entree.combats) {
    const place = resultat.combats.get(combat.id);
    if (place !== undefined && place.jour === jour) places.push({ combat, place });
  }
  const placeDe = (id: string | null): PlacementDeCombat | undefined =>
    id === null ? undefined : resultat.combats.get(id);
  const dureeMs = (combat: CombatAPlanifier): number =>
    Math.max(0, categories.get(combat.categorieId)?.dureeSecondes ?? 0) * 1000;

  const finOccupation = new Map<string, number>();
  for (const creneau of entree.occupations ?? []) {
    if (!Number.isFinite(creneau.finMs)) continue;
    const avant = finOccupation.get(creneau.athleteId);
    finOccupation.set(
      creneau.athleteId,
      avant === undefined ? creneau.finMs : Math.max(avant, creneau.finMs),
    );
  }

  // 2. Un tatami vide alors qu'un combat de sa file pourrait commencer.
  const parPiste = new Map<string, Array<{ combat: CombatAPlanifier; place: PlacementDeCombat }>>();
  for (const element of places) {
    const liste = parPiste.get(element.place.tatamiId);
    if (liste) liste.push(element);
    else parPiste.set(element.place.tatamiId, [element]);
  }
  let tatamiInutiliseMs = 0;
  for (const [tatamiId, liste] of parPiste) {
    liste.sort((a, b) => a.place.debutMs - b.place.debutMs || a.place.rang - b.place.rang);
    const prevu = tatamis.get(tatamiId)?.debutParJour[jour];
    const plancher = entree.debutAuPlusTotMs;
    const premier = liste[0]?.place.debutMs ?? 0;
    const ancrage =
      prevu === undefined
        ? (plancher ?? premier)
        : plancher === undefined
          ? prevu
          : Math.max(prevu, plancher);
    const prets = liste.map(({ combat }) => {
      const confort =
        entree.reposDeConfort === true ||
        categories.get(combat.categorieId)?.reposDeConfort === true;
      const reposMs = (confort ? 2 : multiplicateurDeRepos(combat)) * dureeMs(combat);
      let pret = ancrage;
      const sourcesDuCombat = sources.get(combat.id);
      for (let rang = 0; rang < 2; rang += 1) {
        const athlete = combat.athletes?.[rang] ?? null;
        if (athlete !== null) {
          const fin = finOccupation.get(athlete);
          if (fin !== undefined) pret = Math.max(pret, fin + reposMs);
          continue;
        }
        const source = placeDe(sourcesDuCombat?.[rang] ?? null);
        if (source !== undefined) pret = Math.max(pret, source.finMs + reposMs);
      }
      return pret;
    });
    const pretAuPlusTot = new Array<number>(prets.length);
    let minimum = Number.POSITIVE_INFINITY;
    for (let index = prets.length - 1; index >= 0; index -= 1) {
      minimum = Math.min(minimum, prets[index] ?? Number.POSITIVE_INFINITY);
      pretAuPlusTot[index] = minimum;
    }
    let libre = ancrage;
    liste.forEach(({ place }, index) => {
      if (place.debutMs > libre) {
        const attente = Math.max(libre, pretAuPlusTot[index] ?? Number.POSITIVE_INFINITY);
        if (place.debutMs > attente) tatamiInutiliseMs += place.debutMs - attente;
      }
      libre = Math.max(libre, place.finMs + espacementMs);
    });
  }

  // 3, 4 et 5 : catégorie par catégorie.
  const parCategorie = new Map<
    string,
    Array<{ combat: CombatAPlanifier; place: PlacementDeCombat }>
  >();
  for (const element of places) {
    const liste = parCategorie.get(element.combat.categorieId);
    if (liste) liste.push(element);
    else parCategorie.set(element.combat.categorieId, [element]);
  }
  let repartitionsDesequilibrees = 0;
  let ecartDesBranches = 0;
  let ecartALaHierarchie = 0;
  let parcoursSurTroisTatamis = 0;
  let changementsDeTatami = 0;
  for (const [categorieId, liste] of parCategorie) {
    const partiesLues = contexte.partiesParCategorie?.get(categorieId) ?? 1;
    const parties = partiesLues > 1 && estNombreDeTatamisAdmis(partiesLues) ? partiesLues : 1;
    const rangPrioritaire =
      contexte.rangPrioritaireParCategorie?.get(categorieId) ?? DERNIER_RANG_PRIORITAIRE;
    const poids = Math.max(1, DERNIER_RANG_PRIORITAIRE + 1 - rangPrioritaire);
    for (const { combat, place } of liste) {
      if (parties > 1 && partiesDuCombat(combat, parties).convergence) continue;
      const rangQualite = contexte.rangQualiteParTatami?.get(place.tatamiId) ?? 1;
      ecartALaHierarchie += poids * Math.max(0, rangQualite - 1);
    }
    if (parties <= 1) continue;
    if (!estPuissanceDeDeux(parties)) repartitionsDesequilibrees += 1;
    ecartDesBranches += ecartDesBranchesMs(
      branchesDuPlan(
        liste.map(({ combat }) => combat),
        parties,
        new Map(liste.map(({ combat, place }) => [combat.id, place] as const)),
      ),
    );
    const parent = new Map<string, string>();
    for (const { combat } of liste) {
      for (const source of sources.get(combat.id) ?? []) {
        if (source !== null && !parent.has(source)) parent.set(source, combat.id);
      }
    }
    for (const { combat, place } of liste) {
      const entrants = (sources.get(combat.id) ?? [null, null]).filter(
        (source) => source === null || placeDe(source) === undefined,
      ).length;
      if (entrants === 0) continue;
      const vus = new Set<string>([place.tatamiId]);
      let suivant = parent.get(combat.id);
      const parcourus = new Set<string>([combat.id]);
      while (suivant !== undefined && !parcourus.has(suivant)) {
        parcourus.add(suivant);
        const tatami = placeDe(suivant)?.tatamiId;
        if (tatami !== undefined) vus.add(tatami);
        suivant = parent.get(suivant);
      }
      if (vus.size >= 3) parcoursSurTroisTatamis += entrants;
      changementsDeTatami += entrants * (vus.size - 1);
    }
  }

  // 6. Repos de confort manqués.
  let reposDeConfortManques = 0;
  for (const { combat, place } of places) {
    const cible = 2 * dureeMs(combat);
    for (const sourceId of sources.get(combat.id) ?? []) {
      const source = placeDe(sourceId);
      if (source === undefined) continue;
      if (place.debutMs - source.finMs < cible) reposDeConfortManques += 1;
    }
  }

  const categoriesDuJour = new Set(
    entree.categories.filter((c) => c.jour === jour).map((c) => c.id),
  );
  const combatsSansHoraire = entree.combats.filter(
    (combat) =>
      combat.isBye !== true &&
      categoriesDuJour.has(combat.categorieId) &&
      !resultat.combats.has(combat.id),
  ).length;

  return {
    jour,
    combatsSansHoraire,
    finMs: resultat.finParJour.get(jour) ?? null,
    tatamiInutiliseMs,
    repartitionsDesequilibrees,
    ecartDesBranchesMs: ecartDesBranches,
    ecartALaHierarchie,
    parcoursSurTroisTatamis,
    changementsDeTatami,
    reposDeConfortManques,
  };
}

export type ComparaisonDePlans = {
  /** < 0 : le premier plan est préféré ; > 0 : le second ; 0 : ni l'un ni l'autre. */
  ordre: number;
  /**
   * L'objectif du §18 qui a départagé ; null à égalité parfaite, ou quand
   * l'un des plans laisse plus de combats sans horaire.
   */
  objectif: ObjectifDuPlanning | null;
};

function signe(valeur: number): number {
  return valeur < 0 ? -1 : valeur > 0 ? 1 : 0;
}

/**
 * ORD.9 B : compare deux évaluations d'une même journée dans l'ordre du §18.
 * Une fin plus précoce d'au moins la marge (5 minutes) l'emporte ; en deçà,
 * les objectifs suivants départagent, dans l'ordre, et à égalité sur tous, la
 * fin la plus précoce. `ordre` < 0 quand `a` est préféré.
 */
export function comparerLesPlans(
  a: EvaluationDeJournee,
  b: EvaluationDeJournee,
  options: { margeMs?: number } = {},
): ComparaisonDePlans {
  const marge = Math.max(0, options.margeMs ?? MARGE_ENTRE_PLANS_MINUTES * MINUTE_MS);
  if (a.combatsSansHoraire !== b.combatsSansHoraire) {
    return { ordre: signe(a.combatsSansHoraire - b.combatsSansHoraire), objectif: null };
  }
  const finA = a.finMs ?? Number.NEGATIVE_INFINITY;
  const finB = b.finMs ?? Number.NEGATIVE_INFINITY;
  const ecartDeFin = finA === finB ? 0 : finA - finB;
  if (Math.abs(ecartDeFin) >= marge && ecartDeFin !== 0) {
    return { ordre: signe(ecartDeFin), objectif: "fin_de_journee" };
  }
  const departages: Array<[ObjectifDuPlanning, number, number]> = [
    ["tatami_inutilise", a.tatamiInutiliseMs - b.tatamiInutiliseMs, marge],
    ["repartition_des_tableaux", a.repartitionsDesequilibrees - b.repartitionsDesequilibrees, 0],
    ["repartition_des_tableaux", a.ecartDesBranchesMs - b.ecartDesBranchesMs, marge],
    ["hierarchie_des_tatamis", a.ecartALaHierarchie - b.ecartALaHierarchie, 0],
    ["continuite_des_branches", a.parcoursSurTroisTatamis - b.parcoursSurTroisTatamis, 0],
    ["continuite_des_branches", a.changementsDeTatami - b.changementsDeTatami, 0],
    ["repos_de_confort", a.reposDeConfortManques - b.reposDeConfortManques, 0],
  ];
  for (const [objectif, ecart, tolerance] of departages) {
    if (ecart !== 0 && Math.abs(ecart) >= tolerance) {
      return { ordre: signe(ecart), objectif };
    }
  }
  if (ecartDeFin !== 0) return { ordre: signe(ecartDeFin), objectif: "fin_de_journee" };
  return { ordre: 0, objectif: null };
}

/**
 * Une retouche que le client n'accepte que si elle ne coûte rien (REP.5 C,
 * REP.6 A, RPS.5 A) : la journée ne finit pas plus tard, aucun combat de plus
 * ne reste sans horaire, et l'ordre du §18 (ORD.9 B) la préfère au plan
 * courant.
 */
export function retoucheSansRetard(
  candidat: EvaluationDeJournee,
  courant: EvaluationDeJournee,
  options: { margeMs?: number } = {},
): boolean {
  if (candidat.finMs === null || courant.finMs === null) return false;
  if (candidat.finMs > courant.finMs) return false;
  if (candidat.combatsSansHoraire > courant.combatsSansHoraire) return false;
  return comparerLesPlans(candidat, courant, options).ordre < 0;
}

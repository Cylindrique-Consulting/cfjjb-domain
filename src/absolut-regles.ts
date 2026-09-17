import type { BracketFightType } from "./bracket-generator";
import { resolveWeightClass } from "./db-vocabulary";
import type { BeltDb } from "./enums";
import type { WeightClassName } from "./referential";

/**
 * LES RÈGLES DE L'ABSOLUT : PÉRIMÈTRE, INSCRIPTIONS, GÉNÉRATION, TAPIS.
 *
 * Réponses du client du 15/09/2026 et relances du 16/09/2026 (AB1 à AB7,
 * T2.5, T4.3, T5.1 à T5.3, PL1.2, R1) :
 *
 *   · une catégorie SOURCE est « terminée » dès que son podium est confirmé, ou
 *     qu'elle est terminée sans médaillé ; la remise des médailles n'est jamais
 *     exigée ;
 *   · pour tout absolut qualifié par une médaille (couleurs, noires Masters,
 *     juvéniles bleue et violette), les inscriptions restent ouvertes jusqu'à
 *     20 minutes après l'instant où la DERNIÈRE source devient terminée, puis se
 *     ferment sans geste ;
 *   · la ceinture noire Adulte (famille des grades noirs, tranche Adulte) entre
 *     sans podium, jusqu'à une heure limite propre à la compétition ;
 *   · un absolut rouvert ne se referme plus seul ;
 *   · la génération exige les inscriptions closes et toutes les sources
 *     terminées (pour la noire Adulte, selon un réglage de la compétition) ;
 *   · un absolut qui ne compte qu'un inscrit actif à la clôture est annulé ;
 *   · le tableau se répartit sur 1, 2, 4 ou 8 tapis, par parties.
 *
 * Chaque règle a un miroir SQL dans `cfjjb-platform`. Les scénarios exportés en
 * fin de module sont rejoués contre ce miroir par `pnpm db:validate` : deux
 * exemplaires non comparés divergeraient en silence.
 */

// ===================================================================
// Constantes
// ===================================================================

/**
 * Délai d'inscription à un absolut qualifié par une médaille, compté depuis
 * l'instant où sa dernière catégorie source est terminée (T5.3). Règle CFJJB,
 * non paramétrable. Miroir SQL : `competition_absolut_delai_minutes()`.
 */
export const DELAI_INSCRIPTION_ABSOLUT_MINUTES = 20;

/** Nombres de tapis admis pour répartir un tableau d'absolut par parties (PL1.2). */
export const TAPIS_ADMIS_ABSOLUT: readonly number[] = [1, 2, 4, 8];

/** La famille des grades noirs : noire, corail, rouge. */
export const FAMILLE_DES_GRADES_NOIRS: readonly BeltDb[] = ["black", "coral", "red"];

// ===================================================================
// Périmètre
// ===================================================================

/** Les deux absoluts juvéniles (AB6). */
export type GroupeAbsolutJuvenile = "Leve" | "Pesado";

/** Verdict d'ouverture d'un absolut pour une ceinture et une tranche d'âge. */
export type OuvertureAbsolut = "ouverte" | "fermee" | "inconnue";

const TRANCHES_ADULTES = new Set([
  "adulte",
  "master 1",
  "master 2",
  "master 3",
  "master 4",
  "master 5+",
  "adult",
  "master",
  "master1",
  "master2",
  "master_1_2",
  "master_3_4",
  "master_5_plus",
]);

const TRANCHES_JUVENILES = new Set(["juvénile", "juvenil"]);

const TRANCHES_ENFANTS = new Set([
  "u7",
  "u9",
  "u11",
  "u13",
  "u15",
  "child",
  "premirim",
  "mirim",
  "infantil",
  "infantiljuvenil",
]);

const normaliser = (valeur: string | null | undefined): string =>
  (valeur ?? "").trim().toLowerCase();

/**
 * Ceinture noire ADULTE : famille des grades noirs ET tranche Adulte, lue dans
 * les deux vocabulaires de la colonne (`Adulte`, `adult`). Une noire Master
 * n'en est pas une (AB5). Miroir SQL : `competition_absolut_est_noire_adulte`.
 */
export function estNoireAdulte(
  belt: BeltDb | string | null | undefined,
  ageGroup: string | null | undefined,
): boolean {
  if (belt === null || belt === undefined) return false;
  if (!(FAMILLE_DES_GRADES_NOIRS as readonly string[]).includes(belt)) return false;
  const tranche = normaliser(ageGroup);
  return tranche === "adulte" || tranche === "adult";
}

/**
 * Le groupe d'absolut d'une classe de poids juvénile (AB6.1) : Galo à Leve pour
 * « Leve », Medio à Pesadissimo pour « Pesado ». Lit les noms et les indices
 * `0` à `8`. Toute autre valeur rend `null`. Miroir SQL :
 * `competition_absolut_groupe_juvenile`.
 */
export function groupeAbsolutJuvenile(
  weightClass: string | null | undefined,
): GroupeAbsolutJuvenile | null {
  const classe: WeightClassName | null = resolveWeightClass(weightClass);
  switch (classe) {
    case "Galo":
    case "Pluma":
    case "Pena":
    case "Leve":
      return "Leve";
    case "Medio":
    case "Meio Pesado":
    case "Pesado":
    case "Super Pesado":
    case "Pesadissimo":
      return "Pesado";
    default:
      return null;
  }
}

/**
 * L'absolut est-il ouvert pour cette ceinture et cette tranche d'âge ?
 *
 *   · ceinture blanche : jamais ;
 *   · Adulte et Masters : oui ;
 *   · Juvénile : en bleue et violette seulement (AB6) ;
 *   · U7 à U15 et anciens codes enfants : non ;
 *   · tranche non reconnue : `inconnue`, que l'appelant traite.
 *
 * Miroir SQL : `competition_absolut_ouverture`.
 */
export function ouvertureAbsolut(
  belt: BeltDb | string | null | undefined,
  ageGroup: string | null | undefined,
): OuvertureAbsolut {
  if (belt === "white") return "fermee";
  const tranche = normaliser(ageGroup);
  if (TRANCHES_JUVENILES.has(tranche)) {
    return belt === "blue" || belt === "purple" ? "ouverte" : "fermee";
  }
  if (TRANCHES_ADULTES.has(tranche)) return "ouverte";
  if (TRANCHES_ENFANTS.has(tranche)) return "fermee";
  return "inconnue";
}

/** La tranche est-elle juvénile (dans l'un ou l'autre vocabulaire) ? */
export function estTrancheJuvenile(ageGroup: string | null | undefined): boolean {
  return TRANCHES_JUVENILES.has(normaliser(ageGroup));
}

export type PerimetreAbsolut = {
  verdict: OuvertureAbsolut;
  /** Le groupe Leve / Pesado d'un juvénile ; `null` hors juvénile. */
  groupe: GroupeAbsolutJuvenile | null;
};

/**
 * Le périmètre d'une catégorie de poids : l'absolut qu'elle alimente est-il
 * ouvert, et dans quel groupe ? Un juvénile dont la classe de poids n'est pas
 * reconnue ne peut être rangé dans aucun des deux absoluts : `inconnue`.
 */
export function perimetreAbsolut(entree: {
  belt: BeltDb | string | null | undefined;
  ageGroup: string | null | undefined;
  weightClass: string | null | undefined;
}): PerimetreAbsolut {
  const verdict = ouvertureAbsolut(entree.belt, entree.ageGroup);
  if (verdict !== "ouverte" || !estTrancheJuvenile(entree.ageGroup)) {
    return { verdict, groupe: null };
  }
  const groupe = groupeAbsolutJuvenile(entree.weightClass);
  return groupe === null ? { verdict: "inconnue", groupe: null } : { verdict, groupe };
}

// ===================================================================
// Inscriptions : échéance dérivée et statut effectif
// ===================================================================

/** Statut enregistré d'un absolut. */
export type StatutAbsolut = "open" | "closed" | "generated" | "cancelled";

/** Pourquoi les inscriptions ont été closes. */
export type CauseClotureAbsolut = "delai" | "heure_limite" | "anticipee" | "manuelle";

/** Une catégorie source : terminée ou non, et depuis quand (ms epoch). */
export type SourceAbsolut = { terminee: boolean; termineeLe: number | null };

export type EntreeInscriptionsAbsolut = {
  statut: StatutAbsolut;
  /** Rouvert par le Responsable (réouverture ou annulation du tableau). */
  rouvert: boolean;
  noireAdulte: boolean;
  /** Heure limite de la noire Adulte pour la discipline (ms epoch), ou `null`. */
  heureLimite: number | null;
  sources: readonly SourceAbsolut[];
  /** L'horloge du serveur (ms epoch). */
  maintenant: number;
};

export type EtatInscriptionsAbsolut = {
  /** `open` devient `closed` dès l'échéance passée ; les autres statuts restent. */
  statutEffectif: StatutAbsolut;
  /** Instant où la dernière source est devenue terminée (ms epoch), ou `null`. */
  t0: number | null;
  /** Fin des inscriptions (ms epoch), ou `null` tant qu'elle n'est pas connue. */
  echeance: number | null;
};

const MINUTE_MS = 60_000;

/**
 * L'ÉCHÉANCE EST DÉRIVÉE, JAMAIS STOCKÉE COMME ENTRÉE (AB1, T5.1, T5.3, AB2.6).
 *
 *   · absolut rouvert : aucune échéance, il ne se referme qu'à la main ;
 *   · noire Adulte : l'heure limite de la compétition (sans heure, jamais) ;
 *   · autres : T0 + 20 minutes, T0 étant l'instant où la DERNIÈRE source est
 *     devenue terminée. Tant qu'une source n'est pas terminée (y compris après
 *     une correction qui la remet « Attendu »), aucune échéance : le délai est
 *     suspendu, et repart pour 20 minutes pleines de la nouvelle confirmation.
 *     Un absolut créé après T0 a la même échéance.
 *
 * Miroir SQL : `jour_j_absolut_echeance`.
 */
export function etatInscriptionsAbsolut(
  entree: EntreeInscriptionsAbsolut,
): EtatInscriptionsAbsolut {
  let t0: number | null = null;
  let echeance: number | null = null;
  if (!entree.rouvert) {
    if (entree.noireAdulte) {
      echeance = entree.heureLimite;
    } else if (
      entree.sources.length > 0 &&
      entree.sources.every((s) => s.terminee && s.termineeLe !== null)
    ) {
      t0 = Math.max(...entree.sources.map((s) => s.termineeLe as number));
      echeance = t0 + DELAI_INSCRIPTION_ABSOLUT_MINUTES * MINUTE_MS;
    }
  }
  const statutEffectif: StatutAbsolut =
    entree.statut === "open" && echeance !== null && entree.maintenant >= echeance
      ? "closed"
      : entree.statut;
  return { statutEffectif, t0, echeance };
}

/**
 * Le statut que prend un absolut au moment où ses inscriptions se ferment
 * (automatiquement, par anticipation ou à la main) : un seul inscrit actif
 * l'annule (AB7.1), aucun ou au moins deux le closent.
 */
export function statutALaCloture(inscritsActifs: number): "closed" | "cancelled" {
  return inscritsActifs === 1 ? "cancelled" : "closed";
}

// ===================================================================
// Génération
// ===================================================================

/** Ce qui manque pour générer le tableau d'un absolut, dans l'ordre de l'écran. */
export type ManqueGenerationAbsolut =
  | "annule"
  | "deja_genere"
  | "heure_limite_non_definie"
  | "inscriptions_ouvertes"
  | "sources_non_terminees"
  | "delai_en_cours"
  | "un_seul_inscrit";

export type EntreeGenerationAbsolut = EntreeInscriptionsAbsolut & {
  /**
   * Garde R1 : la noire Adulte attend-elle la fin de ses catégories de poids ?
   * Vrai par défaut (réponse du 16/09), réglable par compétition pour la recette.
   */
  attendLesPoids: boolean;
  closedCause: CauseClotureAbsolut | null;
  inscritsActifs: number;
};

/**
 * La garde de génération (AB1.1, R1) : liste ORDONNÉE de ce qui manque, vide
 * quand la génération est permise. Même ordre que les refus du serveur.
 *
 *   · un absolut annulé ou déjà généré ne se génère pas ;
 *   · les inscriptions doivent être closes (échéance passée, ou clôture
 *     anticipée ou manuelle déjà prononcée) ; une noire Adulte sans heure
 *     limite le dit à part ;
 *   · toutes les sources doivent être terminées, noire Adulte comprise quand
 *     `attendLesPoids` est vrai ;
 *   · une clôture par délai ou heure limite dont l'échéance est encore à venir
 *     (heure limite déplacée après coup) attend ;
 *   · il faut au moins deux inscrits actifs.
 */
export function manquesDeGeneration(entree: EntreeGenerationAbsolut): ManqueGenerationAbsolut[] {
  if (entree.statut === "cancelled") return ["annule"];
  if (entree.statut === "generated") return ["deja_genere"];
  const manques: ManqueGenerationAbsolut[] = [];
  const etat = etatInscriptionsAbsolut(entree);
  if (etat.statutEffectif === "open") {
    manques.push(
      entree.noireAdulte && !entree.rouvert && entree.heureLimite === null
        ? "heure_limite_non_definie"
        : "inscriptions_ouvertes",
    );
  }
  if ((!entree.noireAdulte || entree.attendLesPoids) && entree.sources.some((s) => !s.terminee)) {
    manques.push("sources_non_terminees");
  }
  if (
    etat.statutEffectif === "closed" &&
    entree.statut === "closed" &&
    (entree.closedCause === "delai" || entree.closedCause === "heure_limite") &&
    etat.echeance !== null &&
    etat.echeance > entree.maintenant
  ) {
    manques.push("delai_en_cours");
  }
  if (entree.inscritsActifs < 2) manques.push("un_seul_inscrit");
  return manques;
}

// ===================================================================
// Répartition par parties
// ===================================================================

/** Le nombre de tapis choisi est-il admis (1, 2, 4 ou 8) ? */
export function nombreDeTapisAdmis(nTapis: number): boolean {
  return TAPIS_ADMIS_ABSOLUT.includes(nTapis);
}

/**
 * LE TAPIS D'UN COMBAT D'ABSOLUT, PAR PARTIES (PL1.2).
 *
 * Le tableau est coupé en `nTapis` parties contiguës. Un combat de la division
 * `d` (1 = finale, 2 = demi-finales…) et d'indice `i` appartient à la partie
 * `floor(i × n / 2^(d-1))` : tant qu'un tour compte au moins `n` combats,
 * chaque combat reste sur le tapis de ses deux combats nourriciers, et les
 * parties convergent ensuite vers le premier tapis. Le combat pour la 3e place
 * et la finale se jouent sur le premier tapis choisi (le tapis de finale), et un
 * tableau de trois ne se répartit jamais.
 *
 * Rend un indice de 0 à `nTapis - 1`. Lève si `nTapis` n'est pas admis : le
 * serveur le refuse, et l'écran ne doit pas le proposer. Miroir SQL : la
 * répartition de `day_absolut_generate`.
 */
export function tapisDuCombatAbsolut(
  combat: { division: number; indexInDivision: number; type: BracketFightType },
  nTapis: number,
  tableauDeTrois: boolean,
): number {
  if (!nombreDeTapisAdmis(nTapis)) {
    throw new RangeError(`nombre de tapis non admis pour un absolut : ${nTapis}`);
  }
  if (tableauDeTrois || combat.type !== "BraketFight" || combat.division <= 1) return 0;
  const combatsDuTour = 2 ** (combat.division - 1);
  return Math.min(nTapis - 1, Math.floor((combat.indexInDivision * nTapis) / combatsDuTour));
}

// ===================================================================
// Scénarios de parité SQL
// ===================================================================

/** Une classe de poids et son groupe juvénile attendu. */
export type ScenarioGroupeJuvenile = {
  weightClass: string | null;
  attendu: GroupeAbsolutJuvenile | null;
};

/** Les valeurs de parité du groupe juvénile : noms, indices, et valeurs rejetées. */
export function scenariosGroupeJuvenile(): ScenarioGroupeJuvenile[] {
  const valeurs: (string | null)[] = [
    "Galo",
    "Pluma",
    "Pena",
    "Leve",
    "Medio",
    "Meio Pesado",
    "Pesado",
    "Super Pesado",
    "Pesadissimo",
    "0",
    "1",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    "36",
    "Absolut",
    "Absolut Leve",
    "",
    null,
  ];
  return valeurs.map((weightClass) => ({
    weightClass,
    attendu: groupeAbsolutJuvenile(weightClass),
  }));
}

/**
 * UN SCÉNARIO D'INSCRIPTIONS, EN MINUTES RELATIVES À « MAINTENANT », pour être
 * rejoué en base avec `now()`. Une source `termineeIlYa: null` n'est pas
 * terminée.
 */
export type ScenarioInscriptionsAbsolut = {
  id: string;
  statut: StatutAbsolut;
  rouvert: boolean;
  noireAdulte: boolean;
  /** Heure limite dans N minutes (négatif : passée), ou `null`. */
  heureLimiteDans: number | null;
  sourcesTermineesIlYa: readonly (number | null)[];
  attendu: {
    statutEffectif: StatutAbsolut;
    /** Échéance dans N minutes (négatif : passée), ou `null`. */
    echeanceDans: number | null;
  };
};

/** Les scénarios de parité de l'échéance, construits à l'appel. */
export function scenariosInscriptionsAbsolut(): ScenarioInscriptionsAbsolut[] {
  const base = (
    id: string,
    partiel: Omit<ScenarioInscriptionsAbsolut, "id" | "attendu">,
  ): ScenarioInscriptionsAbsolut => {
    const maintenant = 0;
    const etat = etatInscriptionsAbsolut({
      statut: partiel.statut,
      rouvert: partiel.rouvert,
      noireAdulte: partiel.noireAdulte,
      heureLimite: partiel.heureLimiteDans === null ? null : partiel.heureLimiteDans * MINUTE_MS,
      sources: partiel.sourcesTermineesIlYa.map((m) => ({
        terminee: m !== null,
        termineeLe: m === null ? null : -m * MINUTE_MS,
      })),
      maintenant,
    });
    return {
      id,
      ...partiel,
      attendu: {
        statutEffectif: etat.statutEffectif,
        echeanceDans: etat.echeance === null ? null : etat.echeance / MINUTE_MS,
      },
    };
  };
  const couleur = {
    statut: "open" as const,
    rouvert: false,
    noireAdulte: false,
    heureLimiteDans: null,
  };
  return [
    base("couleur.une_source_attendue", { ...couleur, sourcesTermineesIlYa: [30, null, 5] }),
    base("couleur.dans_le_delai", { ...couleur, sourcesTermineesIlYa: [40, 19] }),
    base("couleur.delai_ecoule", { ...couleur, sourcesTermineesIlYa: [40, 21] }),
    base("couleur.derniere_source_fixe_t0", { ...couleur, sourcesTermineesIlYa: [21, 3, 50] }),
    base("couleur.rouverte", { ...couleur, rouvert: true, sourcesTermineesIlYa: [90] }),
    base("couleur.close_reste_close", { ...couleur, statut: "closed", sourcesTermineesIlYa: [5] }),
    base("couleur.generee", { ...couleur, statut: "generated", sourcesTermineesIlYa: [90] }),
    base("noire_adulte.sans_heure_limite", {
      ...couleur,
      noireAdulte: true,
      sourcesTermineesIlYa: [90],
    }),
    base("noire_adulte.heure_a_venir", {
      ...couleur,
      noireAdulte: true,
      heureLimiteDans: 15,
      sourcesTermineesIlYa: [null],
    }),
    base("noire_adulte.heure_passee", {
      ...couleur,
      noireAdulte: true,
      heureLimiteDans: -2,
      sourcesTermineesIlYa: [null],
    }),
    base("noire_adulte.rouverte", {
      ...couleur,
      noireAdulte: true,
      rouvert: true,
      heureLimiteDans: -30,
      sourcesTermineesIlYa: [],
    }),
  ];
}

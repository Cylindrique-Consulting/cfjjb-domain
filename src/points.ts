import { resolveAgeGroup } from "./db-vocabulary";
import type { AgeGroup } from "./referential";

/**
 * POINTS, NIVEAUX DE COMPÉTITION ET SAISON SPORTIVE — une seule écriture de la
 * règle pour les trois dépôts (fiches PTS1, PTS5, PTS2).
 *
 * Réponses du client du 15/09 et du 16/09/2026, guide des points v1.2 et
 * règlement CFJJB 2024 (art. 3) :
 *
 *   · points de podium d'une catégorie de poids : 9 / 3 / 1 ;
 *   · points de podium d'un Absolut : 13,5 / 4,5 / 1,5 ;
 *   · points individuels = points de podium × coefficient du NIVEAU de la
 *     compétition (Open ×1, Majeure ×2, Championnat national ×4), arrondis à
 *     deux décimales ;
 *   · classements équipe et club : 9 / 3 / 1 par médaille, absolut compris,
 *     SANS coefficient (le coefficient ne concerne que les points individuels) ;
 *   · une catégorie à un seul inscrit ne rapporte aucun point (art. 3.4) ; deux
 *     seuls inscrits de la même équipe ne rapportent aucun point d'équipe ni de
 *     club, les points individuels restant acquis (art. 3.5) ;
 *   · R2 du 16/09 : enfants (U7 à U15) et juvéniles marquent EXACTEMENT comme les
 *     adultes. La décision fédérale du 26/08 est abandonnée : aucune tranche
 *     n'est exclue ici, et `isChildAgeCategory` (référentiel) ne sert pas au
 *     calcul des points.
 *
 * ┌─ ARITHMÉTIQUE EN CENTIÈMES ───────────────────────────────────────────────┐
 * │ Toutes les valeurs de ce module sont des ENTIERS de centièmes : 13,5 vaut │
 * │ 1350, un coefficient ×2 vaut 200. Un flottant ferait rendre 28,999… pour  │
 * │ 29, et deux sommes égales pourraient se départager par une erreur         │
 * │ d'arrondi. La plateforme stocke les mêmes valeurs en `numeric(8,2)` : la  │
 * │ fonction SQL `ranking_points_calcul` est la jumelle de `pointsDeResultat`,│
 * │ et un test de parité de la plateforme rejoue les deux sur un produit      │
 * │ cartésien de cas.                                                         │
 * └───────────────────────────────────────────────────────────────────────────┘
 */

// ------------------------------------------------------------------
// Niveaux de compétition
// ------------------------------------------------------------------

/** Enum Postgres `ranking_level`, dans l'ordre d'affichage. */
export const NIVEAUX_DE_COMPETITION = ["open", "majeure", "national", "hors_classement"] as const;
export type NiveauDeCompetition = (typeof NIVEAUX_DE_COMPETITION)[number];

export const LIBELLES_NIVEAU: Readonly<Record<NiveauDeCompetition, string>> = {
  open: "Open",
  majeure: "Majeure",
  national: "Championnat national",
  hors_classement: "Hors classement",
};

export function estNiveauDeCompetition(valeur: unknown): valeur is NiveauDeCompetition {
  return (
    typeof valeur === "string" && (NIVEAUX_DE_COMPETITION as readonly string[]).includes(valeur)
  );
}

// ------------------------------------------------------------------
// Paramètres d'une saison sportive
// ------------------------------------------------------------------

/** Trois valeurs de podium, en centièmes. */
export type BaremeDePodium = {
  or: number;
  argent: number;
  bronze: number;
};

/**
 * Les paramètres publiés pour une saison sportive (guide v1.2 p. 12). Tout est
 * en centièmes. Le coefficient d'une compétition hors classement vaut 0 et
 * n'est pas paramétrable.
 */
export type ParametresDePoints = {
  poids: BaremeDePodium;
  absolut: BaremeDePodium;
  equipeClub: BaremeDePodium;
  coefficients: { open: number; majeure: number; national: number };
};

/**
 * Le barème décidé. C'est aussi le repli de la plateforme quand aucune ligne
 * `ranking_parametres_saison` n'existe pour la saison : AUCUNE écriture en base
 * n'est nécessaire pour qu'il s'applique.
 */
export const PARAMETRES_DE_POINTS_PAR_DEFAUT: ParametresDePoints = Object.freeze({
  poids: Object.freeze({ or: 900, argent: 300, bronze: 100 }),
  absolut: Object.freeze({ or: 1350, argent: 450, bronze: 150 }),
  equipeClub: Object.freeze({ or: 900, argent: 300, bronze: 100 }),
  coefficients: Object.freeze({ open: 100, majeure: 200, national: 400 }),
});

/**
 * R3 du 16/09 : l'ancien coefficient libre se lit comme un niveau.
 * 3 (et les Opens) → Open ×1 ; 4 → Majeure ×2 ; 5 → Championnat national ×4.
 *
 * Décisions internes pour les valeurs hors de l'ancienne échelle : 0, négatif ou
 * absent → hors classement (c'est le rôle qu'avait le coefficient 0) ; 1 et 2 →
 * Open ; 5 et au-delà (100 en recette) → Championnat national.
 */
export function niveauDepuisCoefficientHerite(
  coefficient: number | null | undefined,
): NiveauDeCompetition {
  if (coefficient === null || coefficient === undefined || !Number.isFinite(coefficient)) {
    return "hors_classement";
  }
  if (coefficient <= 0) return "hors_classement";
  if (coefficient < 4) return "open";
  if (coefficient < 5) return "majeure";
  return "national";
}

/** Un niveau explicite l'emporte ; sinon la dérivation R3 du coefficient hérité. */
export function niveauEffectif(
  explicite: NiveauDeCompetition | null | undefined,
  coefficientHerite: number | null | undefined,
): NiveauDeCompetition {
  return explicite ?? niveauDepuisCoefficientHerite(coefficientHerite);
}

/** Coefficient d'un niveau, en centièmes. Hors classement : 0. */
export function coefficientDuNiveau(
  niveau: NiveauDeCompetition,
  params: ParametresDePoints = PARAMETRES_DE_POINTS_PAR_DEFAUT,
): number {
  switch (niveau) {
    case "open":
      return params.coefficients.open;
    case "majeure":
      return params.coefficients.majeure;
    case "national":
      return params.coefficients.national;
    case "hors_classement":
      return 0;
  }
}

// ------------------------------------------------------------------
// Exclusions (règlement CFJJB 2024, art. 3.4 et 3.5)
// ------------------------------------------------------------------

/**
 * Pourquoi un résultat ne rapporte pas tout :
 * - `seul_inscrit` : un seul inscrit au tableau, aucun point (individuel, équipe,
 *   club), même si le titre et la médaille sont reconnus ;
 * - `meme_equipe` : exactement deux inscrits, de la même équipe (y compris depuis
 *   deux clubs affiliés à la même équipe) ; aucun point d'équipe ni de club, les
 *   points individuels restant acquis.
 */
export type ExclusionDePoints = "seul_inscrit" | "meme_equipe";

/**
 * Le nombre d'inscrits s'apprécie au TABLEAU (inscrits placés, byes exclus), pas
 * après le check-in. Une clé d'équipe absente (`null`) ne prouve pas l'identité
 * d'équipe : pas d'exclusion.
 */
export function exclusionDePoints(
  inscrits: number,
  clesEquipe: ReadonlyArray<string | null | undefined> = [],
): ExclusionDePoints | null {
  if (!Number.isFinite(inscrits) || inscrits <= 1) return "seul_inscrit";
  if (inscrits === 2 && clesEquipe.length === 2) {
    const [a, b] = clesEquipe;
    if (a && b && a === b) return "meme_equipe";
  }
  return null;
}

// ------------------------------------------------------------------
// Points d'un résultat
// ------------------------------------------------------------------

export type ResultatAPointer = {
  /** 1, 2 ou 3 ; `null` = pas de médaille. */
  place: 1 | 2 | 3 | null;
  /** Vrai pour un podium d'Absolut. */
  absolut: boolean;
  niveau: NiveauDeCompetition;
  exclusion: ExclusionDePoints | null;
};

/** Détail explicable d'un résultat (guide §9.1), en centièmes. */
export type PointsDUnResultat = {
  valeurPodium: number;
  coefficient: number;
  points: number;
};

function valeurDeLaPlace(bareme: BaremeDePodium, place: 1 | 2 | 3): number {
  return place === 1 ? bareme.or : place === 2 ? bareme.argent : bareme.bronze;
}

/**
 * Produit de deux valeurs en centièmes, arrondi aux centièmes « au plus loin de
 * zéro » : la sémantique de `round(numeric, 2)` de Postgres.
 */
export function produitEnCentiemes(a: number, b: number): number {
  const brut = a * b;
  const signe = brut < 0 ? -1 : 1;
  return signe * Math.floor((Math.abs(brut) + 50) / 100);
}

/**
 * Points individuels d'un résultat : valeur de podium × coefficient du niveau,
 * arrondis à deux décimales. `null` quand le résultat n'a pas de place.
 */
export function pointsDeResultat(
  resultat: ResultatAPointer,
  params: ParametresDePoints = PARAMETRES_DE_POINTS_PAR_DEFAUT,
): PointsDUnResultat | null {
  if (resultat.place === null) return null;
  const valeurPodium = valeurDeLaPlace(
    resultat.absolut ? params.absolut : params.poids,
    resultat.place,
  );
  const coefficient = coefficientDuNiveau(resultat.niveau, params);
  const points =
    resultat.exclusion === "seul_inscrit" ? 0 : produitEnCentiemes(valeurPodium, coefficient);
  return { valeurPodium, coefficient, points };
}

/**
 * Points d'équipe et de club d'un résultat : 9 / 3 / 1 sans coefficient, absolut
 * compris ; 0 dès qu'une exclusion est posée. `null` sans place.
 */
export function pointsEquipeClub(
  place: 1 | 2 | 3 | null,
  exclusion: ExclusionDePoints | null,
  params: ParametresDePoints = PARAMETRES_DE_POINTS_PAR_DEFAUT,
): number | null {
  if (place === null) return null;
  if (exclusion !== null) return 0;
  return valeurDeLaPlace(params.equipeClub, place);
}

// ------------------------------------------------------------------
// Saison sportive (1er août au 31 juillet)
// ------------------------------------------------------------------

const DATE_ISO = /^(\d{4})-(\d{2})-(\d{2})/;
const LABEL_SAISON = /^(\d{4})-(\d{2})$/;

/**
 * Saison sportive d'une date de compétition : « AAAA-AA », bascule au 1er août
 * (guide v1.2 p. 2). Le 31/07/2026 est en 2025-26, le 01/08/2026 en 2026-27.
 * Ce n'est PAS la saison de licence de la table `seasons`.
 */
export function saisonSportive(dateIso: string | null | undefined): string | null {
  if (!dateIso) return null;
  const m = DATE_ISO.exec(dateIso.trim());
  if (!m) return null;
  const annee = Number(m[1]);
  const mois = Number(m[2]);
  if (mois < 1 || mois > 12) return null;
  const debut = mois >= 8 ? annee : annee - 1;
  return `${debut}-${String((debut + 1) % 100).padStart(2, "0")}`;
}

/** Bornes incluses d'une saison sportive, en dates ISO ; `null` si le label est invalide. */
export function bornesSaisonSportive(
  label: string | null | undefined,
): { debut: string; fin: string } | null {
  if (!label) return null;
  const m = LABEL_SAISON.exec(label.trim());
  if (!m) return null;
  const debut = Number(m[1]);
  if (Number(m[2]) !== (debut + 1) % 100) return null;
  return { debut: `${debut}-08-01`, fin: `${debut + 1}-07-31` };
}

// ------------------------------------------------------------------
// Tranche d'âge d'un profil de classement
// ------------------------------------------------------------------

/**
 * La tranche « réellement combattue » d'un profil (guide §2.1). Les Masters
 * regroupés des saisons reprises s'affichent tels qu'ils ont été combattus
 * (« Master 1/2 », « Master 3/4 ») : les traduire en Master 1 ou Master 3, comme
 * le fait `resolveAgeGroup` pour les durées, fusionnerait deux profils distincts.
 */
export type TrancheDeProfil = AgeGroup | "Master 1/2" | "Master 3/4";

const MASTERS_REGROUPES: Readonly<Record<string, TrancheDeProfil>> = {
  master_1_2: "Master 1/2",
  master_3_4: "Master 3/4",
};

/**
 * Libellé du référentiel rendu tel quel ; code ETL (comparé en minuscules)
 * traduit ; tout le reste (codes éteints refusés, libellé mal cassé) → `null`.
 */
export function trancheDeProfil(stored: string | null | undefined): TrancheDeProfil | null {
  if (!stored) return null;
  const regroupe = MASTERS_REGROUPES[stored.trim().toLowerCase()];
  if (regroupe) return regroupe;
  return resolveAgeGroup(stored);
}

/**
 * Ordre du départage des classements équipe et club (IBJJF 6.1 et CFJJB 2024,
 * art. 3.3.2) : Adulte, Master 1 à 5+, puis Juvénile, U15, U13, U11, U9, U7.
 * Un Master regroupé prend le rang de son premier Master.
 */
export const ORDRE_DEPARTAGE_TRANCHES: Readonly<Record<TrancheDeProfil, number>> = Object.freeze({
  Adulte: 1,
  "Master 1": 2,
  "Master 1/2": 2,
  "Master 2": 3,
  "Master 3": 4,
  "Master 3/4": 4,
  "Master 4": 5,
  "Master 5+": 6,
  Juvénile: 7,
  U15: 8,
  U13: 9,
  U11: 10,
  U9: 11,
  U7: 12,
});

// ------------------------------------------------------------------
// Conversions
// ------------------------------------------------------------------

/** 1350 → 13.5. */
export function centiemesVersNombre(centiemes: number): number {
  return centiemes / 100;
}

/** 13.5 → 1350 ; 0.29 → 29 (et non 28) ; `null` si la valeur n'est pas finie. */
export function nombreVersCentiemes(valeur: number | string | null | undefined): number | null {
  if (valeur === null || valeur === undefined || valeur === "") return null;
  const n = typeof valeur === "number" ? valeur : Number(valeur);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

import { resolveAgeGroup } from "./db-vocabulary";
import type { AgeGroup } from "./referential";

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

export type BaremeDePodium = {
  or: number;
  argent: number;
  bronze: number;
};

export type ParametresDePoints = {
  poids: BaremeDePodium;
  absolut: BaremeDePodium;
  equipeClub: BaremeDePodium;
  coefficients: { open: number; majeure: number; national: number };
};

export const PARAMETRES_DE_POINTS_PAR_DEFAUT: ParametresDePoints = Object.freeze({
  poids: Object.freeze({ or: 900, argent: 300, bronze: 100 }),
  absolut: Object.freeze({ or: 1350, argent: 450, bronze: 150 }),
  equipeClub: Object.freeze({ or: 900, argent: 300, bronze: 100 }),
  coefficients: Object.freeze({ open: 100, majeure: 200, national: 400 }),
});

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

export function niveauEffectif(
  explicite: NiveauDeCompetition | null | undefined,
  coefficientHerite: number | null | undefined,
): NiveauDeCompetition {
  return explicite ?? niveauDepuisCoefficientHerite(coefficientHerite);
}

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

export type ExclusionDePoints = "seul_inscrit" | "meme_equipe";

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

export type ResultatAPointer = {
  place: 1 | 2 | 3 | null;
  absolut: boolean;
  niveau: NiveauDeCompetition;
  exclusion: ExclusionDePoints | null;
};

export type PointsDUnResultat = {
  valeurPodium: number;
  coefficient: number;
  points: number;
};

function valeurDeLaPlace(bareme: BaremeDePodium, place: 1 | 2 | 3): number {
  return place === 1 ? bareme.or : place === 2 ? bareme.argent : bareme.bronze;
}

export function produitEnCentiemes(a: number, b: number): number {
  const brut = a * b;
  const signe = brut < 0 ? -1 : 1;
  return signe * Math.floor((Math.abs(brut) + 50) / 100);
}

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

export function pointsEquipeClub(
  place: 1 | 2 | 3 | null,
  exclusion: ExclusionDePoints | null,
  params: ParametresDePoints = PARAMETRES_DE_POINTS_PAR_DEFAUT,
): number | null {
  if (place === null) return null;
  if (exclusion !== null) return 0;
  return valeurDeLaPlace(params.equipeClub, place);
}

const DATE_ISO = /^(\d{4})-(\d{2})-(\d{2})/;
const LABEL_SAISON = /^(\d{4})-(\d{2})$/;

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

export type TrancheDeProfil = AgeGroup | "Master 1/2" | "Master 3/4";

const MASTERS_REGROUPES: Readonly<Record<string, TrancheDeProfil>> = {
  master_1_2: "Master 1/2",
  master_3_4: "Master 3/4",
};

export function trancheDeProfil(stored: string | null | undefined): TrancheDeProfil | null {
  if (!stored) return null;
  const brut = stored.trim();
  if (brut === "Master 1/2" || brut === "Master 3/4") return brut;
  const regroupe = MASTERS_REGROUPES[brut.toLowerCase()];
  if (regroupe) return regroupe;
  return resolveAgeGroup(stored);
}

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

export function centiemesVersNombre(centiemes: number): number {
  return centiemes / 100;
}

export function nombreVersCentiemes(valeur: number | string | null | undefined): number | null {
  if (valeur === null || valeur === undefined || valeur === "") return null;
  const n = typeof valeur === "number" ? valeur : Number(valeur);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

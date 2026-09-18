import { ALL_BELTS } from "./belts";
import type { BeltDb, DisciplineDb, GenderDb } from "./enums";
import { estNiveauDeCompetition, nombreVersCentiemes, trancheDeProfil } from "./points";
import type { RangSportif, ResultatPourPlacement, ScoreDePlacement } from "./score-de-placement";
import type { SeedingPlan } from "./seeding-plan";

export const RANG_SPORTIF_SEEDING_PLAN: SeedingPlan = {
  order: [{ kind: "rang-sportif", enabled: true }],
  constraints: [
    {
      name: "meme-equipe-premier-tour",
      enabled: true,
      key: "team",
      scope: { kind: "round", round: 1 },
      tier: 0,
      weight: 1,
    },
  ],
  pins: [{ kind: "empty-leaves" }],
  reparation: "rang-voisin",
};

export const CRITERES_DE_DEPARTAGE = [
  "absolut",
  "general",
  "direct",
  "criteres",
  "jour",
  "tirage",
] as const;
export type CritereDeDepartage = (typeof CRITERES_DE_DEPARTAGE)[number];

export const LIBELLES_CRITERE_DE_DEPARTAGE: Readonly<Record<CritereDeDepartage, string>> =
  Object.freeze({
    absolut: "score Absolut",
    general: "score général",
    direct: "score direct",
    criteres: "critères du classement national",
    jour: "place et catégorie du jour",
    tirage: "tirage au sort",
  });

export function estCritereDeDepartage(valeur: unknown): valeur is CritereDeDepartage {
  return (
    typeof valeur === "string" && (CRITERES_DE_DEPARTAGE as readonly string[]).includes(valeur)
  );
}

function clesDuScore(
  score: ScoreDePlacement,
  absolut: boolean,
): ReadonlyArray<readonly [CritereDeDepartage, number]> {
  return absolut
    ? [
        ["absolut", score.absolutCentiemes],
        ["general", score.generalCentiemes],
        ["direct", score.directCentiemes],
      ]
    : [
        ["general", score.generalCentiemes],
        ["direct", score.directCentiemes],
      ];
}

export function critereQuiDepartage(
  precedent: RangSportif | null,
  courant: RangSportif,
  absolut: boolean,
): CritereDeDepartage | null {
  if (precedent === null) return null;
  if (courant.departage !== "score") return courant.departage;
  const avant = clesDuScore(precedent.score, absolut);
  const apres = clesDuScore(courant.score, absolut);
  for (let i = 0; i < apres.length; i++) {
    const [critere, valeur] = apres[i] as readonly [CritereDeDepartage, number];
    if ((avant[i] as readonly [CritereDeDepartage, number])[1] !== valeur) return critere;
  }
  return "tirage";
}

const CRITERES_MENTIONNES: ReadonlyArray<CritereDeDepartage> = [
  "direct",
  "criteres",
  "jour",
  "tirage",
];

export function critereAMentionner(critere: CritereDeDepartage | null): boolean {
  return critere !== null && CRITERES_MENTIONNES.includes(critere);
}

export type ContributionFigee = {
  readonly resultId: string;
  readonly saison: string;
  readonly isAbsolut: boolean;
  readonly pointsCentiemes: number;
  readonly partSaison: number;
  readonly partAge: number;
  readonly partCeinture: number;
  readonly contributionCentiemes: number;
};

export type EntreeDePlacementFige = {
  readonly licenseeId: string;
  readonly rang: number;
  readonly generalCentiemes: number;
  readonly directCentiemes: number;
  readonly absolutCentiemes: number;
  readonly critere: CritereDeDepartage | null;
  readonly contributions: readonly ContributionFigee[];
};

export function figerLePlacement(
  rangs: readonly RangSportif[],
  absolut: boolean,
): EntreeDePlacementFige[] {
  return rangs.map((rang, i) => ({
    licenseeId: rang.score.licenseeId,
    rang: rang.rang,
    generalCentiemes: rang.score.generalCentiemes,
    directCentiemes: rang.score.directCentiemes,
    absolutCentiemes: rang.score.absolutCentiemes,
    critere: critereQuiDepartage(i === 0 ? null : (rangs[i - 1] as RangSportif), rang, absolut),
    contributions: rang.score.contributions.map((c) => ({
      resultId: c.resultat.resultId,
      saison: c.resultat.saisonSportive,
      isAbsolut: c.resultat.isAbsolut,
      pointsCentiemes: c.resultat.pointsCentiemes,
      partSaison: c.partSaison,
      partAge: c.partAge,
      partCeinture: c.partCeinture,
      contributionCentiemes: c.contributionCentiemes,
    })),
  }));
}

export type ColonnesDeLegende = {
  readonly absolut: boolean;
  readonly direct: boolean;
  readonly departage: boolean;
};

export function colonnesDeLaLegende(
  criteres: ReadonlyArray<CritereDeDepartage | null>,
  absolut: boolean,
): ColonnesDeLegende {
  return {
    absolut,
    direct: criteres.includes("direct"),
    departage: criteres.some((c) => critereAMentionner(c)),
  };
}

export type LigneResultatDeLaBase = {
  readonly id: string;
  readonly licensee_id: string | null;
  readonly competition_id?: string | null;
  readonly sport_season: string | null;
  readonly discipline: string | null;
  readonly gender: string | null;
  readonly age_group_profile: string | null;
  readonly belt: string | null;
  readonly is_absolut: boolean | null;
  readonly place: number | null;
  readonly ranking_level: string | null;
  readonly points: number | string | null;
};

function disciplineLue(valeur: string | null): DisciplineDb | null {
  return valeur === "gi" || valeur === "nogi" ? valeur : null;
}

function genreLu(valeur: string | null): GenderDb | null {
  return valeur === "male" || valeur === "female" ? valeur : null;
}

function ceintureLue(valeur: string | null): BeltDb | null {
  return valeur !== null && (ALL_BELTS as readonly string[]).includes(valeur)
    ? (valeur as BeltDb)
    : null;
}

export function resultatPourPlacementDepuisLaBase(
  ligne: LigneResultatDeLaBase,
): ResultatPourPlacement | null {
  if (ligne.licensee_id === null || ligne.sport_season === null) return null;
  const discipline = disciplineLue(ligne.discipline);
  const gender = genreLu(ligne.gender);
  const belt = ceintureLue(ligne.belt);
  if (discipline === null || gender === null || belt === null) return null;
  const tranche = trancheDeProfil(ligne.age_group_profile);
  if (tranche === null) return null;
  const place = ligne.place === 1 || ligne.place === 2 || ligne.place === 3 ? ligne.place : null;
  if (place === null) return null;
  if (!estNiveauDeCompetition(ligne.ranking_level)) return null;
  const centiemes = nombreVersCentiemes(ligne.points);
  if (centiemes === null || centiemes <= 0) return null;
  return {
    resultId: ligne.id,
    licenseeId: ligne.licensee_id,
    competitionId: ligne.competition_id ?? "",
    saisonSportive: ligne.sport_season,
    discipline,
    gender,
    tranche,
    belt,
    isAbsolut: ligne.is_absolut === true,
    place,
    niveau: ligne.ranking_level,
    pointsCentiemes: centiemes,
  };
}

import { KIDS_BELTS } from "./belts";
import type { BeltDb, DisciplineDb, GenderDb } from "./enums";
import { bornesSaisonSportive, type NiveauDeCompetition, type TrancheDeProfil } from "./points";
import { fnv1a, mulberry32, shuffle } from "./prng";

const PART_PLEINE = 10000;

export const PARTS_DE_SAISON = [10000, 5000, 2500] as const;

export type GroupesMaster = ReadonlyArray<ReadonlyArray<number>>;

export const GROUPES_MASTER_SEPARES: GroupesMaster = Object.freeze([
  Object.freeze([1]),
  Object.freeze([2]),
  Object.freeze([3]),
  Object.freeze([4]),
  Object.freeze([5]),
]);

export const GROUPES_MASTER_REGROUPES: GroupesMaster = Object.freeze([
  Object.freeze([1, 2]),
  Object.freeze([3, 4]),
  Object.freeze([5]),
]);

export const DERNIERE_SAISON_MASTERS_REGROUPES = "2025-26";

const NIVEAUX_MASTER_COUVERTS: Readonly<Record<string, ReadonlyArray<number>>> = Object.freeze({
  "Master 1": Object.freeze([1]),
  "Master 1/2": Object.freeze([1, 2]),
  "Master 2": Object.freeze([2]),
  "Master 3": Object.freeze([3]),
  "Master 3/4": Object.freeze([3, 4]),
  "Master 4": Object.freeze([4]),
  "Master 5+": Object.freeze([5]),
});

const TRANCHES_MASTER_REGROUPEES: ReadonlyArray<TrancheDeProfil> = ["Master 1/2", "Master 3/4"];

export const TRANCHES_ENFANTS_DE_PROFIL: ReadonlyArray<TrancheDeProfil> = [
  "U7",
  "U9",
  "U11",
  "U13",
  "U15",
];

const ORDRE_JEUNES: ReadonlyArray<TrancheDeProfil> = [
  "U7",
  "U9",
  "U11",
  "U13",
  "U15",
  "Juvénile",
  "Adulte",
];

export const ECHELLE_CEINTURES_ADULTE: ReadonlyArray<BeltDb> = [
  "white",
  "blue",
  "purple",
  "brown",
  "black",
];

export const ECHELLE_CEINTURES_ENFANT: ReadonlyArray<BeltDb> = KIDS_BELTS;

const GRADES_EQUIVALENTS_NOIRE: ReadonlyArray<BeltDb> = ["black", "coral", "red"];

export type ResultatPourPlacement = {
  readonly resultId: string;
  readonly licenseeId: string;
  readonly competitionId: string;
  readonly saisonSportive: string;
  readonly discipline: DisciplineDb;
  readonly gender: GenderDb;
  readonly tranche: TrancheDeProfil;
  readonly belt: BeltDb;
  readonly isAbsolut: boolean;
  readonly place: 1 | 2 | 3;
  readonly niveau: NiveauDeCompetition;
  readonly pointsCentiemes: number;
};

export type CibleDePlacement = {
  readonly saisonCourante: string;
  readonly discipline: DisciplineDb;
  readonly gender: GenderDb;
  readonly tranche: TrancheDeProfil;
  readonly belt: BeltDb;
};

export type Contribution = {
  readonly resultat: ResultatPourPlacement;
  readonly partSaison: number;
  readonly partAge: number;
  readonly partCeinture: number;
  readonly contributionExacte: number;
  readonly contributionCentiemes: number;
};

export const MOTIFS_DE_RETRAIT = ["ceinture_superieure"] as const;
export type MotifDeRetrait = (typeof MOTIFS_DE_RETRAIT)[number];

export type ResultatEcarte = {
  readonly resultat: ResultatPourPlacement;
  readonly motif: MotifDeRetrait;
};

export type EvaluationDUnResultat =
  | { readonly retenu: true; readonly contribution: Contribution }
  | { readonly retenu: false; readonly motif: MotifDeRetrait | null };

export type ScoreDePlacement = {
  readonly licenseeId: string;
  readonly generalCentiemes: number;
  readonly absolutCentiemes: number;
  readonly directCentiemes: number;
  readonly nationalCentiemes: number;
  readonly majeureCentiemes: number;
  readonly ors: number;
  readonly argents: number;
  readonly bronzes: number;
  readonly contributions: readonly Contribution[];
  readonly ecartes: readonly ResultatEcarte[];
};

export const DEPARTAGES = ["score", "criteres", "tirage"] as const;
export type Departage = (typeof DEPARTAGES)[number];

export type RangSportif = {
  readonly score: ScoreDePlacement;
  readonly rang: number;
  readonly departage: Departage;
};

export type OptionsDOrdre = {
  readonly absolut: boolean;
  readonly graine?: string;
};

function anneeDeSaison(label: string | null | undefined): number | null {
  const bornes = bornesSaisonSportive(label);
  return bornes === null ? null : Number(bornes.debut.slice(0, 4));
}

export function partDeSaison(
  saisonDuResultat: string | null | undefined,
  saisonCible: string | null | undefined,
): number {
  const duResultat = anneeDeSaison(saisonDuResultat);
  const cible = anneeDeSaison(saisonCible);
  if (duResultat === null || cible === null) return 0;
  const recul = cible - duResultat;
  if (recul < 0 || recul >= PARTS_DE_SAISON.length) return 0;
  return PARTS_DE_SAISON[recul] as number;
}

export function groupesMasterDeLaSaison(saison: string | null | undefined): GroupesMaster {
  const annee = anneeDeSaison(saison);
  const derniere = anneeDeSaison(DERNIERE_SAISON_MASTERS_REGROUPES);
  if (annee === null || derniere === null) return GROUPES_MASTER_SEPARES;
  return annee <= derniere ? GROUPES_MASTER_REGROUPES : GROUPES_MASTER_SEPARES;
}

function indiceDeGroupe(groupes: GroupesMaster, niveau: number): number {
  return groupes.findIndex((groupe) => groupe.includes(niveau));
}

export function partDAge(
  depuis: TrancheDeProfil,
  vers: TrancheDeProfil,
  groupesMaster: GroupesMaster = GROUPES_MASTER_SEPARES,
): number {
  if (depuis === vers) return PART_PLEINE;

  const couvertsDepuis = NIVEAUX_MASTER_COUVERTS[depuis] ?? null;
  const couvertsVers = NIVEAUX_MASTER_COUVERTS[vers] ?? null;

  if (couvertsDepuis !== null && couvertsVers !== null) {
    const niveauVise = Math.min(...couvertsVers);
    if (couvertsDepuis.includes(niveauVise)) return PART_PLEINE;
    if (niveauVise > Math.max(...couvertsDepuis)) return PART_PLEINE;
    const echelle = TRANCHES_MASTER_REGROUPEES.includes(depuis)
      ? GROUPES_MASTER_REGROUPES
      : groupesMaster;
    const iDepuis = indiceDeGroupe(echelle, Math.min(...couvertsDepuis));
    const iVers = indiceDeGroupe(echelle, niveauVise);
    if (iDepuis < 0 || iVers < 0) return 0;
    const remontees = iDepuis - iVers;
    if (remontees <= 0) return PART_PLEINE;
    return PART_PLEINE / 2 ** remontees;
  }

  if (depuis === "Adulte" && couvertsVers !== null) return PART_PLEINE;
  if (couvertsDepuis !== null || couvertsVers !== null) return 0;

  const iDepuis = ORDRE_JEUNES.indexOf(depuis);
  const iVers = ORDRE_JEUNES.indexOf(vers);
  if (iDepuis < 0 || iVers < 0) return 0;
  return iDepuis === iVers - 1 ? PART_PLEINE / 2 : 0;
}

export function echelleDeCeinture(trancheCible: TrancheDeProfil): ReadonlyArray<BeltDb> {
  return TRANCHES_ENFANTS_DE_PROFIL.includes(trancheCible)
    ? ECHELLE_CEINTURES_ENFANT
    : ECHELLE_CEINTURES_ADULTE;
}

function positionSurEchelle(belt: BeltDb, echelle: ReadonlyArray<BeltDb>): number {
  const directe = echelle.indexOf(belt);
  if (directe >= 0) return directe;
  if (KIDS_BELTS.includes(belt)) return 0;
  if (GRADES_EQUIVALENTS_NOIRE.includes(belt)) {
    const noire = echelle.indexOf("black");
    if (noire >= 0) return noire;
  }
  return echelle.length;
}

type ComparaisonDeCeinture = { readonly part: number; readonly superieure: boolean };

function comparerLesCeintures(
  depuis: BeltDb,
  vers: BeltDb,
  trancheCible: TrancheDeProfil,
): ComparaisonDeCeinture {
  const echelle = echelleDeCeinture(trancheCible);
  const iDepuis = positionSurEchelle(depuis, echelle);
  const iVers = positionSurEchelle(vers, echelle);
  if (iDepuis > iVers) return { part: 0, superieure: true };
  if (iDepuis === iVers) return { part: PART_PLEINE, superieure: false };
  return { part: iDepuis === iVers - 1 ? PART_PLEINE / 2 : 0, superieure: false };
}

export function partDeCeinture(
  depuis: BeltDb,
  vers: BeltDb,
  trancheCible: TrancheDeProfil = "Adulte",
): number {
  return comparerLesCeintures(depuis, vers, trancheCible).part;
}

export function ceintureSuperieureALaCible(
  depuis: BeltDb,
  vers: BeltDb,
  trancheCible: TrancheDeProfil = "Adulte",
): boolean {
  return comparerLesCeintures(depuis, vers, trancheCible).superieure;
}

export function arrondiCentiemes(valeur: number): number {
  return valeur < 0 ? -Math.round(-valeur) : Math.round(valeur);
}

export function evaluerUnResultat(
  resultat: ResultatPourPlacement,
  cible: CibleDePlacement,
): EvaluationDUnResultat {
  if (resultat.discipline !== cible.discipline) return { retenu: false, motif: null };
  if (resultat.gender !== cible.gender) return { retenu: false, motif: null };

  const partSaison = partDeSaison(resultat.saisonSportive, cible.saisonCourante);
  if (partSaison === 0) return { retenu: false, motif: null };

  const partAge = partDAge(
    resultat.tranche,
    cible.tranche,
    groupesMasterDeLaSaison(resultat.saisonSportive),
  );
  if (partAge === 0) return { retenu: false, motif: null };

  const ceinture = comparerLesCeintures(resultat.belt, cible.belt, cible.tranche);
  if (ceinture.superieure) return { retenu: false, motif: "ceinture_superieure" };
  if (ceinture.part === 0) return { retenu: false, motif: null };

  const facteur =
    (partSaison / PART_PLEINE) * (partAge / PART_PLEINE) * (ceinture.part / PART_PLEINE);
  const exacte = resultat.pointsCentiemes * facteur;

  return {
    retenu: true,
    contribution: {
      resultat,
      partSaison,
      partAge,
      partCeinture: ceinture.part,
      contributionExacte: exacte,
      contributionCentiemes: arrondiCentiemes(exacte),
    },
  };
}

export function contributionDUnResultat(
  resultat: ResultatPourPlacement,
  cible: CibleDePlacement,
): Contribution | null {
  const evaluation = evaluerUnResultat(resultat, cible);
  return evaluation.retenu ? evaluation.contribution : null;
}

export function scoreDePlacement(
  licenseeId: string,
  resultats: readonly ResultatPourPlacement[],
  cible: CibleDePlacement,
): ScoreDePlacement {
  const contributions: Contribution[] = [];
  const ecartes: ResultatEcarte[] = [];
  let general = 0;
  let absolut = 0;
  let direct = 0;
  let national = 0;
  let majeure = 0;
  let ors = 0;
  let argents = 0;
  let bronzes = 0;

  for (const resultat of resultats) {
    const evaluation = evaluerUnResultat(resultat, cible);
    if (!evaluation.retenu) {
      if (evaluation.motif !== null) ecartes.push({ resultat, motif: evaluation.motif });
      continue;
    }

    const contribution = evaluation.contribution;
    contributions.push(contribution);
    general += contribution.contributionExacte;
    if (resultat.isAbsolut) absolut += contribution.contributionExacte;
    if (resultat.tranche === cible.tranche && resultat.belt === cible.belt) {
      direct += contribution.contributionExacte;
    }
    if (resultat.niveau === "national") national += contribution.contributionExacte;
    if (resultat.niveau === "majeure") majeure += contribution.contributionExacte;
    if (resultat.pointsCentiemes > 0) {
      if (resultat.place === 1) ors += 1;
      else if (resultat.place === 2) argents += 1;
      else bronzes += 1;
    }
  }

  return {
    licenseeId,
    generalCentiemes: arrondiCentiemes(general),
    absolutCentiemes: arrondiCentiemes(absolut),
    directCentiemes: arrondiCentiemes(direct),
    nationalCentiemes: arrondiCentiemes(national),
    majeureCentiemes: arrondiCentiemes(majeure),
    ors,
    argents,
    bronzes,
    contributions,
    ecartes,
  };
}

function clesDeScore(score: ScoreDePlacement, absolut: boolean): ReadonlyArray<number> {
  return absolut
    ? [score.absolutCentiemes, score.generalCentiemes, score.directCentiemes]
    : [score.generalCentiemes, score.directCentiemes];
}

function clesDeCriteresNationaux(score: ScoreDePlacement): ReadonlyArray<number> {
  return [score.nationalCentiemes, score.majeureCentiemes, score.ors, score.argents, score.bronzes];
}

function comparerDecroissant(a: ReadonlyArray<number>, b: ReadonlyArray<number>): number {
  for (let i = 0; i < a.length; i++) {
    const ecart = (b[i] as number) - (a[i] as number);
    if (ecart !== 0) return ecart;
  }
  return 0;
}

export function graineDuDepartage(graine: string, licenseeIds: readonly string[]): number {
  return fnv1a(`${graine}|${[...licenseeIds].sort().join(",")}`);
}

export function ordonnerPourTableau(
  scores: readonly ScoreDePlacement[],
  options: OptionsDOrdre,
): RangSportif[] {
  const graine = options.graine ?? "";
  const absolut = options.absolut;

  const canoniques = [...scores].sort((a, b) =>
    a.licenseeId < b.licenseeId ? -1 : a.licenseeId > b.licenseeId ? 1 : 0,
  );

  const tries = canoniques.sort((a, b) => {
    const parScore = comparerDecroissant(clesDeScore(a, absolut), clesDeScore(b, absolut));
    if (parScore !== 0) return parScore;
    return comparerDecroissant(clesDeCriteresNationaux(a), clesDeCriteresNationaux(b));
  });

  const rangs: RangSportif[] = [];
  let debut = 0;

  while (debut < tries.length) {
    const tete = tries[debut] as ScoreDePlacement;
    let fin = debut + 1;
    while (
      fin < tries.length &&
      comparerDecroissant(
        clesDeScore(tete, absolut),
        clesDeScore(tries[fin] as ScoreDePlacement, absolut),
      ) === 0 &&
      comparerDecroissant(
        clesDeCriteresNationaux(tete),
        clesDeCriteresNationaux(tries[fin] as ScoreDePlacement),
      ) === 0
    ) {
      fin += 1;
    }

    const groupe = tries.slice(debut, fin);
    const ordonne =
      groupe.length > 1
        ? shuffle(
            groupe,
            mulberry32(
              graineDuDepartage(
                graine,
                groupe.map((score) => score.licenseeId),
              ),
            ),
          )
        : groupe;

    ordonne.forEach((score, rangDansLeGroupe) => {
      const index = debut + rangDansLeGroupe;
      let departage: Departage = "score";
      if (rangDansLeGroupe > 0) departage = "tirage";
      else if (index > 0) {
        const precedent = (rangs[index - 1] as RangSportif).score;
        departage =
          comparerDecroissant(clesDeScore(precedent, absolut), clesDeScore(score, absolut)) !== 0
            ? "score"
            : "criteres";
      }
      rangs.push({ score, rang: index + 1, departage });
    });

    debut = fin;
  }

  return rangs;
}

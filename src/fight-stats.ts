import type { FightState, WinMethod } from "./bracket-propagation";

export type FightSide = "a" | "b";

export type ScoreScope = "points" | "advantages" | "penalties";

export const SUBMISSION_TYPES = [
  "armbar",
  "triangle",
  "rear_naked_choke",
  "guillotine",
  "kimura",
  "americana",
  "omoplata",
  "bow_and_arrow",
  "cross_collar",
  "ezekiel",
  "arm_triangle",
  "north_south",
  "footlock",
  "kneebar",
  "toe_hold",
  "heel_hook",
  "other",
] as const;

export type SubmissionType = (typeof SUBMISSION_TYPES)[number];

export function isSubmissionType(value: string | null | undefined): value is SubmissionType {
  return value != null && (SUBMISSION_TYPES as readonly string[]).includes(value);
}

export type ScoreEvent = {
  readonly fightId: string;
  readonly side: FightSide | null;
  readonly scope: ScoreScope | null;
  readonly delta: number | null;
};

export type FightScores = {
  readonly pointsA: number;
  readonly pointsB: number;
  readonly advantagesA: number;
  readonly advantagesB: number;
  readonly penaltiesA: number;
  readonly penaltiesB: number;
};

const SCORES_VIDES: FightScores = {
  pointsA: 0,
  pointsB: 0,
  advantagesA: 0,
  advantagesB: 0,
  penaltiesA: 0,
  penaltiesB: 0,
};

export function foldScores(events: readonly ScoreEvent[]): Map<string, FightScores> {
  const parCombat = new Map<string, FightScores>();
  for (const e of events) {
    const courant = parCombat.get(e.fightId) ?? SCORES_VIDES;
    if (e.side == null || e.scope == null || e.delta == null || !Number.isFinite(e.delta)) {
      parCombat.set(e.fightId, courant);
      continue;
    }
    parCombat.set(e.fightId, ajouteDelta(courant, e.side, e.scope, e.delta));
  }
  return parCombat;
}

function ajouteDelta(
  s: FightScores,
  side: FightSide,
  scope: ScoreScope,
  delta: number,
): FightScores {
  const estA = side === "a";
  switch (scope) {
    case "points":
      return estA ? { ...s, pointsA: s.pointsA + delta } : { ...s, pointsB: s.pointsB + delta };
    case "advantages":
      return estA
        ? { ...s, advantagesA: s.advantagesA + delta }
        : { ...s, advantagesB: s.advantagesB + delta };
    case "penalties":
      return estA
        ? { ...s, penaltiesA: s.penaltiesA + delta }
        : { ...s, penaltiesB: s.penaltiesB + delta };
  }
}

export type FightRecord = {
  readonly fightId: string;
  readonly state: FightState;
  readonly registrationA: string | null;
  readonly registrationB: string | null;
  readonly winner: string | null;
  readonly winMethod: WinMethod | null;
  readonly submissionType?: SubmissionType | null;
  readonly scores?: FightScores | null;
  readonly finishClockMs?: number | null;
};

export type MethodeVictoire =
  "points" | "soumission" | "decision" | "abandon" | "disqualification" | "forfait";

export const METHODES_VICTOIRE = [
  "points",
  "soumission",
  "decision",
  "abandon",
  "disqualification",
  "forfait",
] as const satisfies readonly MethodeVictoire[];

export function methodeVictoireDe(win: WinMethod | null | undefined): MethodeVictoire | null {
  switch (win) {
    case "points":
      return "points";
    case "submission":
      return "soumission";
    case "decision":
      return "decision";
    case "abandon":
      return "abandon";
    case "dq":
      return "disqualification";
    case "wo":
      return "forfait";
    case "double_wo":
    case "double_dq":
    case "double_blessure":
    case "bye":
    case "designation":
      return null;
    default:
      return null;
  }
}

export type BilanContre = {
  readonly combats: number;
  readonly victoires: number;
  readonly defaites: number;
};

export type SoumissionsStat = {
  readonly total: number;
  readonly parType: ReadonlyMap<SubmissionType, number>;
  readonly typeNonReleve: number;
  readonly tempsMesures: number;
  readonly tempsNonMesures: number;
  readonly plusRapideMs: number | null;
  readonly medianeMs: number | null;
};

export type StatistiquesCombattant =
  | { readonly aDesCombats: false }
  | {
      readonly aDesCombats: true;
      readonly combats: number;
      readonly victoires: number;
      readonly defaites: number;
      readonly sansVainqueur: number;
      readonly victoiresParMethode: Readonly<Record<MethodeVictoire, number>>;
      readonly defaitesParMethode: Readonly<Record<MethodeVictoire, number>>;
      readonly victoiresSansMethode: number;
      readonly defaitesSansMethode: number;
      readonly adversairesDistincts: number;
      readonly adversaires: ReadonlyMap<string, BilanContre>;
      readonly pointsMarques: number;
      readonly pointsEncaisses: number;
      readonly avantagesMarques: number;
      readonly avantagesEncaisses: number;
      readonly penalitesRecues: number;
      readonly penalitesAdverses: number;
      readonly combatsSansJournal: number;
      readonly soumissions: SoumissionsStat;
    };

const compteursVides = (): Record<MethodeVictoire, number> => ({
  points: 0,
  soumission: 0,
  decision: 0,
  abandon: 0,
  disqualification: 0,
  forfait: 0,
});

function coteDe(f: FightRecord, combattantId: string): FightSide | null {
  if (f.registrationA === combattantId) return "a";
  if (f.registrationB === combattantId) return "b";
  return null;
}

function combatsRetenus(fights: readonly FightRecord[]): FightRecord[] {
  const vus = new Map<string, FightRecord>();
  for (const f of fights) {
    if (f.state !== "finished") continue;
    if (f.winMethod === "bye") continue;
    if (f.winMethod === "designation") continue;
    if (!vus.has(f.fightId)) vus.set(f.fightId, f);
  }
  return [...vus.values()];
}

export function statistiquesCombattant(
  combattantId: string,
  fights: readonly FightRecord[],
): StatistiquesCombattant {
  const retenus = combatsRetenus(fights).filter((f) => coteDe(f, combattantId) !== null);

  if (retenus.length === 0) return { aDesCombats: false };

  const victoiresParMethode = compteursVides();
  const defaitesParMethode = compteursVides();
  const adversaires = new Map<string, BilanContre>();
  const parType = new Map<SubmissionType, number>();
  const tempsSoumission: number[] = [];

  let victoires = 0;
  let defaites = 0;
  let sansVainqueur = 0;
  let victoiresSansMethode = 0;
  let defaitesSansMethode = 0;
  let pointsMarques = 0;
  let pointsEncaisses = 0;
  let avantagesMarques = 0;
  let avantagesEncaisses = 0;
  let penalitesRecues = 0;
  let penalitesAdverses = 0;
  let combatsSansJournal = 0;
  let soumissionsPortees = 0;
  let typeNonReleve = 0;
  let tempsNonMesures = 0;

  for (const f of retenus) {
    const cote = coteDe(f, combattantId);
    if (cote === null) continue;
    const adverse = cote === "a" ? f.registrationB : f.registrationA;
    const gagne = f.winner != null && f.winner === combattantId;
    const perdu = f.winner != null && f.winner !== combattantId;
    const methode = methodeVictoireDe(f.winMethod);

    if (gagne) {
      victoires++;
      if (methode) victoiresParMethode[methode]++;
      else victoiresSansMethode++;
    } else if (perdu) {
      defaites++;
      if (methode) defaitesParMethode[methode]++;
      else defaitesSansMethode++;
    } else {
      sansVainqueur++;
    }

    if (adverse != null) {
      const bilan = adversaires.get(adverse) ?? { combats: 0, victoires: 0, defaites: 0 };
      adversaires.set(adverse, {
        combats: bilan.combats + 1,
        victoires: bilan.victoires + (gagne ? 1 : 0),
        defaites: bilan.defaites + (perdu ? 1 : 0),
      });
    }

    const s = f.scores;
    if (s == null) {
      combatsSansJournal++;
    } else if (cote === "a") {
      pointsMarques += s.pointsA;
      pointsEncaisses += s.pointsB;
      avantagesMarques += s.advantagesA;
      avantagesEncaisses += s.advantagesB;
      penalitesRecues += s.penaltiesA;
      penalitesAdverses += s.penaltiesB;
    } else {
      pointsMarques += s.pointsB;
      pointsEncaisses += s.pointsA;
      avantagesMarques += s.advantagesB;
      avantagesEncaisses += s.advantagesA;
      penalitesRecues += s.penaltiesB;
      penalitesAdverses += s.penaltiesA;
    }

    if (gagne && f.winMethod === "submission") {
      soumissionsPortees++;
      if (isSubmissionType(f.submissionType)) {
        parType.set(f.submissionType, (parType.get(f.submissionType) ?? 0) + 1);
      } else {
        typeNonReleve++;
      }
      const ms = f.finishClockMs;
      if (ms != null && Number.isFinite(ms) && ms >= 0) tempsSoumission.push(ms);
      else tempsNonMesures++;
    }
  }

  return {
    aDesCombats: true,
    combats: retenus.length,
    victoires,
    defaites,
    sansVainqueur,
    victoiresParMethode,
    defaitesParMethode,
    victoiresSansMethode,
    defaitesSansMethode,
    adversairesDistincts: adversaires.size,
    adversaires,
    pointsMarques,
    pointsEncaisses,
    avantagesMarques,
    avantagesEncaisses,
    penalitesRecues,
    penalitesAdverses,
    combatsSansJournal,
    soumissions: {
      total: soumissionsPortees,
      parType,
      typeNonReleve,
      tempsMesures: tempsSoumission.length,
      tempsNonMesures,
      plusRapideMs: minimum(tempsSoumission),
      medianeMs: mediane(tempsSoumission),
    },
  };
}

function minimum(valeurs: readonly number[]): number | null {
  if (valeurs.length === 0) return null;
  return valeurs.reduce((min, v) => (v < min ? v : min), valeurs[0] as number);
}

function mediane(valeurs: readonly number[]): number | null {
  if (valeurs.length === 0) return null;
  const tries = [...valeurs].sort((x, y) => x - y);
  const milieu = Math.floor(tries.length / 2);
  if (tries.length % 2 === 1) return tries[milieu] as number;
  return ((tries[milieu - 1] as number) + (tries[milieu] as number)) / 2;
}

export type Rencontre = {
  readonly fightId: string;
  readonly vainqueur: string | null;
  readonly winMethod: WinMethod | null;
  readonly submissionType: SubmissionType | null;
};

export type FaceAFace =
  | { readonly seSontRencontres: false }
  | {
      readonly seSontRencontres: true;
      readonly combats: number;
      readonly victoiresA: number;
      readonly victoiresB: number;
      readonly sansVainqueur: number;
      readonly rencontres: readonly Rencontre[];
    };

export function faceAFace(
  combattantA: string,
  combattantB: string,
  fights: readonly FightRecord[],
): FaceAFace {
  if (combattantA === combattantB) return { seSontRencontres: false };

  const rencontres: Rencontre[] = [];
  let victoiresA = 0;
  let victoiresB = 0;
  let sansVainqueur = 0;

  for (const f of combatsRetenus(fights)) {
    const coteA = coteDe(f, combattantA);
    const coteB = coteDe(f, combattantB);
    if (coteA === null || coteB === null || coteA === coteB) continue;

    if (f.winner === combattantA) victoiresA++;
    else if (f.winner === combattantB) victoiresB++;
    else sansVainqueur++;

    rencontres.push({
      fightId: f.fightId,
      vainqueur: f.winner,
      winMethod: f.winMethod ?? null,
      submissionType: isSubmissionType(f.submissionType) ? f.submissionType : null,
    });
  }

  if (rencontres.length === 0) return { seSontRencontres: false };
  return {
    seSontRencontres: true,
    combats: rencontres.length,
    victoiresA,
    victoiresB,
    sansVainqueur,
    rencontres,
  };
}

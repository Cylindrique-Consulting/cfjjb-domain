import {
  construireConstat,
  controlerLePlanning,
  type Constat,
  type EngagementControle,
} from "./controles-de-planning";
import {
  ESPACEMENT_PAR_DEFAUT_SECONDES,
  planifierCombats,
  type CreneauOccupe,
  type EntreeDePlanification,
  type ResultatDePlanification,
} from "./ordonnanceur-planning";

export type EngagementDeCompetition = {
  athleteId: string;
  categorieId: string;
};

export type CompetitionDeLEvenement = {
  id: string;
  ordre: number;
  jour: number;
  debutSaisiMs?: number;
  planification: Omit<EntreeDePlanification, "debutAuPlusTotMs" | "occupations">;
  engagements?: readonly EngagementDeCompetition[];
};

export type OptionsDEvenement = {
  espacementEntreCompetitionsSecondes?: number;
};

export type ResultatDEvenement = {
  competitions: Map<string, ResultatDePlanification>;
  debutsRetenus: Map<string, number>;
  finsPrevues: Map<string, number>;
  engagements: EngagementControle[];
  conflits: Constat[];
};

function comparerChaines(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function premierCombatDeLAthlete(
  competition: CompetitionDeLEvenement,
  resultat: ResultatDePlanification,
  engagement: EngagementDeCompetition,
): number | null {
  let premier: number | null = null;
  for (const combat of competition.planification.combats) {
    if (combat.categorieId !== engagement.categorieId) continue;
    if (combat.athletes?.includes(engagement.athleteId) !== true) continue;
    const place = resultat.combats.get(combat.id);
    if (place === undefined) continue;
    if (premier === null || place.debutMs < premier) premier = place.debutMs;
  }
  return premier;
}

export function planifierLEvenement(
  competitions: readonly CompetitionDeLEvenement[],
  options: OptionsDEvenement = {},
): ResultatDEvenement {
  const espacementMs =
    Math.max(0, options.espacementEntreCompetitionsSecondes ?? ESPACEMENT_PAR_DEFAUT_SECONDES) *
    1000;

  const ordonnees = [...competitions].sort(
    (a, b) => a.jour - b.jour || a.ordre - b.ordre || comparerChaines(a.id, b.id),
  );

  const resultats = new Map<string, ResultatDePlanification>();
  const debutsRetenus = new Map<string, number>();
  const finsPrevues = new Map<string, number>();
  const engagements: EngagementControle[] = [];
  const conflits: Constat[] = [];

  const finDuJour = new Map<number, number>();
  const derniereDuJour = new Map<number, CompetitionDeLEvenement>();
  const occupationsDuJour = new Map<number, CreneauOccupe[]>();

  for (const competition of ordonnees) {
    const precedente = derniereDuJour.get(competition.jour);
    const finPrecedente = finDuJour.get(competition.jour);
    let debut: number;
    if (competition.debutSaisiMs !== undefined) {
      debut = competition.debutSaisiMs;
    } else if (finPrecedente !== undefined) {
      debut = finPrecedente + espacementMs;
    } else {
      throw new Error(
        `enchaînement : la première compétition de la journée ${competition.jour} ` +
          `(${competition.id}) doit porter une heure de début.`,
      );
    }

    if (
      precedente !== undefined &&
      finPrecedente !== undefined &&
      debut < finPrecedente + espacementMs
    ) {
      conflits.push(
        construireConstat({
          type: "chevauchement_de_competitions",
          competitionId: competition.id,
          autreCompetitionId: precedente.id,
          jour: competition.jour,
          ecartMinutes: Math.round((finPrecedente + espacementMs - debut) / 60_000),
        }),
      );
    }

    const resultat = planifierCombats({
      ...competition.planification,
      debutAuPlusTotMs: debut,
      occupations: occupationsDuJour.get(competition.jour) ?? [],
    });

    resultats.set(competition.id, resultat);
    debutsRetenus.set(competition.id, debut);
    const fin = resultat.finParJour.get(competition.jour) ?? debut;
    finsPrevues.set(competition.id, fin);
    finDuJour.set(competition.jour, Math.max(finPrecedente ?? fin, fin));
    derniereDuJour.set(competition.jour, competition);

    const durees = new Map(
      competition.planification.categories.map((c) => [c.id, c.dureeSecondes]),
    );
    const creneaux = occupationsDuJour.get(competition.jour) ?? [];
    for (const engagement of competition.engagements ?? []) {
      const plan = resultat.categories.get(engagement.categorieId);
      if (plan === undefined) continue;
      engagements.push({
        athleteId: engagement.athleteId,
        categorieId: engagement.categorieId,
        competitionId: competition.id,
        jour: plan.jour,
        debutMs: plan.debutMs,
        finMs: plan.finMs,
        premierCombatMs: premierCombatDeLAthlete(competition, resultat, engagement) ?? plan.debutMs,
        dureeSecondes: durees.get(engagement.categorieId) ?? 0,
      });
      creneaux.push({
        athleteId: engagement.athleteId,
        debutMs: plan.debutMs,
        finMs: plan.finMs,
        origine: `${competition.id}:${engagement.categorieId}`,
      });
    }
    occupationsDuJour.set(competition.jour, creneaux);
  }

  conflits.push(...controlerLePlanning({ engagements }));

  return { competitions: resultats, debutsRetenus, finsPrevues, engagements, conflits };
}

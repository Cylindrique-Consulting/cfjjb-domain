import type { BracketFightType } from "./bracket-generator";
import { multiplicateurDeRepos } from "./fight-rest";
import type { EtatDeProposition } from "./repartition-tatamis";

export type GraviteDeControle = "refus" | "bloquant" | "avertissement";

export type TypeDeConstat =
  | "source_apres_dependant"
  | "double_convocation"
  | "repos_insuffisant"
  | "depassement_de_journee"
  | "desequilibre_de_tatami"
  | "chevauchement_de_competitions"
  | "repartition_non_examinee";

// Un repos insuffisant est accepté dans le brouillon mais bloque la publication
// tant qu'il n'est pas corrigé, comme une double convocation (RPS.3 B, réponse
// du client du 25/09/2026) : aucune confirmation ne le lève.
export const GRAVITE_PAR_TYPE: Readonly<Record<TypeDeConstat, GraviteDeControle>> = {
  source_apres_dependant: "refus",
  double_convocation: "bloquant",
  repos_insuffisant: "bloquant",
  depassement_de_journee: "avertissement",
  desequilibre_de_tatami: "avertissement",
  chevauchement_de_competitions: "avertissement",
  repartition_non_examinee: "avertissement",
};

export const ECART_DE_DESEQUILIBRE_MINUTES = 60;

export type Constat = {
  type: TypeDeConstat;
  gravite: GraviteDeControle;
  cle: string;
  combatId?: string;
  autreCombatId?: string;
  athleteId?: string;
  categorieId?: string;
  autreCategorieId?: string;
  competitionId?: string;
  autreCompetitionId?: string;
  tatamiId?: string;
  jour?: number;
  ecartMinutes?: number;
};

export type CombatControle = {
  fightId: string;
  competitionId?: string;
  categorieId: string;
  tatamiId: string;
  jour: number;
  rang: number;
  debutMs: number;
  finMs: number;
  division: number;
  type: BracketFightType;
  dureeSecondes: number;
  sources?: readonly (string | null)[];
};

export type EngagementControle = {
  athleteId: string;
  categorieId: string;
  competitionId?: string;
  jour: number;
  debutMs: number;
  finMs: number;
  premierCombatMs?: number;
  dureeSecondes: number;
  reposAvantSecondes?: number;
};

export type JourneeControlee = {
  jour: number;
  finMs?: number;
};

export type CategorieControlee = {
  id: string;
  competitionId?: string;
  tatamis?: number;
  etatDeRepartition?: EtatDeProposition;
};

export type EntreeDeControle = {
  combats?: readonly CombatControle[];
  engagements?: readonly EngagementControle[];
  journees?: readonly JourneeControlee[];
  categories?: readonly CategorieControlee[];
};

const MINUTE_MS = 60_000;

function comparerChaines(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function minutes(ms: number): number {
  return Math.round(ms / MINUTE_MS);
}

export function construireConstat(partiel: Omit<Constat, "gravite" | "cle">): Constat {
  const cle = [
    partiel.type,
    partiel.competitionId ?? "",
    partiel.combatId ?? partiel.categorieId ?? "",
    partiel.autreCombatId ?? partiel.autreCategorieId ?? "",
    partiel.athleteId ?? "",
    partiel.tatamiId ?? "",
    partiel.jour === undefined ? "" : String(partiel.jour),
  ].join("|");
  return { ...partiel, gravite: GRAVITE_PAR_TYPE[partiel.type], cle };
}

function reposDuCombatControle(combat: CombatControle): number {
  return (
    multiplicateurDeRepos({ division: combat.division, type: combat.type }) *
    Math.max(0, combat.dureeSecondes) *
    1000
  );
}

function controlerLesDependances(combats: readonly CombatControle[]): Constat[] {
  const parId = new Map(combats.map((c) => [c.fightId, c]));
  const constats: Constat[] = [];
  for (const combat of combats) {
    const reposMs = reposDuCombatControle(combat);
    for (const sourceId of combat.sources ?? []) {
      if (sourceId === null) continue;
      const source = parId.get(sourceId);
      if (source === undefined) continue;
      const memeTatami = source.tatamiId === combat.tatamiId && source.jour === combat.jour;
      const refuse =
        source.jour > combat.jour ||
        source.finMs > combat.debutMs ||
        (memeTatami && source.rang > combat.rang);
      if (refuse) {
        constats.push(
          construireConstat({
            type: "source_apres_dependant",
            combatId: combat.fightId,
            autreCombatId: source.fightId,
            categorieId: combat.categorieId,
            competitionId: combat.competitionId,
            tatamiId: combat.tatamiId,
            jour: combat.jour,
            ecartMinutes: minutes(source.finMs - combat.debutMs),
          }),
        );
        continue;
      }
      if (combat.debutMs < source.finMs + reposMs) {
        constats.push(
          construireConstat({
            type: "repos_insuffisant",
            combatId: combat.fightId,
            autreCombatId: source.fightId,
            categorieId: combat.categorieId,
            competitionId: combat.competitionId,
            tatamiId: combat.tatamiId,
            jour: combat.jour,
            ecartMinutes: minutes(source.finMs + reposMs - combat.debutMs),
          }),
        );
      }
    }
  }
  return constats;
}

function controlerLesEngagements(engagements: readonly EngagementControle[]): Constat[] {
  const parAthlete = new Map<string, EngagementControle[]>();
  for (const engagement of engagements) {
    const liste = parAthlete.get(engagement.athleteId);
    if (liste) liste.push(engagement);
    else parAthlete.set(engagement.athleteId, [engagement]);
  }
  const constats: Constat[] = [];
  for (const athlete of [...parAthlete.keys()].sort(comparerChaines)) {
    const liste = [...(parAthlete.get(athlete) ?? [])].sort(
      (a, b) =>
        a.jour - b.jour ||
        a.debutMs - b.debutMs ||
        comparerChaines(a.competitionId ?? "", b.competitionId ?? "") ||
        comparerChaines(a.categorieId, b.categorieId),
    );
    for (let i = 0; i < liste.length; i += 1) {
      for (let j = i + 1; j < liste.length; j += 1) {
        const premier = liste[i];
        const second = liste[j];
        if (premier === undefined || second === undefined) continue;
        if (premier.jour !== second.jour) continue;
        if (premier.categorieId === second.categorieId) continue;
        if (premier.debutMs < second.finMs && second.debutMs < premier.finMs) {
          constats.push(
            construireConstat({
              type: "double_convocation",
              athleteId: athlete,
              categorieId: premier.categorieId,
              autreCategorieId: second.categorieId,
              competitionId: premier.competitionId,
              autreCompetitionId: second.competitionId,
              jour: premier.jour,
            }),
          );
          continue;
        }
        const reposMs = Math.max(0, second.reposAvantSecondes ?? second.dureeSecondes) * 1000;
        const premierCombat = second.premierCombatMs ?? second.debutMs;
        if (premierCombat < premier.finMs + reposMs) {
          constats.push(
            construireConstat({
              type: "repos_insuffisant",
              athleteId: athlete,
              categorieId: second.categorieId,
              autreCategorieId: premier.categorieId,
              competitionId: second.competitionId,
              autreCompetitionId: premier.competitionId,
              jour: second.jour,
              ecartMinutes: minutes(premier.finMs + reposMs - premierCombat),
            }),
          );
        }
      }
    }
  }
  return constats;
}

type FinDeTatami = { tatamiId: string; jour: number; finMs: number };

function finsDeTatami(combats: readonly CombatControle[]): FinDeTatami[] {
  const fins = new Map<string, FinDeTatami>();
  for (const combat of combats) {
    const cle = `${combat.tatamiId}|${combat.jour}`;
    const connue = fins.get(cle);
    if (connue === undefined) {
      fins.set(cle, { tatamiId: combat.tatamiId, jour: combat.jour, finMs: combat.finMs });
    } else if (combat.finMs > connue.finMs) {
      connue.finMs = combat.finMs;
    }
  }
  return [...fins.values()].sort(
    (a, b) => a.jour - b.jour || comparerChaines(a.tatamiId, b.tatamiId),
  );
}

function controlerLesHorairesDeJournee(
  combats: readonly CombatControle[],
  journees: readonly JourneeControlee[],
): Constat[] {
  const fins = finsDeTatami(combats);
  const finDeJournee = new Map(journees.map((j) => [j.jour, j.finMs]));
  const constats: Constat[] = [];

  for (const fin of fins) {
    const butoir = finDeJournee.get(fin.jour);
    if (butoir === undefined || fin.finMs <= butoir) continue;
    constats.push(
      construireConstat({
        type: "depassement_de_journee",
        tatamiId: fin.tatamiId,
        jour: fin.jour,
        ecartMinutes: minutes(fin.finMs - butoir),
      }),
    );
  }

  const jours = [...new Set(fins.map((f) => f.jour))].sort((a, b) => a - b);
  for (const jour of jours) {
    const duJour = fins.filter((f) => f.jour === jour);
    if (duJour.length < 2) continue;
    for (const fin of duJour) {
      const autres = duJour.filter((f) => f.tatamiId !== fin.tatamiId);
      if (autres.length === 0) continue;
      const moyenne = autres.reduce((somme, f) => somme + f.finMs, 0) / autres.length;
      // Dans les deux sens : un tatami qui finit bien après les autres, ou bien
      // avant eux (écart négatif), alors qu'il pourrait reprendre leur travail.
      const ecart = minutes(fin.finMs - moyenne);
      if (Math.abs(ecart) <= ECART_DE_DESEQUILIBRE_MINUTES) continue;
      constats.push(
        construireConstat({
          type: "desequilibre_de_tatami",
          tatamiId: fin.tatamiId,
          jour,
          ecartMinutes: ecart,
        }),
      );
    }
  }
  return constats;
}

function controlerLesRepartitions(categories: readonly CategorieControlee[]): Constat[] {
  const constats: Constat[] = [];
  for (const categorie of categories) {
    if (categorie.etatDeRepartition !== "proposee") continue;
    if ((categorie.tatamis ?? 1) <= 1) continue;
    constats.push(
      construireConstat({
        type: "repartition_non_examinee",
        categorieId: categorie.id,
        competitionId: categorie.competitionId,
      }),
    );
  }
  return constats;
}

export function controlerLePlanning(entree: EntreeDeControle): Constat[] {
  const combats = entree.combats ?? [];
  return [
    ...controlerLesDependances(combats),
    ...controlerLesEngagements(entree.engagements ?? []),
    ...controlerLesHorairesDeJournee(combats, entree.journees ?? []),
    ...controlerLesRepartitions(entree.categories ?? []),
  ];
}

export type VerdictDePublication = {
  publiable: boolean;
  refus: Constat[];
  bloquants: Constat[];
  aConfirmer: Constat[];
  confirmationsInutiles: string[];
};

export function verdictDePublication(
  constats: readonly Constat[],
  confirmations: readonly string[] = [],
): VerdictDePublication {
  const confirmees = new Set(confirmations);
  const refus = constats.filter((c) => c.gravite === "refus");
  const bloquants = constats.filter((c) => c.gravite === "bloquant");
  const aConfirmer = constats.filter(
    (c) => c.gravite === "avertissement" && !confirmees.has(c.cle),
  );
  const presentes = new Set(constats.map((c) => c.cle));
  const confirmationsInutiles = [...confirmees].filter((cle) => !presentes.has(cle)).sort();
  return {
    publiable: refus.length === 0 && bloquants.length === 0 && aConfirmer.length === 0,
    refus,
    bloquants,
    aConfirmer,
    confirmationsInutiles,
  };
}

export function confirmationsConservees(
  confirmations: readonly string[],
  constatsApresRetouche: readonly Constat[],
): string[] {
  const presentes = new Set(constatsApresRetouche.map((c) => c.cle));
  return [...new Set(confirmations)].filter((cle) => presentes.has(cle)).sort();
}

export type ProfilDePlanning = {
  compteFederalAutoriseAModifier?: boolean;
  responsableDesigneSurLaFiche?: boolean;
  identifiantDePostePartage?: boolean;
};

function comptePersonnel(profil: ProfilDePlanning): boolean {
  return profil.identifiantDePostePartage !== true;
}

export function peutConsulterAvantPublication(profil: ProfilDePlanning): boolean {
  if (!comptePersonnel(profil)) return false;
  return (
    profil.compteFederalAutoriseAModifier === true || profil.responsableDesigneSurLaFiche === true
  );
}

export function peutGenererOuRetoucherLePlanning(profil: ProfilDePlanning): boolean {
  return comptePersonnel(profil) && profil.compteFederalAutoriseAModifier === true;
}

export function peutValiderLePlanning(profil: ProfilDePlanning): boolean {
  return peutConsulterAvantPublication(profil);
}

export function peutPublierLePlanning(profil: ProfilDePlanning): boolean {
  return peutGenererOuRetoucherLePlanning(profil);
}

export type StatutDePlanning = "brouillon" | "valide" | "publie" | "modifie_apres_publication";

export type EtatDePlanning = {
  valide: boolean;
  publieLe: number | null;
  retoucheLe: number | null;
};

export function statutDePlanning(etat: EtatDePlanning): StatutDePlanning {
  if (etat.publieLe === null) return etat.valide ? "valide" : "brouillon";
  if (etat.retoucheLe !== null && etat.retoucheLe > etat.publieLe) {
    return "modifie_apres_publication";
  }
  return "publie";
}

export type EntreeDePublicationAutomatique = {
  statut: StatutDePlanning;
  publicationPrevueMs: number | null;
  maintenantMs: number;
};

export type VerdictDePublicationAutomatique = "publier" | "alerter" | "attendre" | "rien_a_faire";

export function publicationAutomatique(
  entree: EntreeDePublicationAutomatique,
): VerdictDePublicationAutomatique {
  const echeance = entree.publicationPrevueMs;
  if (echeance === null) return "rien_a_faire";
  if (entree.maintenantMs < echeance) return "attendre";
  if (entree.statut === "valide") return "publier";
  if (entree.statut === "brouillon") return "alerter";
  return "rien_a_faire";
}

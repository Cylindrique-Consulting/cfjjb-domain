import type { BracketFightType } from "./bracket-generator";
import { resolveWeightClass } from "./db-vocabulary";
import type { BeltDb } from "./enums";
import type { WeightClassName } from "./referential";

export const DELAI_INSCRIPTION_ABSOLUT_MINUTES = 20;

export const TAPIS_ADMIS_ABSOLUT: readonly number[] = [1, 2, 4, 8];

export const FAMILLE_DES_GRADES_NOIRS: readonly BeltDb[] = ["black", "coral", "red"];

export type GroupeAbsolutJuvenile = "Leve" | "Pesado";

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

export function estNoireAdulte(
  belt: BeltDb | string | null | undefined,
  ageGroup: string | null | undefined,
): boolean {
  if (belt === null || belt === undefined) return false;
  if (!(FAMILLE_DES_GRADES_NOIRS as readonly string[]).includes(belt)) return false;
  const tranche = normaliser(ageGroup);
  return tranche === "adulte" || tranche === "adult";
}

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

export function estTrancheJuvenile(ageGroup: string | null | undefined): boolean {
  return TRANCHES_JUVENILES.has(normaliser(ageGroup));
}

export type PerimetreAbsolut = {
  verdict: OuvertureAbsolut;
  groupe: GroupeAbsolutJuvenile | null;
};

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

export type StatutAbsolut = "open" | "closed" | "generated" | "cancelled";

export type CauseClotureAbsolut = "delai" | "heure_limite" | "anticipee" | "manuelle";

export type SourceAbsolut = { terminee: boolean; termineeLe: number | null };

export type EntreeInscriptionsAbsolut = {
  statut: StatutAbsolut;
  rouvert: boolean;
  noireAdulte: boolean;
  heureLimite: number | null;
  sources: readonly SourceAbsolut[];
  maintenant: number;
};

export type EtatInscriptionsAbsolut = {
  statutEffectif: StatutAbsolut;
  t0: number | null;
  echeance: number | null;
};

const MINUTE_MS = 60_000;

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

export function statutALaCloture(inscritsActifs: number): "closed" | "cancelled" {
  return inscritsActifs === 1 ? "cancelled" : "closed";
}

export type ManqueGenerationAbsolut =
  | "annule"
  | "deja_genere"
  | "heure_limite_non_definie"
  | "inscriptions_ouvertes"
  | "sources_non_terminees"
  | "delai_en_cours"
  | "un_seul_inscrit";

export type EntreeGenerationAbsolut = EntreeInscriptionsAbsolut & {
  attendLesPoids: boolean;
  closedCause: CauseClotureAbsolut | null;
  inscritsActifs: number;
};

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

export function nombreDeTapisAdmis(nTapis: number): boolean {
  return TAPIS_ADMIS_ABSOLUT.includes(nTapis);
}

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

export type ScenarioGroupeJuvenile = {
  weightClass: string | null;
  attendu: GroupeAbsolutJuvenile | null;
};

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

export type ScenarioInscriptionsAbsolut = {
  id: string;
  statut: StatutAbsolut;
  rouvert: boolean;
  noireAdulte: boolean;
  heureLimiteDans: number | null;
  sourcesTermineesIlYa: readonly (number | null)[];
  attendu: {
    statutEffectif: StatutAbsolut;
    echeanceDans: number | null;
  };
};

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

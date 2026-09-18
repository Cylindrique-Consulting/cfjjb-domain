import { TAPIS_ADMIS_ABSOLUT } from "./absolut-regles";
import type { BracketFightType } from "./bracket-generator";
import type { DrawFormat } from "./competition-format";

export const NOMBRES_DE_TATAMIS_ADMIS: readonly number[] = TAPIS_ADMIS_ABSOLUT;

export const INSCRITS_MAXIMUM_PAR_CATEGORIE = 128;

export function estNombreDeTatamisAdmis(nombre: number): boolean {
  return NOMBRES_DE_TATAMIS_ADMIS.includes(nombre);
}

export function plafondDeRepartition(tatamisDeLaCompetition: number): number {
  let plafond = 1;
  for (const nombre of NOMBRES_DE_TATAMIS_ADMIS) {
    if (nombre <= tatamisDeLaCompetition) plafond = nombre;
  }
  return plafond;
}

export function valeursAdmisesDeRepartition(tatamisDeLaCompetition: number): number[] {
  const plafond = plafondDeRepartition(tatamisDeLaCompetition);
  return NOMBRES_DE_TATAMIS_ADMIS.filter((nombre) => nombre <= plafond);
}

const SEUILS_D_EFFECTIF: readonly { jusqua: number; tatamis: number }[] = [
  { jusqua: 16, tatamis: 1 },
  { jusqua: 32, tatamis: 2 },
  { jusqua: 64, tatamis: 4 },
];

export function tatamisSelonLEffectif(inscrits: number): number {
  for (const seuil of SEUILS_D_EFFECTIF) {
    if (inscrits <= seuil.jusqua) return seuil.tatamis;
  }
  return 8;
}

export type MotifDeProposition = "format_non_reparti" | "effectif" | "plafonne_par_la_competition";

export type EntreeDeProposition = {
  inscrits: number;
  tatamisDeLaCompetition: number;
  format?: DrawFormat;
};

export type PropositionDeRepartition = {
  proposition: number;
  valeursAdmises: number[];
  alternativeSuggeree: number | null;
  motif: MotifDeProposition;
};

export function proposerLaRepartition(entree: EntreeDeProposition): PropositionDeRepartition {
  const valeursAdmises = valeursAdmisesDeRepartition(entree.tatamisDeLaCompetition);
  const plafond = plafondDeRepartition(entree.tatamisDeLaCompetition);
  if (entree.format === "pools" || entree.inscrits <= 3) {
    return {
      proposition: 1,
      valeursAdmises,
      alternativeSuggeree: null,
      motif: "format_non_reparti",
    };
  }
  const selonEffectif = tatamisSelonLEffectif(entree.inscrits);
  const proposition = Math.min(selonEffectif, plafond);
  const alternative = entree.inscrits <= 32 ? Math.min(proposition * 2, plafond) : null;
  return {
    proposition,
    valeursAdmises,
    alternativeSuggeree: alternative !== null && alternative > proposition ? alternative : null,
    motif: proposition < selonEffectif ? "plafonne_par_la_competition" : "effectif",
  };
}

export type EtatDeProposition = "proposee" | "acceptee" | "modifiee" | "refusee";

export function tatamisApresArbitrage(
  proposition: PropositionDeRepartition,
  arbitrage: { etat: EtatDeProposition; valeurChoisie?: number },
): number {
  if (arbitrage.etat === "refusee") return 1;
  if (arbitrage.etat === "modifiee") {
    const choisie = arbitrage.valeurChoisie;
    if (choisie === undefined || !proposition.valeursAdmises.includes(choisie)) {
      throw new RangeError(
        `nombre de tatamis non admis pour une catégorie répartie : ${String(choisie)}`,
      );
    }
    return choisie;
  }
  return proposition.proposition;
}

export type CombatARepartir = {
  division: number;
  indexInDivision: number;
  type: BracketFightType;
};

export type PartiesDuCombat = {
  partie: number;
  partiesReunies: number[];
  convergence: boolean;
};

export function partiesDuCombat(combat: CombatARepartir, parties: number): PartiesDuCombat {
  if (!estNombreDeTatamisAdmis(parties)) {
    throw new RangeError(`nombre de parties non admis pour une catégorie répartie : ${parties}`);
  }
  const toutes = Array.from({ length: parties }, (_, index) => index);
  if (parties === 1) {
    return { partie: 0, partiesReunies: toutes, convergence: false };
  }
  if (combat.type !== "BraketFight" || combat.division <= 1) {
    return { partie: 0, partiesReunies: toutes, convergence: true };
  }
  const combatsDuTour = 2 ** (combat.division - 1);
  if (combatsDuTour >= parties) {
    const brut = Math.floor((combat.indexInDivision * parties) / combatsDuTour);
    const partie = Math.min(parties - 1, Math.max(0, brut));
    return { partie, partiesReunies: [partie], convergence: false };
  }
  const largeur = parties / combatsDuTour;
  const brut = combat.indexInDivision * largeur;
  const debut = Math.min(parties - largeur, Math.max(0, brut));
  return {
    partie: debut,
    partiesReunies: Array.from({ length: largeur }, (_, index) => debut + index),
    convergence: true,
  };
}

export type TatamiDeRepartition = {
  id: string;
  numero: number;
};

export type EntreeDeRepartition = {
  tatamis: readonly TatamiDeRepartition[];
  combats: readonly (CombatARepartir & { id: string })[];
  chargeParTatami?: Readonly<Record<string, number>>;
  tatamiParCombat?: Readonly<Record<string, string>>;
};

export type PlaceDeCombat = {
  fightId: string;
  tatamiId: string;
  partie: number;
  partiesReunies: number[];
  convergence: boolean;
  libelleDePartie: string | null;
};

export function libelleDePartie(partie: number, parties: number): string | null {
  if (parties <= 1) return null;
  return `Partie ${partie + 1}/${parties}`;
}

function tatamiLePlusTardif(
  tatamis: readonly TatamiDeRepartition[],
  partiesReunies: readonly number[],
  chargeParTatami: Readonly<Record<string, number>>,
): TatamiDeRepartition | null {
  let choix: TatamiDeRepartition | null = null;
  for (const partie of partiesReunies) {
    const candidat = tatamis[partie];
    if (candidat === undefined) continue;
    if (choix === null) {
      choix = candidat;
      continue;
    }
    const chargeCandidat = chargeParTatami[candidat.id] ?? 0;
    const chargeChoix = chargeParTatami[choix.id] ?? 0;
    if (chargeCandidat > chargeChoix) choix = candidat;
    else if (chargeCandidat === chargeChoix && candidat.numero < choix.numero) choix = candidat;
  }
  return choix;
}

export function repartirLesCombats(entree: EntreeDeRepartition): Map<string, PlaceDeCombat> {
  const parties = entree.tatamis.length;
  if (!estNombreDeTatamisAdmis(parties)) {
    throw new RangeError(`nombre de parties non admis pour une catégorie répartie : ${parties}`);
  }
  const charge = entree.chargeParTatami ?? {};
  const choix = entree.tatamiParCombat ?? {};
  const places = new Map<string, PlaceDeCombat>();

  for (const combat of entree.combats) {
    const decoupe = partiesDuCombat(combat, parties);
    const admis = new Set(
      decoupe.partiesReunies
        .map((partie) => entree.tatamis[partie]?.id)
        .filter((id): id is string => id !== undefined),
    );
    const impose = choix[combat.id];
    let tatamiId: string;
    if (impose !== undefined) {
      if (!admis.has(impose)) {
        throw new RangeError(
          "tatami choisi hors des parties réunies par ce combat : " +
            `${combat.id} ne peut se jouer que sur ${[...admis].join(", ")}`,
        );
      }
      tatamiId = impose;
    } else {
      const defaut = decoupe.convergence
        ? tatamiLePlusTardif(entree.tatamis, decoupe.partiesReunies, charge)
        : (entree.tatamis[decoupe.partie] ?? null);
      if (defaut === null) {
        throw new RangeError(`aucun tatami disponible pour le combat ${combat.id}`);
      }
      tatamiId = defaut.id;
    }
    places.set(combat.id, {
      fightId: combat.id,
      tatamiId,
      partie: decoupe.partie,
      partiesReunies: decoupe.partiesReunies,
      convergence: decoupe.convergence,
      libelleDePartie: decoupe.convergence ? null : libelleDePartie(decoupe.partie, parties),
    });
  }

  return places;
}

export function libelleDesTatamis(numeros: readonly number[]): string {
  const uniques = [...new Set(numeros)].sort((a, b) => a - b);
  if (uniques.length === 0) return "";
  const premier = uniques[0];
  const dernier = uniques[uniques.length - 1];
  if (premier === undefined || dernier === undefined) return "";
  if (uniques.length === 1) return `Tatami ${premier}`;
  if (dernier - premier === uniques.length - 1) {
    return uniques.length === 2
      ? `Tatamis ${premier} et ${dernier}`
      : `Tatamis ${premier} à ${dernier}`;
  }
  return `Tatamis ${uniques.slice(0, -1).join(", ")} et ${dernier}`;
}

export type CategorieAAffecter = {
  id: string;
  chargeSecondes: number;
  parties: number;
  rangDePlanning: number;
};

export type AffectationDeCategorie = {
  categorieId: string;
  tatamis: TatamiDeRepartition[];
  parties: number;
  rangDePlanning: number;
};

export function affecterLesTatamis(
  categories: readonly CategorieAAffecter[],
  tatamis: readonly TatamiDeRepartition[],
): Map<string, AffectationDeCategorie> {
  if (tatamis.length === 0) {
    throw new Error("affectation : la compétition doit compter au moins un tatami.");
  }
  const disponibles = [...tatamis].sort((a, b) => a.numero - b.numero);
  const charge = new Map<string, number>(disponibles.map((t) => [t.id, 0]));

  const parCharge = [...categories].sort(
    (a, b) =>
      b.chargeSecondes - a.chargeSecondes ||
      a.rangDePlanning - b.rangDePlanning ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );

  const affectations = new Map<string, AffectationDeCategorie>();
  for (const categorie of parCharge) {
    const parties = Math.min(categorie.parties, plafondDeRepartition(disponibles.length));
    if (!estNombreDeTatamisAdmis(parties)) {
      throw new RangeError(
        `nombre de parties non admis pour la catégorie ${categorie.id} : ${categorie.parties}`,
      );
    }
    const choisis = [...disponibles]
      .sort((a, b) => (charge.get(a.id) ?? 0) - (charge.get(b.id) ?? 0) || a.numero - b.numero)
      .slice(0, parties)
      .sort((a, b) => a.numero - b.numero);
    const part = categorie.chargeSecondes / parties;
    for (const tatami of choisis) charge.set(tatami.id, (charge.get(tatami.id) ?? 0) + part);
    affectations.set(categorie.id, {
      categorieId: categorie.id,
      tatamis: choisis,
      parties,
      rangDePlanning: categorie.rangDePlanning,
    });
  }
  return affectations;
}

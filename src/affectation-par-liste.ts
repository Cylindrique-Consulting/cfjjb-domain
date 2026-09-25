import {
  rangTatamiPrioritaire,
  trierPourLeDepart,
  type CategoriePourPriorite,
} from "./priorite-de-planning";

/**
 * L'AFFECTATION DES CATÉGORIES AUX TATAMIS PAR LISTE (ORD.1 A, ORD.8 A,
 * réponses du client du 25/09/2026).
 *
 * Les catégories partent dans l'ordre de `trierPourLeDepart`, qui n'est jamais
 * enfreint (ORD.8 A) : un tatami qui se libère prend la catégorie suivante de
 * la file, sans attendre les autres. Quand plusieurs tatamis sont libres au
 * même instant, les catégories de tête qui y tiennent forment un LOT, et la
 * liste du §8 (`rangTatamiPrioritaire`) répartit les meilleurs tatamis du lot :
 * à 9 h, les noires adultes prennent les meilleurs, les bleues les autres, et
 * un meilleur tatami sans noire disponible prend une bleue (ORD.1 A).
 *
 * Une catégorie répartie sur plusieurs tatamis attend qu'ils soient libres :
 * si la tête de file en demande plus qu'il n'y en a de libres, elle prend ceux
 * qui se libèrent le plus tôt et commence quand le dernier d'entre eux se
 * libère. Sa charge se partage également entre ses tatamis.
 */

export type CategorieAAffecterParListe = CategoriePourPriorite & {
  chargeSecondes: number;
  parties: number;
};

export type TatamiParListe = {
  id: string;
  numero: number;
  rangQualite: number;
  libreDesSecondes?: number;
};

export type AffectationParListe = {
  categorieId: string;
  tatamiIds: string[];
  debutSecondes: number;
  finSecondes: number;
  rangDePlanning: number;
};

type EtatDuTatami = {
  id: string;
  numero: number;
  rangQualite: number;
  libre: number;
};

type ElementDuLot = {
  categorie: CategorieAAffecterParListe;
  rangDePlanning: number;
  parties: number;
};

function comparerChaines(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function comparerParQualite(a: EtatDuTatami, b: EtatDuTatami): number {
  return a.rangQualite - b.rangQualite || a.numero - b.numero || comparerChaines(a.id, b.id);
}

function comparerParNumero(a: EtatDuTatami, b: EtatDuTatami): number {
  return a.numero - b.numero || comparerChaines(a.id, b.id);
}

export function affecterParListe(
  categories: readonly CategorieAAffecterParListe[],
  tatamis: readonly TatamiParListe[],
): Map<string, AffectationParListe> {
  if (tatamis.length === 0) {
    throw new Error("affectation par liste : la compétition doit compter au moins un tatami.");
  }
  const etats: EtatDuTatami[] = tatamis.map((tatami) => ({
    id: tatami.id,
    numero: tatami.numero,
    rangQualite: tatami.rangQualite,
    libre: tatami.libreDesSecondes ?? 0,
  }));
  const total = etats.length;
  const partiesEffectives = (categorie: CategorieAAffecterParListe): number => {
    const demandees = Math.floor(categorie.parties);
    return Math.min(Number.isFinite(demandees) && demandees >= 1 ? demandees : 1, total);
  };

  const file = trierPourLeDepart(categories);
  const affectations = new Map<string, AffectationParListe>();

  const poser = (element: ElementDuLot, choisis: EtatDuTatami[], debut: number): void => {
    const fin = debut + Math.max(0, element.categorie.chargeSecondes) / element.parties;
    for (const tatami of choisis) tatami.libre = fin;
    affectations.set(element.categorie.id, {
      categorieId: element.categorie.id,
      tatamiIds: [...choisis].sort(comparerParNumero).map((tatami) => tatami.id),
      debutSecondes: debut,
      finSecondes: fin,
      rangDePlanning: element.rangDePlanning,
    });
  };

  let tete = 0;
  while (tete < file.length) {
    const instant = Math.min(...etats.map((tatami) => tatami.libre));
    const libres = etats.filter((tatami) => tatami.libre <= instant).sort(comparerParQualite);

    const lot: ElementDuLot[] = [];
    let demandes = 0;
    for (let rang = tete; rang < file.length; rang += 1) {
      const categorie = file[rang];
      if (categorie === undefined) break;
      const parties = partiesEffectives(categorie);
      if (demandes + parties > libres.length) break;
      lot.push({ categorie, rangDePlanning: rang, parties });
      demandes += parties;
    }

    if (lot.length === 0) {
      const categorie = file[tete];
      if (categorie === undefined) break;
      const parties = partiesEffectives(categorie);
      const choisis = [...etats]
        .sort((a, b) => a.libre - b.libre || comparerParQualite(a, b))
        .slice(0, parties);
      const debut = Math.max(...choisis.map((tatami) => tatami.libre));
      poser({ categorie, rangDePlanning: tete, parties }, choisis, debut);
      tete += 1;
      continue;
    }

    lot.sort(
      (a, b) =>
        rangTatamiPrioritaire(a.categorie) - rangTatamiPrioritaire(b.categorie) ||
        a.rangDePlanning - b.rangDePlanning,
    );
    let curseur = 0;
    for (const element of lot) {
      poser(element, libres.slice(curseur, curseur + element.parties), instant);
      curseur += element.parties;
    }
    tete += lot.length;
  }

  return affectations;
}

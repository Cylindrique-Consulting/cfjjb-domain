/**
 * LA NOMENCLATURE DES TOURS — une seule écriture pour les trois dépôts.
 *
 * Réponse du client du 15/09/2026 (T16.1 A, CI4.2 A, CI4.3 A, TR2.1 A) : le tour
 * d'un combat s'écrit sous DEUX formes, tirées de la même règle.
 *
 *   · forme COURTE sur les listes (check-in, ordre des combats, prochains
 *     combats, écrans de salle, vue publique) : T1, T2…, QF, DF, F, 3e ;
 *   · forme LONGUE sur les écrans d'un seul combat, les arbres et les feuilles
 *     papier : Tour 1…, Quart de finale, Demi-finale, Finale.
 *
 * Une troisième forme, `colonne`, sert les en-têtes de colonne d'un arbre : la
 * forme longue au pluriel quand la colonne regroupe plusieurs combats
 * (« Quarts de finale », « Demi-finales »).
 *
 * ┌─ POURQUOI LE NUMÉRO SE COMPTE DEPUIS LE PREMIER TOUR ─────────────────────┐
 * │ `division` compte à l'envers depuis la finale (1 = finale, 2 = demies). Le │
 * │ client ne retient ni « R4 » (compté depuis la finale) ni « 1er tour », mais│
 * │ T1, T2… comptés depuis le premier tour RÉELLEMENT disputé du tableau : un  │
 * │ tableau de 16 commence à T1, un tableau de 8 à QF, un tableau à deux       │
 * │ inscrits n'a que F. Test du client, tableau de 128 :                       │
 * │     T1, T2, T3, T4, QF, DF, F.                                             │
 * │ Le numéro exige donc la division MAXIMALE du tableau de la catégorie (ou   │
 * │ de l'absolut), calculée sur TOUTES ses lignes, byes compris : le tirage    │
 * │ écrit un arbre complet, et une fenêtre tronquée de combats donnerait un    │
 * │ numéro faux sans erreur visible.                                           │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ LE MOT « REPÊCHAGE » N'EST RENDU NULLE PART ─────────────────────────────┐
 * │ À trois inscrits, le combat « perdant de la 1re demi-finale contre le 3e   │
 * │ combattant » (type interne `BraketFightRepechage3`, gardé tel quel) est    │
 * │ une DEMI-FINALE : « Demi-finale » / « DF », comme la 1re (TR2.1 A). Seule  │
 * │ l'étiquette de l'éditeur de tableaux de la fédération dit « 2e             │
 * │ demi-finale », et c'est une rédaction de cet écran, pas un nom de tour.    │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * Décision interne notée : un combat de poule (`division = 0`, format inactif
 * par défaut) se nomme « Poule » / « P ».
 */

export type EntreeNomDuTour = {
  /** 1 = finale, 2 = demies, 3 = quarts, la plus profonde = premier tour, 0 = poule. */
  division: number;
  /**
   * La division la plus profonde du tableau de la catégorie (ou de l'absolut),
   * byes compris. Ne sert qu'aux tours numérotés (division ≥ 4).
   */
  divisionMax: number;
  /**
   * Le type interne (`BracketFightType`). Absent ou inconnu : traité comme un
   * combat ordinaire de l'arbre.
   */
  type?: string | null;
};

export type NomDuTour = {
  /** Forme abrégée des listes : « T1 », « QF », « DF », « F », « 3e ». */
  court: string;
  /** Forme longue d'un écran d'un seul combat : « Tour 1 », « Demi-finale ». */
  long: string;
  /** En-tête de colonne d'un arbre : « Tour 1 », « Quarts de finale », « Demi-finales ». */
  colonne: string;
};

const COMBAT_POUR_LA_3E_PLACE: NomDuTour = {
  court: "3e",
  long: "Combat pour la 3e place",
  colonne: "Combat pour la 3e place",
};
const FINALE: NomDuTour = { court: "F", long: "Finale", colonne: "Finale" };
const DEMI_FINALE: NomDuTour = { court: "DF", long: "Demi-finale", colonne: "Demi-finales" };
const QUART_DE_FINALE: NomDuTour = {
  court: "QF",
  long: "Quart de finale",
  colonne: "Quarts de finale",
};
const POULE: NomDuTour = { court: "P", long: "Poule", colonne: "Poule" };

/**
 * Le nom d'un tour, sous ses trois formes.
 *
 * Le combat de 3e place se reconnaît à son TYPE, jamais à sa division (il porte
 * la division 2, comme les demies). Le repêchage d'un tableau de trois, lui, est
 * nommé par sa division : c'est une demi-finale.
 *
 * Une `divisionMax` incohérente (plus petite que la division) ne produit jamais
 * un numéro nul ou négatif : le tour se compte alors comme le premier.
 */
export function nomDuTour({ division, divisionMax, type }: EntreeNomDuTour): NomDuTour {
  // Des copies : un appelant qui retouche le résultat ne corrompt pas le suivant.
  if (type === "BraketFightPool3") return { ...COMBAT_POUR_LA_3E_PLACE };
  if (division <= 0) return { ...POULE };
  if (division === 1) return { ...FINALE };
  if (division === 2) return { ...DEMI_FINALE };
  if (division === 3) return { ...QUART_DE_FINALE };
  const profondeur = Math.max(divisionMax, division);
  const numero = profondeur - division + 1;
  return { court: `T${numero}`, long: `Tour ${numero}`, colonne: `Tour ${numero}` };
}

/**
 * La division maximale d'un tableau : le maximum sur TOUTES ses lignes, byes
 * compris. Un tableau vide rend 0.
 */
export function divisionMaxDuTableau(fights: readonly { division: number }[]): number {
  return fights.reduce((max, f) => Math.max(max, f.division), 0);
}

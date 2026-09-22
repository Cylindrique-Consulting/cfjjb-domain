export type EntreeNomDuTour = {
  division: number;
  divisionMax: number;
  type?: string | null;
  /**
   * L'INDEX DU COMBAT DANS SA DIVISION. OPTIONNEL, et c'est le seul champ qui
   * distingue un combat d'ARBITRAGE de son homonyme du tableau : une nouvelle
   * finale porte la division 1 comme la finale, et une demi-finale supplémentaire
   * la division 2 comme les demi-finales. Un appelant qui nomme une COLONNE ne le
   * passe pas (une colonne n'a pas d'index), et un appelant qui l'oublie nomme le
   * tour exactement comme avant.
   */
  indexInDivision?: number | null;
};

export type NomDuTour = {
  court: string;
  long: string;
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
 * LES COMBATS D'ARBITRAGE, ET POURQUOI ILS ONT LEUR PROPRE NOM.
 *
 * Quand une finale ou des demi-finales se terminent sans vainqueur, le règlement
 * fait rejouer : le tableau reçoit alors des combats SUPPLÉMENTAIRES, rangés hors
 * de la grille (voir `estHorsGrille`). Ils portent la division du tour qu'ils
 * remplacent, donc sans leur index ils se nomment « Finale » et « Demi-finale »,
 * comme les combats qu'ils viennent après. Deux « Finale » dans une catégorie, et
 * plus rien ne dit laquelle a été jouée en premier.
 *
 * Le client l'a signalé le 22/09/2026, capture à l'appui, et a donné les mots :
 * « nouvelle demi finale » et « nouvelle finale ».
 */
const NOUVELLE_FINALE: NomDuTour = {
  court: "NF",
  long: "Nouvelle finale",
  colonne: "Nouvelle finale",
};
const NOUVELLE_DEMI_FINALE: NomDuTour = {
  court: "NDF",
  long: "Nouvelle demi-finale",
  colonne: "Nouvelles demi-finales",
};

/**
 * UN COMBAT D'ARBITRAGE, dit HORS GRILLE : il occupe une coordonnée que le
 * générateur de tableau ne produit jamais, et la géométrie `2 ** (d - 1)` des
 * colonnes l'écarte donc naturellement.
 *
 * Division 1, index 1 et au-delà : une finale rejouée, ou la finale qui suit des
 * demi-finales supplémentaires. Division 2, index 2 et au-delà : les demi-finales
 * supplémentaires elles-mêmes (une par côté du tableau). Le type compte : un
 * combat pour la 3e place et une 2e demi-finale de tableau de trois portent leurs
 * propres types et restent dans la grille.
 *
 * CETTE RÈGLE VIT ICI, et non dans `arbitrage.ts` qui l'a vue naître, pour que la
 * nomenclature puisse la lire sans faire entrer tout le règlement des fins sans
 * vainqueur dans les écrans qui ne nomment qu'un tour. `arbitrage.ts` la réexporte,
 * et ses appelants n'ont rien à changer.
 */
export function estHorsGrille(f: {
  readonly type?: string | null;
  readonly division: number;
  readonly indexInDivision: number;
}): boolean {
  return (
    f.type === "BraketFight" &&
    ((f.division === 1 && f.indexInDivision >= 1) || (f.division === 2 && f.indexInDivision >= 2))
  );
}

export function nomDuTour({
  division,
  divisionMax,
  type,
  indexInDivision,
}: EntreeNomDuTour): NomDuTour {
  if (type === "BraketFightPool3") return { ...COMBAT_POUR_LA_3E_PLACE };
  if (
    indexInDivision !== undefined &&
    indexInDivision !== null &&
    estHorsGrille({ type, division, indexInDivision })
  ) {
    return division === 1 ? { ...NOUVELLE_FINALE } : { ...NOUVELLE_DEMI_FINALE };
  }
  if (division <= 0) return { ...POULE };
  if (division === 1) return { ...FINALE };
  if (division === 2) return { ...DEMI_FINALE };
  if (division === 3) return { ...QUART_DE_FINALE };
  const profondeur = Math.max(divisionMax, division);
  const numero = profondeur - division + 1;
  return { court: `T${numero}`, long: `Tour ${numero}`, colonne: `Tour ${numero}` };
}

export function divisionMaxDuTableau(fights: readonly { division: number }[]): number {
  return fights.reduce((max, f) => Math.max(max, f.division), 0);
}

/**
 * L'ORDRE DES COMBATS DANS UNE COLONNE, ET POURQUOI IL NE SUIT PAS L'INDEX.
 *
 * ┌─ LE TABLEAU DE TROIS RANGE SES DEMI-FINALES PAR TYPE (TR1.3, TR2.1) ──────┐
 * │ À trois inscrits, la 2e demi-finale (`BraketFightRepechage3`) occupe la    │
 * │ case du bye : le générateur lui donne l'index 0, et la 1re demi-finale     │
 * │ l'index 1. Rangée par index seul, la 2e se dessine AU-DESSUS de la 1re,    │
 * │ l'inverse de l'ordre où elles se jouent. Rien ne garantit cet index : on   │
 * │ range par type d'abord, la 1re en haut, l'index ne départageant que les    │
 * │ combats de même type.                                                      │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * CETTE RÈGLE A ÉTÉ RECOPIÉE TROIS FOIS, ET OUBLIÉE UNE QUATRIÈME. Les portails
 * club et licencié l'appliquaient, le module aussi, l'éditeur de tableaux de
 * l'espace fédéral ne l'a jamais eue — et le client a signalé deux fois la même
 * inversion. Elle descend donc ici, où les trois vues la lisent.
 *
 * Le comparateur prend l'accès à l'index en paramètre : la plateforme le nomme
 * `indexInDivision`, le module `index`, et aucun des deux n'a à se renommer
 * pour appliquer la règle.
 */
export function rangDansLeTour(combat: { readonly type?: string | null }): number {
  return combat.type === "BraketFightRepechage3" ? 1 : 0;
}

export function comparerDansLeTour<T extends { readonly type?: string | null }>(
  indexDe: (combat: T) => number,
): (a: T, b: T) => number {
  return (a, b) => rangDansLeTour(a) - rangDansLeTour(b) || indexDe(a) - indexDe(b);
}

/**
 * L'ORDRE DES COMBATS D'ARBITRAGE : LA DIVISION DÉCROISSANTE D'ABORD.
 *
 * ┌─ POURQUOI IL FAUT LE DIRE, ALORS QUE LES COLONNES N'EN ONT PAS BESOIN ────┐
 * │ Les combats hors grille n'ont pas de colonne : ils se dessinent dans leur  │
 * │ propre section, dans l'ordre où la lecture les rend. Or `jour_j_podium_    │
 * │ source` n'a aucun `order by` sur les combats, et l'ordre physique des      │
 * │ lignes n'a aucune raison de suivre le déroulé. Le client a vu le 22/09/2026│
 * │ « combat n° 18, combat n° 20, combat n° 19 » : la nouvelle finale dessinée │
 * │ entre les deux nouvelles demi-finales qui la nourrissent.                  │
 * │                                                                            │
 * │ L'ordre retenu est celui que le règlement écrit déjà ailleurs, à           │
 * │ l'identique : `arbitragesRequis` trie ainsi, et `day_arbitrage_combats_    │
 * │ creer` liste ses combats attendus par `division desc, indexInDivision`.    │
 * │ C'est la QUATRIÈME copie de cette règle, et la dernière : elle descend ici.│
 * │                                                                            │
 * │ PAS UN TRI PAR NUMÉRO D'APPEL, bien qu'il donne le même résultat sur la    │
 * │ capture : le numéro vient de la file d'un tapis, que l'arbre public et la  │
 * │ feuille imprimée ne lisent pas. Un ordre qui dépend d'une donnée parfois   │
 * │ absente se réordonnerait d'un écran à l'autre.                             │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * Comme `comparerDansLeTour`, l'accès à l'index est un paramètre : la plateforme
 * le nomme `indexInDivision`, le module `index`.
 */
export function comparerHorsGrille<T extends { readonly division: number }>(
  indexDe: (combat: T) => number,
): (a: T, b: T) => number {
  return (a, b) => b.division - a.division || indexDe(a) - indexDe(b);
}

export type EntreeNomDuTour = {
  division: number;
  divisionMax: number;
  type?: string | null;
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

export function nomDuTour({ division, divisionMax, type }: EntreeNomDuTour): NomDuTour {
  if (type === "BraketFightPool3") return { ...COMBAT_POUR_LA_3E_PLACE };
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

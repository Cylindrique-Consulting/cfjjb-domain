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

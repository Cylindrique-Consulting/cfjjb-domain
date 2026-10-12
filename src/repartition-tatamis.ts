import type { BracketFightType } from "./bracket-generator";
import type { DrawFormat } from "./competition-format";

/**
 * Une catégorie se répartit sur 1 à 8 tatamis, 3, 5, 6 et 7 compris (REP.1 A,
 * réponse du client du 25/09/2026). Cette liste ne suit plus celle des
 * absoluts du jour J (`TAPIS_ADMIS_ABSOLUT`, toujours 1, 2, 4 ou 8), dont la
 * génération n'est pas encore alignée.
 */
export const NOMBRES_DE_TATAMIS_ADMIS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8];

const PLAFOND_DE_REPARTITION = 8;

export const INSCRITS_MAXIMUM_PAR_CATEGORIE = 128;

export function estNombreDeTatamisAdmis(nombre: number): boolean {
  return NOMBRES_DE_TATAMIS_ADMIS.includes(nombre);
}

export function plafondDeRepartition(tatamisDeLaCompetition: number): number {
  if (Number.isNaN(tatamisDeLaCompetition)) return 1;
  return Math.max(1, Math.min(PLAFOND_DE_REPARTITION, Math.floor(tatamisDeLaCompetition)));
}

export function valeursAdmisesDeRepartition(tatamisDeLaCompetition: number): number[] {
  const plafond = plafondDeRepartition(tatamisDeLaCompetition);
  return NOMBRES_DE_TATAMIS_ADMIS.filter((nombre) => nombre <= plafond);
}

/**
 * LA DURÉE MAXIMALE D'UN TOUR SUR UN TAPIS : 30 minutes (retour du client du
 * 28/09/2026, validé le même jour).
 *
 * Un tour entier se joue avant que le suivant commence : sa durée est donc le
 * plancher de l'attente d'un athlète entre deux de ses combats, et aucun ordre
 * de passage ne peut la réduire. Répartir la catégorie divise cette durée, et
 * c'est le seul levier qui agisse dessus : c'est pourquoi le dimensionnement
 * d'un tableau se calcule ici, et pas seulement sur son effectif.
 */
export const DUREE_MAXIMALE_D_UN_TOUR_SECONDES = 30 * 60;

/** Les répartitions qui ne coûtent rien au §18 : 3, 5, 6 et 7 y comptent comme un déséquilibre. */
const REPARTITIONS_EQUILIBREES: readonly number[] = [1, 2, 4, 8];

/**
 * Le nombre de tatamis qu'il faut pour que le tour le plus long tienne dans la
 * durée maximale. Byes exclus puisqu'ils ne se jouent pas, et le cycle d'un
 * combat comprend la rotation du tapis. Seules les répartitions équilibrées
 * sont proposées.
 *
 * ┌─ LE TOUR LE PLUS LONG N'EST PAS LE PREMIER ───────────────────────────────┐
 * │ Dès que l'effectif n'est pas une puissance de deux, les byes vident le    │
 * │ premier tour et reportent la charge sur le suivant. Mesuré sur les        │
 * │ tableaux de l'Open Île-de-France : à 33 inscrits le premier tour ne       │
 * │ compte qu'UN combat quand le deuxième en compte SEIZE, à 36 inscrits      │
 * │ quatre contre seize, à 20 inscrits quatre contre huit.                    │
 * │                                                                            │
 * │ Dimensionner sur le premier tour revenait donc à ne rien dimensionner du  │
 * │ tout sur la moitié des tableaux, et à laisser sur un seul tapis ceux qui  │
 * │ en avaient le plus besoin.                                                │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
export function tatamisSelonLaDureeDuTour(entree: {
  combatsDuTourLePlusLong: number;
  dureeSecondes: number;
  espacementSecondes: number;
  dureeMaximaleDuTourSecondes?: number;
}): number {
  const combats = Math.max(0, Math.floor(entree.combatsDuTourLePlusLong));
  const cycle = Math.max(0, entree.dureeSecondes) + Math.max(0, entree.espacementSecondes);
  const borne = Math.max(
    1,
    entree.dureeMaximaleDuTourSecondes ?? DUREE_MAXIMALE_D_UN_TOUR_SECONDES,
  );
  if (combats <= 0 || cycle <= 0) return 1;
  const tourSurUnTapis = combats * cycle;
  return (
    REPARTITIONS_EQUILIBREES.find((n) => tourSurUnTapis / n <= borne) ?? PLAFOND_DE_REPARTITION
  );
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

export type MotifDeProposition =
  "format_non_reparti" | "effectif" | "duree_du_tour" | "plafonne_par_la_competition";

export type EntreeDeProposition = {
  inscrits: number;
  tatamisDeLaCompetition: number;
  format?: DrawFormat;
  /**
   * La durée du tour le plus long, quand l'appelant la connaît : elle ne fait
   * qu'AJOUTER des tatamis à ce que l'effectif propose, jamais en retirer.
   * Absente, la proposition reste celle des seuils d'effectif, exactement
   * comme avant le 28/09/2026.
   */
  tourLePlusLong?: {
    combats: number;
    dureeSecondes: number;
    espacementSecondes: number;
    dureeMaximaleSecondes?: number;
  };
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
  const selonLaDuree =
    entree.tourLePlusLong === undefined
      ? 0
      : tatamisSelonLaDureeDuTour({
          combatsDuTourLePlusLong: entree.tourLePlusLong.combats,
          dureeSecondes: entree.tourLePlusLong.dureeSecondes,
          espacementSecondes: entree.tourLePlusLong.espacementSecondes,
          ...(entree.tourLePlusLong.dureeMaximaleSecondes === undefined
            ? {}
            : { dureeMaximaleDuTourSecondes: entree.tourLePlusLong.dureeMaximaleSecondes }),
        });
  const voulu = Math.max(selonEffectif, selonLaDuree);
  const proposition = Math.min(voulu, plafond);
  const alternative = entree.inscrits <= 32 ? Math.min(proposition * 2, plafond) : null;
  return {
    proposition,
    valeursAdmises,
    alternativeSuggeree: alternative !== null && alternative > proposition ? alternative : null,
    motif:
      proposition < voulu
        ? "plafonne_par_la_competition"
        : selonLaDuree > selonEffectif
          ? "duree_du_tour"
          : "effectif",
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

/**
 * Le tableau se coupe par MORCEAUX ENTIERS (REP.4 A). Il est d'abord divisé en
 * `unites` = 2^k morceaux égaux, 2^k étant la plus petite puissance de deux qui
 * atteint le nombre de parties ; les dernières unités sont réunies deux à deux
 * jusqu'à tomber juste. À 3 parties : un quart, un quart, une moitié ; à 5 :
 * 1/8, 1/8, 1/4, 1/4, 1/4 ; à 6 : quatre huitièmes et deux quarts ; à 7 : six
 * huitièmes et un quart. À 1, 2, 4 et 8 parties, chaque unité est une partie.
 */
function partieDeLUnite(unite: number, unites: number, parties: number): number {
  const seules = unites - 2 * (unites - parties);
  return unite < seules ? unite : seules + Math.floor((unite - seules) / 2);
}

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
  const unites = 2 ** Math.ceil(Math.log2(parties));
  const combatsDuTour = 2 ** (combat.division - 1);
  if (combatsDuTour >= unites) {
    const brut = Math.floor((combat.indexInDivision * unites) / combatsDuTour);
    const unite = Math.min(unites - 1, Math.max(0, brut));
    const partie = partieDeLUnite(unite, unites, parties);
    return { partie, partiesReunies: [partie], convergence: false };
  }
  const largeur = unites / combatsDuTour;
  const debut = Math.min(unites - largeur, Math.max(0, combat.indexInDivision * largeur));
  const couvertes = new Set<number>();
  for (let unite = debut; unite < debut + largeur; unite += 1) {
    couvertes.add(partieDeLUnite(unite, unites, parties));
  }
  const partiesReunies = [...couvertes].sort((a, b) => a - b);
  const partie = partiesReunies[0] ?? 0;
  if (partiesReunies.length === 1) {
    return { partie, partiesReunies, convergence: false };
  }
  return { partie, partiesReunies, convergence: true };
}

export type TatamiDeRepartition = {
  id: string;
  numero: number;
};

export type EntreeDeRepartition = {
  tatamis: readonly TatamiDeRepartition[];
  /** Un combat exempt (`isBye`) ne se joue pas : il ne charge aucun tatami en `moins_charge`. */
  combats: readonly (CombatARepartir & { id: string; isBye?: boolean })[];
  /**
   * La charge déjà prévue sur chaque tatami, en secondes. Jamais modifiée : en
   * `moins_charge`, la mise à jour se fait sur une copie.
   */
  chargeParTatami?: Readonly<Record<string, number>>;
  tatamiParCombat?: Readonly<Record<string, string>>;
  /** Absent : `plus_tardif`, le choix d'avant v0.42.0. */
  convergence?: ModeDeConvergence;
  /**
   * En `moins_charge` : le temps qu'un combat occupe un tatami (durée
   * réglementaire plus rotation, DUR.1 A), ajouté au tatami de chaque combat
   * de convergence joué. Ignoré en `plus_tardif`.
   */
  cycleSecondes?: number;
};

/**
 * Le choix du tatami d'un combat de convergence, parmi ceux que ses parties
 * réunissent :
 *
 *   · `plus_tardif` (défaut, et la console absolut) : celui qui finit le plus
 *     tard d'après `chargeParTatami`, une charge FIXE pour tous les combats ;
 *   · `moins_charge` : celui qui a le MOINS de charge, mise à jour combat par
 *     combat, parmi les tatamis de ses combats sources joués. Les combats se
 *     prennent dans l'ordre des tours (quarts, puis demi-finales, puis
 *     finale) et chaque combat de convergence ajoute `cycleSecondes` au
 *     tatami qu'il prend : le combat suivant voit cette charge. C'est ce qui
 *     rapproche les heures de fin des tatamis (ticket du 11/10/2026 : « les
 *     tatamis terminent leur programme à des horaires proches, hors
 *     absolutes »).
 *
 * ┌─ LA CONTINUITÉ D'ABORD (§12, revue du 12/10/2026) ────────────────────────┐
 * │ Choisi parmi TOUS les tatamis réunis, le moins chargé envoyait une finale │
 * │ sur un tatami où aucune de ses demi-finales ne s'était jouée : ses deux   │
 * │ finalistes changeaient de tatami pour elle, et le contrôle                │
 * │ `finale_loin_des_demi_finales` le signalait. En `moins_charge`, un combat │
 * │ de convergence reste donc sur le tatami de l'un de ses combats sources    │
 * │ joués (un exempt n'en est pas un), le moins chargé des deux. Ce n'est     │
 * │ qu'à défaut de source jouée parmi les combats reçus qu'il prend le moins  │
 * │ chargé de tous les tatamis réunis.                                        │
 * │                                                                           │
 * │ `plus_tardif` le fait sans le dire : avec une charge fixe, le plus chargé │
 * │ des tatamis réunis est aussi le plus chargé de la moitié qui le contient, │
 * │ donc celui de la demi-finale de cette moitié.                             │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * À charge égale, le plus petit numéro, dans les deux modes. Sans charge
 * connue ni cycle, et sans exempt parmi les sources, les deux modes rendent le
 * même tatami.
 */
export type ModeDeConvergence = "plus_tardif" | "moins_charge";

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

function tatamiLeMoinsCharge(
  tatamis: readonly TatamiDeRepartition[],
  parties: readonly number[],
  chargeParTatami: Readonly<Record<string, number>>,
): TatamiDeRepartition | null {
  let choix: TatamiDeRepartition | null = null;
  for (const partie of parties) {
    const candidat = tatamis[partie];
    if (candidat === undefined) continue;
    if (choix === null) {
      choix = candidat;
      continue;
    }
    const chargeCandidat = chargeParTatami[candidat.id] ?? 0;
    const chargeChoix = chargeParTatami[choix.id] ?? 0;
    if (chargeCandidat < chargeChoix) choix = candidat;
    else if (chargeCandidat === chargeChoix && candidat.numero < choix.numero) choix = candidat;
  }
  return choix;
}

/**
 * Le tatami de chaque combat d'une catégorie répartie : celui de sa partie, ou,
 * pour un combat de convergence, l'un des tatamis que ses parties réunissent
 * (`ModeDeConvergence`). Un tatami imposé (`tatamiParCombat`) l'emporte s'il
 * est l'un d'eux, et compte alors dans la charge comme les autres, et comme
 * tatami de source pour le tour suivant. La carte rendue suit l'ordre des
 * combats reçus, quel que soit le mode.
 */
export function repartirLesCombats(entree: EntreeDeRepartition): Map<string, PlaceDeCombat> {
  const parties = entree.tatamis.length;
  if (!estNombreDeTatamisAdmis(parties)) {
    throw new RangeError(`nombre de parties non admis pour une catégorie répartie : ${parties}`);
  }
  const moinsCharge = entree.convergence === "moins_charge";
  const cycle = moinsCharge ? Math.max(0, entree.cycleSecondes ?? 0) : 0;
  const charge: Record<string, number> = { ...(entree.chargeParTatami ?? {}) };
  const choix = entree.tatamiParCombat ?? {};

  // En `moins_charge`, les tours se traitent du premier à la finale (division
  // décroissante), dans l'ordre du tableau au sein d'un tour : un combat de
  // convergence voit la charge que les précédents ont ajoutée.
  const ordre = entree.combats.map((combat, rang) => ({ combat, rang }));
  if (moinsCharge) {
    ordre.sort(
      (a, b) =>
        b.combat.division - a.combat.division ||
        a.combat.indexInDivision - b.combat.indexInDivision ||
        a.rang - b.rang,
    );
  }
  const calculees = new Map<string, PlaceDeCombat>();

  // Les combats de tableau, par position : les sources d'un combat du tour d
  // sont les combats 2i et 2i + 1 du tour d + 1 (`findFeederFight`).
  const parPosition = new Map<string, CombatARepartir & { id: string; isBye?: boolean }>();
  if (moinsCharge) {
    for (const combat of entree.combats) {
      if (combat.type !== "BraketFight") continue;
      parPosition.set(`${combat.division}:${combat.indexInDivision}`, combat);
    }
  }
  /** Les parties réunies où se joue l'une des sources jouées du combat, sinon toutes. */
  const partiesDesSources = (combat: CombatARepartir, partiesReunies: readonly number[]) => {
    if (combat.type !== "BraketFight") return partiesReunies;
    const tatamisDesSources = new Set<string>();
    for (const rang of [0, 1]) {
      const source = parPosition.get(`${combat.division + 1}:${combat.indexInDivision * 2 + rang}`);
      if (source === undefined || source.isBye === true) continue;
      const tatami = calculees.get(source.id)?.tatamiId;
      if (tatami !== undefined) tatamisDesSources.add(tatami);
    }
    const retenues = partiesReunies.filter((partie) => {
      const id = entree.tatamis[partie]?.id;
      return id !== undefined && tatamisDesSources.has(id);
    });
    return retenues.length > 0 ? retenues : partiesReunies;
  };

  for (const { combat } of ordre) {
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
      const defaut = !decoupe.convergence
        ? (entree.tatamis[decoupe.partie] ?? null)
        : moinsCharge
          ? tatamiLeMoinsCharge(
              entree.tatamis,
              partiesDesSources(combat, decoupe.partiesReunies),
              charge,
            )
          : tatamiLePlusTardif(entree.tatamis, decoupe.partiesReunies, charge);
      if (defaut === null) {
        throw new RangeError(`aucun tatami disponible pour le combat ${combat.id}`);
      }
      tatamiId = defaut.id;
    }
    if (decoupe.convergence && cycle > 0 && combat.isBye !== true) {
      charge[tatamiId] = (charge[tatamiId] ?? 0) + cycle;
    }
    calculees.set(combat.id, {
      fightId: combat.id,
      tatamiId,
      partie: decoupe.partie,
      partiesReunies: decoupe.partiesReunies,
      convergence: decoupe.convergence,
      libelleDePartie: decoupe.convergence ? null : libelleDePartie(decoupe.partie, parties),
    });
  }

  const places = new Map<string, PlaceDeCombat>();
  for (const combat of entree.combats) {
    const place = calculees.get(combat.id);
    if (place !== undefined) places.set(combat.id, place);
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

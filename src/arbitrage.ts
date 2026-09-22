import {
  appliquerLePlan,
  estFinSansVainqueur,
  loserOf,
  planArbitrage,
  planFinish,
  planFinishSansVainqueur,
  planByeCascade,
  planForfeit,
  repechage3Of,
  type FinSansVainqueur,
  type MotifDeDisqualification,
  type PropagationFight,
  type WinMethod,
} from "./bracket-propagation";
import { finDeReposDeLAthlete, type CombatAVenir, type CombatPasse } from "./fight-rest";
// LA COORDONNÉE D'UN COMBAT D'ARBITRAGE VIT AVEC LA NOMENCLATURE (`round-names`) :
// c'est elle qui doit la lire pour nommer une nouvelle finale sans faire entrer
// tout ce fichier dans les écrans qui ne nomment qu'un tour. Réexportée ici pour
// que `@cfjjb/domain/arbitrage` reste le chemin d'import de ses appelants.
import { estHorsGrille } from "./round-names";

export { estHorsGrille };

export type FormatDuTableau = "deux" | "trois" | "quatre_et_plus";

export type TourDuCombat = "finale" | "demie" | "avant_demies" | "petite_finale" | "hors_grille";

export type NatureFinSansVainqueur = "technique" | "disciplinaire" | "mixte" | "blessure";

export type ResolutionArbitrage = "tirage" | "decision" | "classement" | "combats";

export type AutreDemie = "sans_double" | "meme_nature" | "autre_nature";

export type RegleFinSansVainqueur = {
  readonly id: string;
  readonly format: FormatDuTableau;
  readonly tour: TourDuCombat;
  readonly nature: NatureFinSansVainqueur;
  readonly autreDemie?: AutreDemie;
  readonly resolution: ResolutionArbitrage | null;
  readonly source: string;
  readonly libelle: string;
};

export const SOURCES_DES_REGLES = {
  ibjjf241: "IBJJF Rules Book 6.1 (juin 2024), General Competition Guidelines art. 2.4.1",
  ibjjf242: "IBJJF Rules Book 6.1 (juin 2024), General Competition Guidelines art. 2.4.2",
  ibjjfTirage: "IBJJF Rules Book 6.1 (juin 2024), règles d'arbitrage art. 2 (tirage au sort)",
  cfjjbDeux: "Règle CFJJB (réponse DQ1.5 du 15/09/2026)",
  cfjjbNonEcrit: "Règle CFJJB (réponse DQ1.4 du 15/09/2026, cas non écrit)",
} as const;

const S = SOURCES_DES_REGLES;

export const REGLES_FIN_SANS_VAINQUEUR: readonly RegleFinSansVainqueur[] = [
  {
    id: "deux.finale.technique",
    format: "deux",
    tour: "finale",
    nature: "technique",
    resolution: null,
    source: S.cfjjbDeux,
    libelle: "Aucun champion : les deux athlètes sont classés 2es.",
  },
  {
    id: "deux.finale.disciplinaire",
    format: "deux",
    tour: "finale",
    nature: "disciplinaire",
    resolution: null,
    source: S.cfjjbDeux,
    libelle: "Ni classement ni médaille : la catégorie est terminée sans médaillé.",
  },
  {
    id: "deux.finale.mixte",
    format: "deux",
    tour: "finale",
    nature: "mixte",
    resolution: null,
    source: S.cfjjbDeux,
    libelle: "Aucun champion : le disqualifié technique est 2e, l'autre n'est pas classé.",
  },
  {
    id: "deux.finale.blessure",
    format: "deux",
    tour: "finale",
    nature: "blessure",
    resolution: "tirage",
    source: S.ibjjfTirage,
    libelle: "Finale à égalité parfaite : tirage au sort fait devant les athlètes.",
  },

  {
    id: "trois.demie.technique",
    format: "trois",
    tour: "demie",
    nature: "technique",
    resolution: "tirage",
    source: S.ibjjf241,
    libelle:
      "Tirage au sort : le gagnant va en finale, le perdant est le perdant de cette demi-finale.",
  },
  {
    id: "trois.demie.disciplinaire",
    format: "trois",
    tour: "demie",
    nature: "disciplinaire",
    resolution: "classement",
    source: S.cfjjbNonEcrit,
    libelle: "Le Responsable saisit le classement retenu.",
  },
  {
    id: "trois.demie.mixte",
    format: "trois",
    tour: "demie",
    nature: "mixte",
    resolution: "classement",
    source: S.cfjjbNonEcrit,
    libelle: "Le Responsable saisit le classement retenu.",
  },
  {
    id: "trois.demie.blessure",
    format: "trois",
    tour: "demie",
    nature: "blessure",
    resolution: null,
    source: S.ibjjf241,
    libelle:
      "Aucun des deux blessés ne va en finale : ils sont 3es, l'athlète restant est champion et la 2e place reste vacante.",
  },
  {
    id: "trois.finale.technique",
    format: "trois",
    tour: "finale",
    nature: "technique",
    resolution: null,
    source: S.ibjjf242,
    libelle: "Le perdant de la 2e demi-finale devient champion, les deux disqualifiés sont 2es.",
  },
  {
    id: "trois.finale.disciplinaire",
    format: "trois",
    tour: "finale",
    nature: "disciplinaire",
    resolution: "classement",
    source: S.cfjjbNonEcrit,
    libelle: "Le Responsable saisit le classement retenu.",
  },
  {
    id: "trois.finale.mixte",
    format: "trois",
    tour: "finale",
    nature: "mixte",
    resolution: "classement",
    source: S.cfjjbNonEcrit,
    libelle: "Le Responsable saisit le classement retenu.",
  },
  {
    id: "trois.finale.blessure",
    format: "trois",
    tour: "finale",
    nature: "blessure",
    resolution: "tirage",
    source: S.ibjjfTirage,
    libelle: "Finale à égalité parfaite : tirage au sort fait devant les athlètes.",
  },

  {
    id: "quatre.avant_demies.technique",
    format: "quatre_et_plus",
    tour: "avant_demies",
    nature: "technique",
    resolution: null,
    source: S.ibjjf241,
    libelle: "Aucun des deux n'avance : l'adversaire du tour suivant passe sans adversaire.",
  },
  {
    id: "quatre.avant_demies.disciplinaire",
    format: "quatre_et_plus",
    tour: "avant_demies",
    nature: "disciplinaire",
    resolution: null,
    source: S.ibjjf241,
    libelle: "Aucun des deux n'avance : l'adversaire du tour suivant passe sans adversaire.",
  },
  {
    id: "quatre.avant_demies.mixte",
    format: "quatre_et_plus",
    tour: "avant_demies",
    nature: "mixte",
    resolution: null,
    source: S.ibjjf241,
    libelle: "Aucun des deux n'avance : l'adversaire du tour suivant passe sans adversaire.",
  },
  {
    id: "quatre.avant_demies.blessure",
    format: "quatre_et_plus",
    tour: "avant_demies",
    nature: "blessure",
    resolution: "decision",
    source: S.cfjjbNonEcrit,
    libelle: "Le Responsable saisit la suite retenue.",
  },

  {
    id: "quatre.demie.technique",
    format: "quatre_et_plus",
    tour: "demie",
    nature: "technique",
    autreDemie: "sans_double",
    resolution: null,
    source: S.ibjjf241,
    libelle: "L'autre demi-finale devient la finale, les deux disqualifiés sont 3es.",
  },
  {
    id: "quatre.demie.disciplinaire",
    format: "quatre_et_plus",
    tour: "demie",
    nature: "disciplinaire",
    autreDemie: "sans_double",
    resolution: null,
    source: S.ibjjf241,
    libelle: "L'autre demi-finale devient la finale, la 3e place reste vacante.",
  },
  {
    id: "quatre.demie.mixte",
    format: "quatre_et_plus",
    tour: "demie",
    nature: "mixte",
    autreDemie: "sans_double",
    resolution: null,
    source: S.ibjjf241,
    libelle: "L'autre demi-finale devient la finale, le disqualifié technique garde la 3e place.",
  },
  {
    id: "quatre.demie.blessure",
    format: "quatre_et_plus",
    tour: "demie",
    nature: "blessure",
    autreDemie: "sans_double",
    resolution: null,
    source: S.ibjjf241,
    libelle: "L'autre demi-finale devient la finale, les deux blessés sont 3es.",
  },
  {
    id: "quatre.deux_demies.technique",
    format: "quatre_et_plus",
    tour: "demie",
    nature: "technique",
    autreDemie: "meme_nature",
    resolution: "combats",
    source: S.ibjjf241,
    libelle:
      "Demi-finales supplémentaires entre les perdants des quarts : les quatre disqualifiés sont 3es.",
  },
  {
    id: "quatre.deux_demies.disciplinaire",
    format: "quatre_et_plus",
    tour: "demie",
    nature: "disciplinaire",
    autreDemie: "meme_nature",
    resolution: "combats",
    source: S.ibjjf241,
    libelle:
      "Demi-finales supplémentaires entre les perdants des quarts, dont les perdants sont 3es.",
  },
  {
    id: "quatre.deux_demies.mixte",
    format: "quatre_et_plus",
    tour: "demie",
    nature: "mixte",
    autreDemie: "meme_nature",
    resolution: "classement",
    source: S.cfjjbNonEcrit,
    libelle: "Le Responsable saisit le classement retenu.",
  },
  {
    id: "quatre.deux_demies.blessure",
    format: "quatre_et_plus",
    tour: "demie",
    nature: "blessure",
    autreDemie: "meme_nature",
    resolution: "classement",
    source: S.cfjjbNonEcrit,
    libelle: "Le Responsable saisit le classement retenu.",
  },
  ...(["technique", "disciplinaire", "mixte", "blessure"] as const).map(
    (nature): RegleFinSansVainqueur => ({
      id: `quatre.deux_demies_melange.${nature}`,
      format: "quatre_et_plus",
      tour: "demie",
      nature,
      autreDemie: "autre_nature",
      resolution: "classement",
      source: S.cfjjbNonEcrit,
      libelle: "Le Responsable saisit le classement retenu.",
    }),
  ),

  {
    id: "quatre.finale.technique",
    format: "quatre_et_plus",
    tour: "finale",
    nature: "technique",
    resolution: "combats",
    source: S.ibjjf242,
    libelle:
      "Les perdants des demi-finales refont la finale (vainqueur 1er, perdant 3e), les deux disqualifiés sont 2es.",
  },
  {
    id: "quatre.finale.mixte",
    format: "quatre_et_plus",
    tour: "finale",
    nature: "mixte",
    resolution: "combats",
    source: S.ibjjf242,
    libelle:
      "Le disqualifié technique est 2e ; les perdants des demi-finales se rencontrent (vainqueur 1er, l'autre 3e).",
  },
  {
    id: "quatre.finale.disciplinaire",
    format: "quatre_et_plus",
    tour: "finale",
    nature: "disciplinaire",
    resolution: "combats",
    source: S.ibjjf242,
    libelle:
      "Les perdants des demi-finales disputent la finale ; les perdants des quarts battus par eux sont 3es.",
  },
  {
    id: "quatre.finale.blessure",
    format: "quatre_et_plus",
    tour: "finale",
    nature: "blessure",
    resolution: "tirage",
    source: S.ibjjfTirage,
    libelle: "Finale à égalité parfaite : tirage au sort fait devant les athlètes.",
  },

  ...(["technique", "mixte", "blessure"] as const).map((nature): RegleFinSansVainqueur => ({
    id: `quatre.petite_finale.${nature}`,
    format: "quatre_et_plus",
    tour: "petite_finale",
    nature,
    resolution: "decision",
    source: S.cfjjbNonEcrit,
    libelle:
      "Combat pour la 3e place sans vainqueur : le Responsable désigne l'athlète classé 3e, ou personne.",
  })),
  {
    id: "quatre.petite_finale.disciplinaire",
    format: "quatre_et_plus",
    tour: "petite_finale",
    nature: "disciplinaire",
    resolution: null,
    source: S.ibjjf242,
    libelle:
      "Les deux disqualifiés disciplinaires ne sont pas classés : la 3e place reste vacante.",
  },
  ...(["technique", "disciplinaire", "mixte", "blessure"] as const).map(
    (nature): RegleFinSansVainqueur => ({
      id: `quatre.hors_grille.${nature}`,
      format: "quatre_et_plus",
      tour: "hors_grille",
      nature,
      resolution: "classement",
      source: S.cfjjbNonEcrit,
      libelle: "Le Responsable saisit le classement retenu.",
    }),
  ),
];

export const REGLE_DESIGNE_INDISPONIBLE: RegleFinSansVainqueur = {
  id: "designe_indisponible",
  format: "quatre_et_plus",
  tour: "finale",
  nature: "technique",
  resolution: "classement",
  source: S.cfjjbNonEcrit,
  libelle:
    "L'athlète que la règle désigne est indisponible : le Responsable saisit le classement retenu.",
};

function trouver(
  fights: readonly PropagationFight[],
  type: PropagationFight["type"],
  division: number,
  indexInDivision: number,
): PropagationFight | null {
  return (
    fights.find(
      (f) => f.type === type && f.division === division && f.indexInDivision === indexInDivision,
    ) ?? null
  );
}

export function formatDuTableau(fights: readonly PropagationFight[]): FormatDuTableau {
  if (repechage3Of(fights)) return "trois";
  const auDela = fights.some(
    (f) =>
      f.type === "BraketFight" && (f.division >= 3 || (f.division === 2 && f.indexInDivision <= 1)),
  );
  return auDela ? "quatre_et_plus" : "deux";
}

export function tourDuCombat(
  f: Pick<PropagationFight, "type" | "division" | "indexInDivision">,
): TourDuCombat {
  if (f.type === "BraketFightPool3") return "petite_finale";
  if (estHorsGrille(f)) return "hors_grille";
  if (f.type === "BraketFightRepechage3") return "demie";
  if (f.division === 1) return "finale";
  if (f.division === 2) return "demie";
  return "avant_demies";
}

export function natureDeLaFin(
  f: Pick<PropagationFight, "state" | "winMethod" | "dqReasonA" | "dqReasonB">,
): NatureFinSansVainqueur | null {
  if (!estFinSansVainqueur(f)) return null;
  if (f.winMethod === "double_blessure") return "blessure";
  const a: MotifDeDisqualification = f.dqReasonA ?? "technique";
  const b: MotifDeDisqualification = f.dqReasonB ?? "technique";
  if (a === b) return a;
  return "mixte";
}

function autreDemieDe(
  fights: readonly PropagationFight[],
  demie: PropagationFight,
): PropagationFight | null {
  return trouver(fights, "BraketFight", 2, 1 - demie.indexInDivision);
}

export function regleDeFinSansVainqueur(
  fights: readonly PropagationFight[],
  fight: PropagationFight,
): RegleFinSansVainqueur | null {
  const nature = natureDeLaFin(fight);
  if (nature === null) return null;
  const format = formatDuTableau(fights);
  const tour = tourDuCombat(fight);

  let autreDemie: AutreDemie | undefined;
  if (format === "quatre_et_plus" && tour === "demie") {
    const autre = autreDemieDe(fights, fight);
    const natureAutre = autre && autre.winner === null ? natureDeLaFin(autre) : null;
    autreDemie =
      natureAutre === null
        ? "sans_double"
        : natureAutre === nature
          ? "meme_nature"
          : "autre_nature";
  }

  const regle = REGLES_FIN_SANS_VAINQUEUR.find(
    (r) =>
      r.format === format &&
      r.tour === tour &&
      r.nature === nature &&
      (r.autreDemie === undefined || r.autreDemie === autreDemie),
  );
  return (
    regle ?? {
      ...REGLE_DESIGNE_INDISPONIBLE,
      id: `hors_table.${format}.${tour}.${nature}`,
      format,
      tour,
      nature,
      libelle: "Cas non prévu par la table : le Responsable saisit le classement retenu.",
    }
  );
}

export const LIBELLE_COTE_SANS_PERDANT_DE_QUART =
  "Un côté du tableau n'a aucun perdant de quart de finale pour les demi-finales supplémentaires : le Responsable saisit le classement retenu.";

export type EstClassable = (registrationId: string) => boolean;

export function quartDispute(
  fights: readonly PropagationFight[],
  indexInDivision: number,
): boolean {
  const quart = trouver(fights, "BraketFight", 3, indexInDivision);
  return quart !== null && !quart.isBye;
}

type Manque = "indisponible" | "cote_sans_perdant_de_quart";

function manqueDesDesignes(
  fights: readonly PropagationFight[],
  regle: RegleFinSansVainqueur,
  designes: readonly (string | null)[],
  estClassable: EstClassable,
): Manque | null {
  const indisponible = (r: string | null | undefined) =>
    r === null || r === undefined || !estClassable(r);
  if (regle.resolution !== "combats" || regle.tour !== "demie") {
    return designes.some(indisponible) ? "indisponible" : null;
  }
  let manque: Manque | null = null;
  for (const cote of [0, 1]) {
    const quarts = [2 * cote, 2 * cote + 1].filter((i) => quartDispute(fights, i));
    if (quarts.some((i) => indisponible(designes[i]))) return "indisponible";
    if (quarts.length === 0) manque = "cote_sans_perdant_de_quart";
  }
  return manque;
}

export function athletesDesignes(
  fights: readonly PropagationFight[],
  fight: PropagationFight,
  regle: RegleFinSansVainqueur,
): (string | null)[] | null {
  if (regle.id === "trois.finale.technique") {
    const rep = repechage3Of(fights);
    return [rep && rep.state === "finished" ? loserOf(rep) : null];
  }
  if (regle.resolution !== "combats") return null;
  if (regle.tour === "finale") {
    return [0, 1].map((i) => {
      const demie = trouver(fights, "BraketFight", 2, i);
      return demie && demie.state === "finished" ? loserOf(demie) : null;
    });
  }
  return [0, 1, 2, 3].map((i) => {
    const quart = trouver(fights, "BraketFight", 3, i);
    if (!quart || quart.isBye || quart.state !== "finished") return null;
    return loserOf(quart);
  });
}

export type ArbitrageRequis = {
  fightId: string;
  regle: RegleFinSansVainqueur;
  resolution: ResolutionArbitrage;
  rendu: boolean;
};

export function arbitrageRequisPour(
  fights: readonly PropagationFight[],
  fight: PropagationFight,
  estClassable: EstClassable = () => true,
): ArbitrageRequis | null {
  const regle = regleDeFinSansVainqueur(fights, fight);
  if (regle === null) return null;

  let retenue: RegleFinSansVainqueur = regle;
  const designes = athletesDesignes(fights, fight, regle);
  const manque =
    designes === null ? null : manqueDesDesignes(fights, regle, designes, estClassable);
  if (manque !== null) {
    retenue = {
      ...REGLE_DESIGNE_INDISPONIBLE,
      format: regle.format,
      tour: regle.tour,
      nature: regle.nature,
      ...(manque === "cote_sans_perdant_de_quart"
        ? { libelle: LIBELLE_COTE_SANS_PERDANT_DE_QUART }
        : {}),
    };
  }
  if (retenue.resolution === null) return null;
  return {
    fightId: fight.id,
    regle: retenue,
    resolution: retenue.resolution,
    rendu: fight.arbitrage !== null && fight.arbitrage !== undefined,
  };
}

export function finSansVainqueurAttendUnArbitrage(
  fights: readonly PropagationFight[],
  fight: PropagationFight,
): boolean {
  if (fight.winner !== null) return false;
  if (fight.arbitrage !== null && fight.arbitrage !== undefined) return false;
  const regle = regleDeFinSansVainqueur(fights, fight);
  return regle !== null && regle.resolution !== null;
}

export function arbitragesEnAttente(
  fights: readonly PropagationFight[],
  estClassable: EstClassable = () => true,
): ArbitrageRequis[] {
  return fights
    .filter((f) => estFinSansVainqueur(f) && f.winner === null)
    .map((f) => arbitrageRequisPour(fights, f, estClassable))
    .filter((a): a is ArbitrageRequis => a !== null && !a.rendu)
    .sort((x, y) => {
      const fx = fights.find((f) => f.id === x.fightId)!;
      const fy = fights.find((f) => f.id === y.fightId)!;
      return fy.division - fx.division || fx.indexInDivision - fy.indexInDivision;
    });
}

export type CombatSupplementaire = {
  division: 1 | 2;
  indexInDivision: number;
  slotA: string | null;
  slotB: string | null;
  libelle: string;
};

export type PropositionDeCombats = {
  regle: RegleFinSansVainqueur;
  combats: CombatSupplementaire[];
  consequences: string[];
};

export function proposerCombatsSupplementaires(
  fights: readonly PropagationFight[],
  fight: PropagationFight,
  estClassable: EstClassable = () => true,
): PropositionDeCombats | null {
  const requis = arbitrageRequisPour(fights, fight, estClassable);
  if (requis === null || requis.resolution !== "combats") return null;
  const designes = athletesDesignes(fights, fight, requis.regle) ?? [];

  if (requis.regle.tour === "finale") {
    const [a, b] = designes;
    const consequences: Record<string, string[]> = {
      technique: [
        "Le vainqueur de la finale rejouée est 1er, le perdant 3e.",
        "Les deux disqualifiés de la finale sont 2es.",
      ],
      mixte: [
        "Le disqualifié technique garde la 2e place.",
        "Le vainqueur de la finale rejouée est 1er, le perdant garde la 3e place.",
      ],
      disciplinaire: [
        "Le vainqueur de la finale rejouée est 1er, le perdant 2e.",
        "Les perdants des quarts de finale battus par les nouveaux finalistes sont 3es.",
      ],
    };
    return {
      regle: requis.regle,
      combats: [
        {
          division: 1,
          indexInDivision: 1,
          slotA: a ?? null,
          slotB: b ?? null,
          libelle: "Finale rejouée entre les perdants des demi-finales",
        },
      ],
      consequences: consequences[requis.regle.nature] ?? [],
    };
  }

  const demies: CombatSupplementaire[] = [];
  const finale: CombatSupplementaire = {
    division: 1,
    indexInDivision: 1,
    slotA: null,
    slotB: null,
    libelle: "",
  };
  for (const cote of [0, 1] as const) {
    const a = designes[2 * cote] ?? null;
    const b = designes[2 * cote + 1] ?? null;
    if (a !== null && b !== null) {
      demies.push({ division: 2, indexInDivision: 2 + cote, slotA: a, slotB: b, libelle: "" });
    } else if (cote === 0) {
      finale.slotA = a ?? b;
    } else {
      finale.slotB = a ?? b;
    }
  }
  const directs = 2 - demies.length;
  if (demies.length === 2) {
    demies[0]!.libelle = "1re demi-finale supplémentaire";
    demies[1]!.libelle = "2e demi-finale supplémentaire";
    finale.libelle = "Finale entre les vainqueurs des demi-finales supplémentaires";
  } else if (demies.length === 1) {
    demies[0]!.libelle = "Demi-finale supplémentaire";
    finale.libelle =
      "Finale entre le vainqueur de la demi-finale supplémentaire et le seul perdant de quart de l'autre côté du tableau";
  } else {
    finale.libelle = "Finale entre les seuls perdants de quart de chaque côté du tableau";
  }

  const consequences: string[] = [];
  if (requis.regle.nature === "technique") {
    consequences.push("Les quatre disqualifiés des demi-finales sont 3es.");
    if (demies.length === 2) {
      consequences.push("Les perdants des demi-finales supplémentaires n'ont pas de médaille.");
    } else if (demies.length === 1) {
      consequences.push("Le perdant de la demi-finale supplémentaire n'a pas de médaille.");
    }
  } else {
    consequences.push("Les disqualifiés des demi-finales n'ont pas de médaille.");
    if (demies.length === 2) {
      consequences.push("Les perdants des demi-finales supplémentaires sont 3es.");
    } else if (demies.length === 1) {
      consequences.push("Le perdant de la demi-finale supplémentaire est 3e.");
    }
  }
  if (directs === 1) {
    consequences.push(
      "Un demi-finaliste disqualifié n'avait pas disputé de quart de finale : de son côté du tableau, le seul perdant de quart va directement en finale.",
    );
  } else if (directs === 2) {
    consequences.push(
      "Deux demi-finalistes disqualifiés n'avaient pas disputé de quart de finale : de chaque côté du tableau, le seul perdant de quart va directement en finale.",
    );
  }
  return { regle: requis.regle, combats: [...demies, finale], consequences };
}

export type CombatDeLaFile = { fightId: string; dureeSecondes: number };

export function positionApresRepos({
  file,
  maintenantMs,
  combatsDesAthletes,
  combatAVenir,
}: {
  file: readonly CombatDeLaFile[];
  maintenantMs: number;
  combatsDesAthletes: readonly (readonly CombatPasse[])[];
  combatAVenir: CombatAVenir;
}): number {
  if (file.length === 0) return 0;
  let finDuRepos: number | null = null;
  for (const combats of combatsDesAthletes) {
    const fin = finDeReposDeLAthlete(combats, combatAVenir);
    if (fin !== null && (finDuRepos === null || fin > finDuRepos)) finDuRepos = fin;
  }
  let debut = maintenantMs;
  for (let rang = 0; rang < file.length; rang++) {
    if (rang >= 1 && (finDuRepos === null || debut >= finDuRepos)) return rang;
    debut += (file[rang]?.dureeSecondes ?? 0) * 1000;
  }
  return file.length;
}

export type EliminationDeScenario = {
  registrationId: string;
  statut: string;
  motif: string | null;
};

export type ScenarioFinSansVainqueur = {
  id: string;
  regle: string;
  inscrits: number;
  thirdPlaceMode: "pool3" | "shared_bronze";
  fights: PropagationFight[];
  eliminations: EliminationDeScenario[];
  cible: string;
  attendu: ResolutionArbitrage | null;
};

const inscriptions = (n: number): string[] => Array.from({ length: n }, (_, i) => `r${i + 1}`);

export function tableauDeScenario(
  n: number,
  thirdPlaceMode: "pool3" | "shared_bronze" = "shared_bronze",
): PropagationFight[] {
  const regs = inscriptions(n);
  if (n < 2) return [];
  const taille = 2 ** Math.ceil(Math.log2(n));
  const profondeur = Math.log2(taille);
  const moitie = taille / 2;
  const feuilles: (string | null)[] = Array.from({ length: taille }, () => null);
  regs.forEach((r, i) => {
    if (i < moitie) feuilles[2 * i] = r;
    else feuilles[2 * (i - moitie) + 1] = r;
  });
  const fights: PropagationFight[] = [];
  const cle = (d: number, i: number, t: PropagationFight["type"]) => `${d}:${i}:${t}`;
  const neuf = (
    d: number,
    i: number,
    type: PropagationFight["type"],
    slotA: string | null,
    slotB: string | null,
  ): PropagationFight => ({
    id: cle(d, i, type),
    division: d,
    indexInDivision: i,
    type,
    slotA,
    slotB,
    isBye: false,
    state: "scheduled",
    winner: null,
    winMethod: null,
    needsArbitration: false,
    version: 0,
  });
  for (let d = profondeur; d >= 1; d--) {
    for (let i = 0; i < 2 ** (d - 1); i++) {
      if (d === profondeur) {
        const a = feuilles[2 * i] ?? null;
        const b = feuilles[2 * i + 1] ?? null;
        const f = neuf(d, i, "BraketFight", a, b);
        if ((a === null) !== (b === null)) {
          f.isBye = true;
          f.state = "finished";
          f.winner = a ?? b;
          f.winMethod = "bye";
        }
        fights.push(f);
      } else {
        fights.push(neuf(d, i, "BraketFight", null, null));
      }
    }
  }
  if (n === 3) {
    const bye = fights.find((f) => f.division === 2 && f.isBye)!;
    const rep = neuf(2, bye.indexInDivision, "BraketFightRepechage3", null, bye.winner);
    fights.splice(fights.indexOf(bye), 1, rep);
  } else if (profondeur > 1) {
    for (const f of fights.filter((x) => x.division === profondeur && x.isBye)) {
      const cible = fights.find(
        (x) =>
          x.type === "BraketFight" &&
          x.division === profondeur - 1 &&
          x.indexInDivision === Math.floor(f.indexInDivision / 2),
      );
      if (!cible) continue;
      if (f.indexInDivision % 2 === 0) cible.slotA = f.winner;
      else cible.slotB = f.winner;
    }
  }
  if (thirdPlaceMode === "pool3" && n >= 4) fights.push(neuf(2, 2, "BraketFightPool3", null, null));
  return fights;
}

export function jouerDansLeScenario(
  fights: readonly PropagationFight[],
  id: string,
  gagnant: "A" | "B",
  methode: WinMethod = "points",
  eliminated: ReadonlySet<string> = new Set(),
): PropagationFight[] {
  const f = fights.find((x) => x.id === id);
  const w = f ? (gagnant === "A" ? f.slotA : f.slotB) : null;
  if (!f || w === null) throw new Error(`scénario : combat ${id} injouable (côté ${gagnant} vide)`);
  return appliquerLePlan(fights, planFinish(fights, id, w, methode, eliminated));
}

export function doublerDansLeScenario(
  fights: readonly PropagationFight[],
  id: string,
  nature: NatureFinSansVainqueur,
  eliminated: ReadonlySet<string> = new Set(),
): PropagationFight[] {
  const fin: FinSansVainqueur =
    nature === "blessure"
      ? { method: "double_blessure" }
      : {
          method: "double_dq",
          dqReasonA: nature === "disciplinaire" ? "disciplinaire" : "technique",
          dqReasonB: nature === "technique" ? "technique" : "disciplinaire",
        };
  return appliquerLePlan(fights, planFinishSansVainqueur(fights, id, fin, eliminated));
}

export function eliminerDansLeScenario(
  fights: readonly PropagationFight[],
  elimines: ReadonlySet<string>,
): PropagationFight[] {
  return appliquerLePlan(fights, planForfeit(fights, elimines));
}

const K = (d: number, i: number, t: PropagationFight["type"] = "BraketFight") => `${d}:${i}:${t}`;
const absent = (r: string): EliminationDeScenario => ({
  registrationId: r,
  statut: "no_show",
  motif: "no_show",
});

export function scenariosFinSansVainqueur(): ScenarioFinSansVainqueur[] {
  const out: ScenarioFinSansVainqueur[] = [];
  const autreQue = (n: NatureFinSansVainqueur): NatureFinSansVainqueur =>
    n === "technique" ? "disciplinaire" : "technique";

  for (const regle of REGLES_FIN_SANS_VAINQUEUR) {
    const ajouter = (
      suffixe: string,
      inscrits: number,
      fights: PropagationFight[],
      cible: string,
      thirdPlaceMode: "pool3" | "shared_bronze" = "shared_bronze",
    ) =>
      out.push({
        id: `${regle.id}${suffixe}`,
        regle: regle.id,
        inscrits,
        thirdPlaceMode,
        fights,
        eliminations: [],
        cible,
        attendu: regle.resolution,
      });
    const n = regle.nature;

    if (regle.format === "deux") {
      ajouter("", 2, doublerDansLeScenario(tableauDeScenario(2), K(1, 0), n), K(1, 0));
    } else if (regle.format === "trois") {
      const t = tableauDeScenario(3);
      const demie = t.find((f) => f.type === "BraketFight" && f.division === 2)!.id;
      const rep = t.find((f) => f.type === "BraketFightRepechage3")!.id;
      if (regle.tour === "demie") {
        ajouter(".1re_demie", 3, doublerDansLeScenario(t, demie, n), demie);
        const joue = jouerDansLeScenario(t, demie, "A");
        ajouter(".2e_demie", 3, doublerDansLeScenario(joue, rep, n), rep);
      } else {
        const joue = jouerDansLeScenario(jouerDansLeScenario(t, demie, "A"), rep, "A");
        ajouter("", 3, doublerDansLeScenario(joue, K(1, 0), n), K(1, 0));
      }
    } else if (regle.tour === "avant_demies") {
      ajouter("", 8, doublerDansLeScenario(tableauDeScenario(8), K(3, 0), n), K(3, 0));
    } else if (regle.tour === "demie") {
      if (regle.autreDemie === "sans_double") {
        ajouter("", 4, doublerDansLeScenario(tableauDeScenario(4), K(2, 0), n), K(2, 0));
      } else {
        let t = tableauDeScenario(8);
        for (const i of [0, 1, 2, 3]) t = jouerDansLeScenario(t, K(3, i), "A");
        t = doublerDansLeScenario(t, K(2, 0), n);
        const autre = regle.autreDemie === "meme_nature" ? n : autreQue(n);
        ajouter("", 8, doublerDansLeScenario(t, K(2, 1), autre), K(2, 0));
      }
    } else if (regle.tour === "finale") {
      let t = tableauDeScenario(4);
      t = jouerDansLeScenario(jouerDansLeScenario(t, K(2, 0), "A"), K(2, 1), "A");
      ajouter("", 4, doublerDansLeScenario(t, K(1, 0), n), K(1, 0));
    } else if (regle.tour === "petite_finale") {
      let t = tableauDeScenario(4, "pool3");
      t = jouerDansLeScenario(jouerDansLeScenario(t, K(2, 0), "A"), K(2, 1), "A");
      const p3 = K(2, 2, "BraketFightPool3");
      ajouter("", 4, doublerDansLeScenario(t, p3, n), p3, "pool3");
    } else if (regle.tour === "hors_grille") {
      let t = tableauDeScenario(4);
      t = jouerDansLeScenario(jouerDansLeScenario(t, K(2, 0), "A"), K(2, 1), "A");
      t = doublerDansLeScenario(t, K(1, 0), "technique");
      t = appliquerLePlan(t, planArbitrage(t, K(1, 0), { mode: null, gagnant: null }));
      const perdants = [K(2, 0), K(2, 1)].map((id) => loserOf(t.find((f) => f.id === id)!));
      t = [
        ...t,
        {
          id: K(1, 1),
          division: 1,
          indexInDivision: 1,
          type: "BraketFight",
          slotA: perdants[0] ?? null,
          slotB: perdants[1] ?? null,
          isBye: false,
          state: "scheduled",
          winner: null,
          winMethod: null,
          needsArbitration: false,
          version: 0,
        },
      ];
      ajouter("", 4, doublerDansLeScenario(t, K(1, 1), n), K(1, 1));
    }
  }

  {
    let t = tableauDeScenario(4);
    const s0 = t.find((f) => f.id === K(2, 0))!;
    const forfaitaire = s0.slotB!;
    t = eliminerDansLeScenario(t, new Set([forfaitaire]));
    t = jouerDansLeScenario(t, K(2, 1), "A");
    t = doublerDansLeScenario(t, K(1, 0), "technique");
    out.push({
      id: "designe_indisponible.finale_perdant_de_demie_forfait",
      regle: "designe_indisponible",
      inscrits: 4,
      thirdPlaceMode: "shared_bronze",
      fights: t,
      eliminations: [absent(forfaitaire)],
      cible: K(1, 0),
      attendu: "classement",
    });
  }
  {
    let t = tableauDeScenario(4);
    t = doublerDansLeScenario(doublerDansLeScenario(t, K(2, 0), "technique"), K(2, 1), "technique");
    out.push({
      id: "designe_indisponible.deux_demies_sans_quarts",
      regle: "designe_indisponible",
      inscrits: 4,
      thirdPlaceMode: "shared_bronze",
      fights: t,
      eliminations: [],
      cible: K(2, 0),
      attendu: "classement",
    });
  }
  {
    let t = tableauDeScenario(3);
    const demie = t.find((f) => f.type === "BraketFight" && f.division === 2)!.id;
    const rep = t.find((f) => f.type === "BraketFightRepechage3")!;
    const troisieme = rep.slotB!;
    t = jouerDansLeScenario(t, demie, "A");
    t = eliminerDansLeScenario(t, new Set([troisieme]));
    t = doublerDansLeScenario(t, K(1, 0), "technique");
    out.push({
      id: "designe_indisponible.trois_perdant_2e_demie_forfait",
      regle: "designe_indisponible",
      inscrits: 3,
      thirdPlaceMode: "shared_bronze",
      fights: t,
      eliminations: [absent(troisieme)],
      cible: K(1, 0),
      attendu: "classement",
    });
  }
  for (const nature of ["technique", "disciplinaire"] as const) {
    let t = tableauDeScenario(7);
    for (const i of [0, 1, 2]) t = jouerDansLeScenario(t, K(3, i), "A");
    t = doublerDansLeScenario(doublerDansLeScenario(t, K(2, 0), nature), K(2, 1), nature);
    out.push({
      id: `quatre.deux_demies.${nature}.quart_exempte`,
      regle: `quatre.deux_demies.${nature}`,
      inscrits: 7,
      thirdPlaceMode: "shared_bronze",
      fights: t,
      eliminations: [],
      cible: K(2, 0),
      attendu: "combats",
    });
  }
  {
    let t = tableauDeScenario(8).map((f): PropagationFight =>
      f.division === 3 && (f.indexInDivision === 1 || f.indexInDivision === 3)
        ? { ...f, slotB: null, isBye: true, state: "finished", winner: f.slotA, winMethod: "bye" }
        : f,
    );
    t = appliquerLePlan(t, { patches: [], propagation: planByeCascade(t), expected: [] });
    for (const i of [0, 2]) t = jouerDansLeScenario(t, K(3, i), "A");
    t = doublerDansLeScenario(doublerDansLeScenario(t, K(2, 0), "technique"), K(2, 1), "technique");
    out.push({
      id: "quatre.deux_demies.technique.un_quart_exempte_de_chaque_cote",
      regle: "quatre.deux_demies.technique",
      inscrits: 8,
      thirdPlaceMode: "shared_bronze",
      fights: t,
      eliminations: [],
      cible: K(2, 0),
      attendu: "combats",
    });
  }
  {
    let t = tableauDeScenario(6);
    for (const i of [0, 1]) t = jouerDansLeScenario(t, K(3, i), "A");
    t = doublerDansLeScenario(doublerDansLeScenario(t, K(2, 0), "technique"), K(2, 1), "technique");
    out.push({
      id: "designe_indisponible.deux_demies_cote_sans_quart",
      regle: "designe_indisponible",
      inscrits: 6,
      thirdPlaceMode: "shared_bronze",
      fights: t,
      eliminations: [],
      cible: K(2, 0),
      attendu: "classement",
    });
  }
  return out;
}

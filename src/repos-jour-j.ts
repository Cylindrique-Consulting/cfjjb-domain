import type { FightState, WinMethod } from "./bracket-propagation";
import { finDeReposDeLAthlete, type CombatAVenir, type CombatPasse } from "./fight-rest";

export function finReelleDuCombatDispute(
  pausedAtMs: number | null,
  finishedAtMs: number | null,
): number | null {
  return pausedAtMs ?? finishedAtMs;
}

export type EtatDuRepos = {
  enRepos: boolean;
  requisMs: number;
  ecouleMs: number;
  restantMs: number;
};

export function etatDuRepos({
  finPrecedenteMs,
  finDeReposMs,
  maintenantMs,
}: {
  finPrecedenteMs: number;
  finDeReposMs: number;
  maintenantMs: number;
}): EtatDuRepos {
  return {
    enRepos: finDeReposMs > maintenantMs,
    requisMs: Math.max(0, finDeReposMs - finPrecedenteMs),
    ecouleMs: Math.max(0, maintenantMs - finPrecedenteMs),
    restantMs: Math.max(0, finDeReposMs - maintenantMs),
  };
}

export type CoteDuRepos = {
  cote: "a" | "b";
  finPrecedenteMs: number;
  finDeReposMs: number;
};

export type ReposDuCombat = {
  finDeReposMs: number;
  cotes: CoteDuRepos[];
};

export function reposDuCombat(
  cotes: readonly CoteDuRepos[],
  maintenantMs: number,
): ReposDuCombat | null {
  const enRepos = cotes
    .filter((c) => c.finDeReposMs > maintenantMs)
    .sort((x, y) => (x.cote < y.cote ? -1 : x.cote > y.cote ? 1 : 0));
  if (enRepos.length === 0) return null;
  return {
    finDeReposMs: Math.max(...enRepos.map((c) => c.finDeReposMs)),
    cotes: enRepos,
  };
}

export type CombatDeLaFileDuRepos = {
  fightId: string;
  dureeSecondes: number;
  compte: boolean;
};

export function rangApresRepos({
  file,
  rangActuel,
  maintenantMs,
  finDuReposMs,
  rangMax,
}: {
  file: readonly CombatDeLaFileDuRepos[];
  rangActuel: number;
  maintenantMs: number;
  finDuReposMs: number | null;
  rangMax: number;
}): number {
  const depart = Math.max(0, Math.min(rangActuel, file.length));
  if (finDuReposMs === null || finDuReposMs <= maintenantMs) return depart;
  const plafond = Math.max(depart, Math.min(rangMax, file.length));

  let debut = maintenantMs;
  for (let i = 0; i < depart; i++) {
    const c = file[i];
    if (c?.compte) debut += c.dureeSecondes * 1000;
  }

  let rang = depart;
  while (rang < plafond && debut < finDuReposMs) {
    const franchi = file[rang];
    if (!franchi?.compte) break;
    debut += franchi.dureeSecondes * 1000;
    rang += 1;
  }
  return rang;
}

const MINUTE_MS = 60_000;
export const ORIGINE_DES_SCENARIOS_DE_REPOS_MS = Date.UTC(2026, 8, 20, 9, 0, 0);
const T0 = ORIGINE_DES_SCENARIOS_DE_REPOS_MS;

export type CombatPasseDeScenario = {
  id: string;
  state: FightState;
  winMethod: WinMethod | null;
  chronoLance: boolean;
  pausedAtMs: number | null;
  finishedAtMs: number | null;
  autreCategorie?: boolean;
};

export type ScenarioFinDeRepos = {
  id: string;
  libelle: string;
  combatsPasses: CombatPasseDeScenario[];
  combatAVenir: CombatAVenir;
  finPrecedenteAttendueMs: number | null;
  attendu: number | null;
};

export function combatsPassesDuScenario(s: ScenarioFinDeRepos): CombatPasse[] {
  return s.combatsPasses.map((c) => ({
    id: c.id,
    state: c.state,
    winMethod: c.winMethod,
    chronoLance: c.chronoLance,
    finReelleMs:
      c.state === "finished" ? finReelleDuCombatDispute(c.pausedAtMs, c.finishedAtMs) : null,
  }));
}

export function finDeReposDuScenario(s: ScenarioFinDeRepos): number | null {
  return finDeReposDeLAthlete(combatsPassesDuScenario(s), s.combatAVenir);
}

function fini(
  id: string,
  winMethod: WinMethod,
  finMs: number,
  options: { chronoLance?: boolean; pausedAtMs?: number | null; autreCategorie?: boolean } = {},
): CombatPasseDeScenario {
  const pausedAtMs = options.pausedAtMs === undefined ? finMs : options.pausedAtMs;
  return {
    id,
    state: "finished",
    winMethod,
    chronoLance: options.chronoLance ?? true,
    pausedAtMs,
    finishedAtMs: finMs + 4_000,
    autreCategorie: options.autreCategorie,
  };
}

const DEMIE_300 = { id: "avenir", division: 2, type: "BraketFight", dureeSecondes: 300 } as const;
const FINALE_300 = { id: "avenir", division: 1, type: "BraketFight", dureeSecondes: 300 } as const;

export const SCENARIOS_FIN_DE_REPOS: readonly ScenarioFinDeRepos[] = [
  {
    id: "simple",
    libelle: "un combat disputé avant une demi-finale : une durée de repos",
    combatsPasses: [fini("qf", "points", T0)],
    combatAVenir: DEMIE_300,
    finPrecedenteAttendueMs: T0,
    attendu: T0 + 5 * MINUTE_MS,
  },
  {
    id: "double_avant_finale",
    libelle: "avant une finale : deux durées de repos",
    combatsPasses: [fini("df", "submission", T0)],
    combatAVenir: FINALE_300,
    finPrecedenteAttendueMs: T0,
    attendu: T0 + 10 * MINUTE_MS,
  },
  {
    id: "duree_du_combat_a_venir",
    libelle: "la durée est celle de la catégorie du combat à venir (absolut à 6 min)",
    combatsPasses: [fini("poids", "points", T0, { autreCategorie: true })],
    combatAVenir: { id: "avenir", division: 3, type: "BraketFight", dureeSecondes: 360 },
    finPrecedenteAttendueMs: T0,
    attendu: T0 + 6 * MINUTE_MS,
  },
  {
    id: "deuxieme_demie_tableau_de_trois",
    libelle: "la 2e demi-finale d'un tableau de trois est un repos simple",
    combatsPasses: [fini("df1", "points", T0)],
    combatAVenir: {
      id: "avenir",
      division: 2,
      type: "BraketFightRepechage3",
      dureeSecondes: 300,
    },
    finPrecedenteAttendueMs: T0,
    attendu: T0 + 5 * MINUTE_MS,
  },
  {
    id: "troisieme_place",
    libelle: "le combat pour la 3e place est un repos simple",
    combatsPasses: [fini("df", "points", T0)],
    combatAVenir: { id: "avenir", division: 2, type: "BraketFightPool3", dureeSecondes: 300 },
    finPrecedenteAttendueMs: T0,
    attendu: T0 + 5 * MINUTE_MS,
  },
  {
    id: "wo_sans_repos",
    libelle: "une victoire par forfait sans chrono lancé n'ouvre aucun repos",
    combatsPasses: [fini("df", "wo", T0, { chronoLance: false, pausedAtMs: null })],
    combatAVenir: FINALE_300,
    finPrecedenteAttendueMs: null,
    attendu: null,
  },
  {
    id: "double_wo_sans_repos",
    libelle: "un double forfait n'ouvre aucun repos",
    combatsPasses: [fini("df", "double_wo", T0, { chronoLance: false, pausedAtMs: null })],
    combatAVenir: DEMIE_300,
    finPrecedenteAttendueMs: null,
    attendu: null,
  },
  {
    id: "bye_sans_repos",
    libelle: "un passage sans adversaire n'ouvre aucun repos",
    combatsPasses: [fini("t1", "bye", T0, { chronoLance: false, pausedAtMs: null })],
    combatAVenir: DEMIE_300,
    finPrecedenteAttendueMs: null,
    attendu: null,
  },
  {
    id: "designation_sans_repos",
    libelle: "une désignation entre coéquipiers n'ouvre aucun repos",
    combatsPasses: [fini("df", "designation", T0, { chronoLance: false, pausedAtMs: null })],
    combatAVenir: FINALE_300,
    finPrecedenteAttendueMs: null,
    attendu: null,
  },
  {
    id: "lance_puis_forfait",
    libelle: "un combat lancé puis soldé par forfait est disputé : il ouvre un repos",
    combatsPasses: [fini("df", "wo", T0, { chronoLance: true })],
    combatAVenir: FINALE_300,
    finPrecedenteAttendueMs: T0,
    attendu: T0 + 10 * MINUTE_MS,
  },
  {
    id: "double_dq_disputee",
    libelle: "une double disqualification est un combat disputé",
    combatsPasses: [fini("qf", "double_dq", T0)],
    combatAVenir: DEMIE_300,
    finPrecedenteAttendueMs: T0,
    attendu: T0 + 5 * MINUTE_MS,
  },
  {
    id: "double_blessure_disputee",
    libelle: "un arrêt pour double blessure est un combat disputé",
    combatsPasses: [fini("qf", "double_blessure", T0)],
    combatAVenir: DEMIE_300,
    finPrecedenteAttendueMs: T0,
    attendu: T0 + 5 * MINUTE_MS,
  },
  {
    id: "dernier_combat_seul",
    libelle: "seul le dernier combat disputé compte",
    combatsPasses: [
      fini("t1", "points", T0),
      fini("qf", "submission", T0 + 20 * MINUTE_MS),
      fini("df", "wo", T0 + 40 * MINUTE_MS, { chronoLance: false, pausedAtMs: null }),
    ],
    combatAVenir: FINALE_300,
    finPrecedenteAttendueMs: T0 + 20 * MINUTE_MS,
    attendu: T0 + 30 * MINUTE_MS,
  },
  {
    id: "fin_enregistree_en_repli",
    libelle: "sans instant d'arrêt du chrono, la fin enregistrée fait foi",
    combatsPasses: [fini("qf", "points", T0, { pausedAtMs: null })],
    combatAVenir: DEMIE_300,
    finPrecedenteAttendueMs: T0 + 4_000,
    attendu: T0 + 4_000 + 5 * MINUTE_MS,
  },
  {
    id: "combat_en_cours_sans_repos",
    libelle: "un combat lancé mais pas terminé n'ouvre pas encore de repos",
    combatsPasses: [
      {
        id: "qf",
        state: "in_progress",
        winMethod: null,
        chronoLance: true,
        pausedAtMs: T0,
        finishedAtMs: null,
      },
    ],
    combatAVenir: DEMIE_300,
    finPrecedenteAttendueMs: null,
    attendu: null,
  },
  {
    id: "aucun_combat",
    libelle: "sans combat passé, aucun repos",
    combatsPasses: [],
    combatAVenir: FINALE_300,
    finPrecedenteAttendueMs: null,
    attendu: null,
  },
];

export type ScenarioPlacementApresRepos = {
  id: string;
  libelle: string;
  file: CombatDeLaFileDuRepos[];
  rangActuel: number;
  maintenantMs: number;
  finDuReposMs: number | null;
  rangMax: number;
  attendu: number;
};

function prets(...durees: number[]): CombatDeLaFileDuRepos[] {
  return durees.map((dureeSecondes, i) => ({ fightId: `c${i + 1}`, dureeSecondes, compte: true }));
}

export const SCENARIOS_PLACEMENT_APRES_REPOS: readonly ScenarioPlacementApresRepos[] = [
  {
    id: "sans_repos",
    libelle: "sans repos, le combat garde sa place",
    file: prets(300, 300, 300),
    rangActuel: 0,
    maintenantMs: T0,
    finDuReposMs: null,
    rangMax: 3,
    attendu: 0,
  },
  {
    id: "repos_echu",
    libelle: "un repos échu ne déplace rien",
    file: prets(300, 300),
    rangActuel: 0,
    maintenantMs: T0,
    finDuReposMs: T0,
    rangMax: 2,
    attendu: 0,
  },
  {
    id: "recul_jusqua_la_fin_du_repos",
    libelle: "le combat passe derrière des combats prêts jusqu'à la fin de son repos",
    file: prets(300, 300, 300, 300),
    rangActuel: 0,
    maintenantMs: T0,
    finDuReposMs: T0 + 10 * MINUTE_MS,
    rangMax: 4,
    attendu: 2,
  },
  {
    id: "borne_egale_incluse",
    libelle: "un début estimé égal à la fin du repos suffit",
    file: prets(300, 300, 300),
    rangActuel: 0,
    maintenantMs: T0,
    finDuReposMs: T0 + 5 * MINUTE_MS,
    rangMax: 3,
    attendu: 1,
  },
  {
    id: "debut_deja_apres_le_repos",
    libelle: "un combat dont le début estimé dépasse déjà le repos ne bouge pas",
    file: prets(300, 300, 300),
    rangActuel: 2,
    maintenantMs: T0,
    finDuReposMs: T0 + 8 * MINUTE_MS,
    rangMax: 3,
    attendu: 2,
  },
  {
    id: "jamais_vers_l_avant",
    libelle: "le rang ne diminue jamais, même si un rang plus haut suffirait",
    file: prets(600, 600, 600),
    rangActuel: 3,
    maintenantMs: T0,
    finDuReposMs: T0 + 5 * MINUTE_MS,
    rangMax: 3,
    attendu: 3,
  },
  {
    id: "arret_sur_un_combat_non_pret",
    libelle: "le recul s'arrête devant un combat qui n'est pas prêt",
    file: [
      { fightId: "c1", dureeSecondes: 300, compte: true },
      { fightId: "c2", dureeSecondes: 300, compte: false },
      { fightId: "c3", dureeSecondes: 300, compte: true },
    ],
    rangActuel: 0,
    maintenantMs: T0,
    finDuReposMs: T0 + 30 * MINUTE_MS,
    rangMax: 3,
    attendu: 1,
  },
  {
    id: "non_pret_devant_non_compte",
    libelle: "un combat non prêt placé devant n'entre pas dans l'estimation",
    file: [
      { fightId: "c1", dureeSecondes: 600, compte: false },
      { fightId: "c2", dureeSecondes: 300, compte: true },
      { fightId: "c3", dureeSecondes: 300, compte: true },
    ],
    rangActuel: 1,
    maintenantMs: T0,
    finDuReposMs: T0 + 5 * MINUTE_MS,
    rangMax: 3,
    attendu: 2,
  },
  {
    id: "plafond_du_nourri",
    libelle: "jamais au-delà du combat qui attend le résultat de ce combat",
    file: prets(300, 300, 300, 300),
    rangActuel: 0,
    maintenantMs: T0,
    finDuReposMs: T0 + 60 * MINUTE_MS,
    rangMax: 1,
    attendu: 1,
  },
  {
    id: "fin_de_file",
    libelle: "au-delà de la file, la dernière place",
    file: prets(120, 120),
    rangActuel: 0,
    maintenantMs: T0,
    finDuReposMs: T0 + 60 * MINUTE_MS,
    rangMax: 2,
    attendu: 2,
  },
  {
    id: "combat_en_cours_compte",
    libelle: "le combat en cours en tête compte dans l'estimation",
    file: prets(300, 300, 300),
    rangActuel: 1,
    maintenantMs: T0,
    finDuReposMs: T0 + 10 * MINUTE_MS,
    rangMax: 3,
    attendu: 2,
  },
];

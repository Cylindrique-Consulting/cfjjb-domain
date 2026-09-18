import type { BracketFightType } from "./bracket-generator";
import { findFeederFight, type PropagationFight, type Slot } from "./bracket-propagation";
import type { DrawFormat } from "./competition-format";
import { multiplicateurDeRepos } from "./fight-rest";
import { categoryRunningOrder } from "./planning-generator";

export const ESPACEMENT_PAR_DEFAUT_SECONDES = 60;

export type CombatAPlanifier = {
  id: string;
  categorieId: string;
  tatamiId: string;
  division: number;
  indexInDivision: number;
  type: BracketFightType;
  isBye?: boolean;
  athletes?: readonly (string | null)[];
};

export type CategorieAPlanifier = {
  id: string;
  dureeSecondes: number;
  jour: number;
  rangDePlanning: number;
  format?: DrawFormat;
};

export type TatamiAPlanifier = {
  id: string;
  numero: number;
  debutParJour: Readonly<Record<number, number>>;
};

export type CreneauOccupe = {
  athleteId: string;
  debutMs: number;
  finMs: number;
  origine?: string;
};

export type EntreeDePlanification = {
  espacementSecondes?: number;
  debutAuPlusTotMs?: number;
  tatamis: readonly TatamiAPlanifier[];
  categories: readonly CategorieAPlanifier[];
  combats: readonly CombatAPlanifier[];
  occupations?: readonly CreneauOccupe[];
};

export type PlacementDeCombat = {
  fightId: string;
  categorieId: string;
  tatamiId: string;
  jour: number;
  rang: number;
  debutMs: number;
  finMs: number;
  attenteDeRepos: boolean;
  intercale: boolean;
  dependanceIgnoree: boolean;
};

export type PlanDeCategorie = {
  categorieId: string;
  jour: number;
  debutMs: number;
  finMs: number;
  tatamiIds: string[];
  combats: number;
};

export type PlanDeTatami = {
  tatamiId: string;
  numero: number;
  jour: number;
  debutMs: number;
  finMs: number;
  combats: number;
};

export type ResultatDePlanification = {
  combats: Map<string, PlacementDeCombat>;
  categories: Map<string, PlanDeCategorie>;
  tatamis: Map<string, PlanDeTatami>;
  finParJour: Map<number, number>;
  combatsSansHoraire: string[];
};

export function clePiste(tatamiId: string, jour: number): string {
  return `${tatamiId}|${jour}`;
}

const SLOTS: readonly Slot[] = ["A", "B"];

type FileDeCategorie = {
  categorieId: string;
  rangDePlanning: number;
  tours: CombatAPlanifier[][];
  position: number;
  restants: number;
};

type Piste = {
  tatamiId: string;
  numero: number;
  jour: number;
  ancrageMs: number;
  libreMs: number | null;
  rang: number;
  files: FileDeCategorie[];
  candidat: Candidat | null | undefined;
};

type Evaluation = {
  debutMs: number;
  finMs: number;
  attenteDeRepos: boolean;
  bloque: boolean;
};

type Candidat = {
  piste: Piste;
  file: FileDeCategorie;
  combat: CombatAPlanifier;
  evaluation: Evaluation;
};

function comparerChaines(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function grouperParTour(
  combats: readonly CombatAPlanifier[],
  format: DrawFormat | undefined,
): CombatAPlanifier[][] {
  const ordonnes = categoryRunningOrder([...combats], { format });
  const tours: CombatAPlanifier[][] = [];
  let courant: string | null = null;
  for (const combat of ordonnes) {
    const cle = `${combat.division}:${combat.type}`;
    if (cle !== courant) {
      tours.push([]);
      courant = cle;
    }
    tours[tours.length - 1]?.push(combat);
  }
  return tours;
}

function avancerLaFile(file: FileDeCategorie): void {
  while (file.position < file.tours.length && (file.tours[file.position]?.length ?? 0) === 0) {
    file.position += 1;
  }
}

function versPropagation(combat: CombatAPlanifier): PropagationFight {
  return {
    id: combat.id,
    division: combat.division,
    indexInDivision: combat.indexInDivision,
    type: combat.type,
    slotA: combat.athletes?.[0] ?? null,
    slotB: combat.athletes?.[1] ?? null,
    isBye: combat.isBye === true,
    state: "scheduled",
    winner: null,
    winMethod: null,
    needsArbitration: false,
    version: 0,
  };
}

export function planifierCombats(entree: EntreeDePlanification): ResultatDePlanification {
  const espacementMs =
    Math.max(0, entree.espacementSecondes ?? ESPACEMENT_PAR_DEFAUT_SECONDES) * 1000;
  const categories = new Map(entree.categories.map((c) => [c.id, c]));
  const tatamis = new Map(entree.tatamis.map((t) => [t.id, t]));

  const parCategorie = new Map<string, CombatAPlanifier[]>();
  for (const combat of entree.combats) {
    if (!categories.has(combat.categorieId)) {
      throw new Error(
        `planification : le combat ${combat.id} vise la catégorie inconnue ${combat.categorieId}.`,
      );
    }
    if (!tatamis.has(combat.tatamiId)) {
      throw new Error(
        `planification : le combat ${combat.id} vise le tatami inconnu ${combat.tatamiId}.`,
      );
    }
    const liste = parCategorie.get(combat.categorieId);
    if (liste) liste.push(combat);
    else parCategorie.set(combat.categorieId, [combat]);
  }

  const byes = new Set<string>();
  for (const combat of entree.combats) if (combat.isBye === true) byes.add(combat.id);

  const sources = new Map<string, [string | null, string | null]>();
  for (const liste of parCategorie.values()) {
    const proxies = liste.map(versPropagation);
    for (const combat of liste) {
      const proxy = versPropagation(combat);
      const resolues = SLOTS.map((slot, rang) => {
        if ((combat.athletes?.[rang] ?? null) !== null) return null;
        const nourricier = findFeederFight(proxies, proxy, slot);
        if (nourricier === null || byes.has(nourricier.id)) return null;
        return nourricier.id;
      });
      const a = resolues[0] ?? null;
      const b = resolues[1] ?? null;
      if (a !== null || b !== null) sources.set(combat.id, [a, b]);
    }
  }

  const pistes = new Map<string, Piste>();
  const pisteDuCombat = new Map<string, Piste>();
  for (const combat of entree.combats) {
    if (byes.has(combat.id)) continue;
    const categorie = categories.get(combat.categorieId);
    const tatami = tatamis.get(combat.tatamiId);
    if (categorie === undefined || tatami === undefined) continue;
    const cle = clePiste(tatami.id, categorie.jour);
    let piste = pistes.get(cle);
    if (piste === undefined) {
      const prevu = tatami.debutParJour[categorie.jour];
      const plancher = entree.debutAuPlusTotMs;
      if (prevu === undefined && plancher === undefined) {
        throw new Error(
          `planification : aucune heure de début connue pour le tatami ${tatami.id} ` +
            `à la journée ${categorie.jour}.`,
        );
      }
      const ancrage =
        prevu === undefined
          ? (plancher as number)
          : plancher === undefined
            ? prevu
            : Math.max(prevu, plancher);
      piste = {
        tatamiId: tatami.id,
        numero: tatami.numero,
        jour: categorie.jour,
        ancrageMs: ancrage,
        libreMs: null,
        rang: 0,
        files: [],
        candidat: undefined,
      };
      pistes.set(cle, piste);
    }
    let file = piste.files.find((f) => f.categorieId === categorie.id);
    if (file === undefined) {
      file = {
        categorieId: categorie.id,
        rangDePlanning: categorie.rangDePlanning,
        tours: [[]],
        position: 0,
        restants: 0,
      };
      piste.files.push(file);
    }
    file.tours[0]?.push(combat);
    file.restants += 1;
    pisteDuCombat.set(combat.id, piste);
  }

  const ordreDesPistes = [...pistes.values()].sort(
    (a, b) => a.jour - b.jour || a.numero - b.numero || comparerChaines(a.tatamiId, b.tatamiId),
  );
  for (const piste of ordreDesPistes) {
    piste.files.sort(
      (a, b) =>
        a.rangDePlanning - b.rangDePlanning || comparerChaines(a.categorieId, b.categorieId),
    );
    for (const file of piste.files) {
      const categorie = categories.get(file.categorieId);
      file.tours = grouperParTour(file.tours[0] ?? [], categorie?.format);
      avancerLaFile(file);
    }
  }

  const dependants = new Map<string, string[]>();
  const combatsParAthlete = new Map<string, string[]>();
  const indexer = (index: Map<string, string[]>, cle: string, valeur: string) => {
    const liste = index.get(cle);
    if (liste) liste.push(valeur);
    else index.set(cle, [valeur]);
  };
  for (const combat of entree.combats) {
    if (byes.has(combat.id)) continue;
    for (const source of sources.get(combat.id) ?? []) {
      if (source !== null) indexer(dependants, source, combat.id);
    }
    for (const athlete of combat.athletes ?? []) {
      if (athlete !== null) indexer(combatsParAthlete, athlete, combat.id);
    }
  }

  const finParAthlete = new Map<string, number>();
  for (const creneau of entree.occupations ?? []) {
    if (!Number.isFinite(creneau.finMs)) continue;
    const avant = finParAthlete.get(creneau.athleteId);
    finParAthlete.set(
      creneau.athleteId,
      avant === undefined ? creneau.finMs : Math.max(avant, creneau.finMs),
    );
  }

  const places = new Map<string, PlacementDeCombat>();

  const libreDe = (piste: Piste): number =>
    piste.libreMs === null ? piste.ancrageMs : Math.max(piste.ancrageMs, piste.libreMs);

  const evaluer = (piste: Piste, combat: CombatAPlanifier, ignorerSources: boolean): Evaluation => {
    const categorie = categories.get(combat.categorieId);
    const dureeMs = Math.max(0, categorie?.dureeSecondes ?? 0) * 1000;
    const libre = libreDe(piste);
    const reposMs =
      multiplicateurDeRepos({ division: combat.division, type: combat.type }) * dureeMs;
    let contrainte: number | null = null;
    let bloque = false;
    const sourcesDuCombat = sources.get(combat.id);
    for (let rang = 0; rang < 2; rang += 1) {
      const athlete = combat.athletes?.[rang] ?? null;
      if (athlete !== null) {
        const fin = finParAthlete.get(athlete);
        if (fin !== undefined) {
          const butoir = fin + reposMs;
          contrainte = contrainte === null ? butoir : Math.max(contrainte, butoir);
        }
        continue;
      }
      const source = sourcesDuCombat?.[rang] ?? null;
      if (source === null) continue;
      const place = places.get(source);
      if (place !== undefined) {
        const butoir = place.finMs + reposMs;
        contrainte = contrainte === null ? butoir : Math.max(contrainte, butoir);
      } else if (!ignorerSources) {
        bloque = true;
      }
    }
    const debut = contrainte === null ? libre : Math.max(libre, contrainte);
    return {
      debutMs: debut,
      finMs: debut + dureeMs,
      attenteDeRepos: contrainte !== null && contrainte > libre,
      bloque,
    };
  };

  const candidatDeLaPiste = (piste: Piste, ignorerSources: boolean): Candidat | null => {
    const libre = libreDe(piste);
    let differe: Candidat | null = null;
    for (const file of piste.files) {
      const tour = file.tours[file.position];
      if (tour === undefined) continue;
      let meilleurDuTour: Candidat | null = null;
      for (const combat of tour) {
        const evaluation = evaluer(piste, combat, ignorerSources);
        if (evaluation.bloque) continue;
        if (evaluation.debutMs <= libre) {
          meilleurDuTour = { piste, file, combat, evaluation };
          break;
        }
        if (meilleurDuTour === null || evaluation.debutMs < meilleurDuTour.evaluation.debutMs) {
          meilleurDuTour = { piste, file, combat, evaluation };
        }
      }
      if (meilleurDuTour === null) continue;
      if (meilleurDuTour.evaluation.debutMs <= libre) return meilleurDuTour;
      if (differe === null || meilleurDuTour.evaluation.debutMs < differe.evaluation.debutMs) {
        differe = meilleurDuTour;
      }
    }
    return differe;
  };

  const mieux = (a: Candidat | null, b: Candidat): Candidat => {
    if (a === null) return b;
    if (b.evaluation.debutMs !== a.evaluation.debutMs) {
      return b.evaluation.debutMs < a.evaluation.debutMs ? b : a;
    }
    if (b.piste.numero !== a.piste.numero) return b.piste.numero < a.piste.numero ? b : a;
    if (b.piste.jour !== a.piste.jour) return b.piste.jour < a.piste.jour ? b : a;
    if (b.file.rangDePlanning !== a.file.rangDePlanning) {
      return b.file.rangDePlanning < a.file.rangDePlanning ? b : a;
    }
    return comparerChaines(b.combat.id, a.combat.id) < 0 ? b : a;
  };

  const perimer = (piste: Piste | undefined) => {
    if (piste !== undefined) piste.candidat = undefined;
  };

  const placer = (candidat: Candidat, dependanceIgnoree: boolean) => {
    const { piste, file, combat, evaluation } = candidat;
    const intercale = piste.files.some(
      (autre) => autre.rangDePlanning < file.rangDePlanning && autre.restants > 0,
    );
    piste.rang += 1;
    places.set(combat.id, {
      fightId: combat.id,
      categorieId: combat.categorieId,
      tatamiId: piste.tatamiId,
      jour: piste.jour,
      rang: piste.rang,
      debutMs: evaluation.debutMs,
      finMs: evaluation.finMs,
      attenteDeRepos: evaluation.attenteDeRepos,
      intercale,
      dependanceIgnoree,
    });
    piste.libreMs = evaluation.finMs + espacementMs;
    const tour = file.tours[file.position];
    if (tour !== undefined) {
      const index = tour.indexOf(combat);
      if (index >= 0) tour.splice(index, 1);
    }
    file.restants -= 1;
    avancerLaFile(file);
    perimer(piste);
    for (const dependant of dependants.get(combat.id) ?? []) {
      perimer(pisteDuCombat.get(dependant));
    }
    for (const athlete of combat.athletes ?? []) {
      if (athlete === null) continue;
      const avant = finParAthlete.get(athlete);
      finParAthlete.set(
        athlete,
        avant === undefined ? evaluation.finMs : Math.max(avant, evaluation.finMs),
      );
      for (const autre of combatsParAthlete.get(athlete) ?? []) {
        perimer(pisteDuCombat.get(autre));
      }
    }
  };

  for (;;) {
    let choix: Candidat | null = null;
    for (const piste of ordreDesPistes) {
      if (piste.candidat === undefined) piste.candidat = candidatDeLaPiste(piste, false);
      const candidat = piste.candidat;
      if (candidat !== null) choix = mieux(choix, candidat);
    }
    if (choix !== null) {
      placer(choix, false);
      continue;
    }
    let secours: Candidat | null = null;
    for (const piste of ordreDesPistes) {
      const candidat = candidatDeLaPiste(piste, true);
      if (candidat !== null) secours = mieux(secours, candidat);
    }
    if (secours === null) break;
    placer(secours, true);
  }

  const plansDeCategorie = new Map<string, PlanDeCategorie>();
  const plansDeTatami = new Map<string, PlanDeTatami>();
  const finParJour = new Map<number, number>();
  for (const place of places.values()) {
    const categorie = categories.get(place.categorieId);
    const plan = plansDeCategorie.get(place.categorieId);
    if (plan === undefined) {
      plansDeCategorie.set(place.categorieId, {
        categorieId: place.categorieId,
        jour: categorie?.jour ?? place.jour,
        debutMs: place.debutMs,
        finMs: place.finMs,
        tatamiIds: [place.tatamiId],
        combats: 1,
      });
    } else {
      plan.debutMs = Math.min(plan.debutMs, place.debutMs);
      plan.finMs = Math.max(plan.finMs, place.finMs);
      plan.combats += 1;
      if (!plan.tatamiIds.includes(place.tatamiId)) plan.tatamiIds.push(place.tatamiId);
    }

    const cle = clePiste(place.tatamiId, place.jour);
    const tatami = plansDeTatami.get(cle);
    if (tatami === undefined) {
      plansDeTatami.set(cle, {
        tatamiId: place.tatamiId,
        numero: tatamis.get(place.tatamiId)?.numero ?? 0,
        jour: place.jour,
        debutMs: place.debutMs,
        finMs: place.finMs,
        combats: 1,
      });
    } else {
      tatami.debutMs = Math.min(tatami.debutMs, place.debutMs);
      tatami.finMs = Math.max(tatami.finMs, place.finMs);
      tatami.combats += 1;
    }

    const fin = finParJour.get(place.jour);
    finParJour.set(place.jour, fin === undefined ? place.finMs : Math.max(fin, place.finMs));
  }
  for (const plan of plansDeCategorie.values()) {
    plan.tatamiIds.sort(
      (a, b) =>
        (tatamis.get(a)?.numero ?? 0) - (tatamis.get(b)?.numero ?? 0) || comparerChaines(a, b),
    );
  }

  const combatsSansHoraire = entree.combats
    .filter((combat) => !places.has(combat.id))
    .map((combat) => combat.id);

  return {
    combats: places,
    categories: plansDeCategorie,
    tatamis: plansDeTatami,
    finParJour,
    combatsSansHoraire,
  };
}

export function dureeIncompressibleSecondes(entree: {
  dureeSecondes: number;
  divisionMax: number;
  tableauDeTrois?: boolean;
}): number {
  const duree = Math.max(0, entree.dureeSecondes);
  if (entree.tableauDeTrois === true) return 6 * duree;
  const profondeur = Math.max(0, Math.floor(entree.divisionMax));
  if (profondeur <= 0) return 0;
  if (profondeur === 1) return duree;
  return 2 * profondeur * duree;
}

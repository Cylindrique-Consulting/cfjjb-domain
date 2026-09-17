import { findFeederFight, type PropagationFight, type Slot } from "./bracket-propagation";
import { multiplicateurDeRepos } from "./fight-rest";

export const PLANCHER_AFFICHAGE_MS = 90 * 60_000;

export type StatutAEstimer = "pending" | "called" | "ready" | "in_progress" | "paused";

export type TypeDeCombatAEstimer = PropagationFight["type"];

export type CombatAEstimer = {
  id: string;
  tatamiId: string;
  rang: number;
  jour: 0 | 1;
  statut: StatutAEstimer;
  startedAtMs: number | null;
  pausedAtMs: number | null;
  pausedMs: number;
  dureeSecondes: number;
  categoryId: string;
  division: number;
  index: number;
  type: TypeDeCombatAEstimer;
  athletes: readonly [string | null, string | null];
  plancherMs: number | null;
};

export type TatamiAEstimer = {
  id: string;
  physique?: string;
  soeur?: boolean;
  enchainement?: number;
  debutPrevuMs: readonly [number | null, number | null];
  lanceAujourdhui?: boolean;
  derniereFinMs?: number | null;
};

export type EntreeEstimation = {
  maintenantMs: number;
  espacementSecondes: number;
  journee: { index: 0 | 1; commencee: boolean };
  tatamis: readonly TatamiAEstimer[];
  combats: readonly CombatAEstimer[];
  reposParAthlete: Readonly<Record<string, number>>;
};

export type OptionsEstimation = {
  enchainement: "decalage" | "aucun";
};

export type EstimationCombat = {
  fightId: string;
  etat: "a_venir" | "en_cours";
  debutMs: number;
  debutDeFileMs: number;
  finMs: number;
  aPresent: boolean;
  plancherApplique: boolean;
  attendRepos: boolean;
  finDeReposMs: number | null;
  dependanceIgnoree: boolean;
};

export type EstimationTatami = {
  tatamiId: string;
  finEstimeeMs: number | null;
  restants: number;
};

export type ResultatEstimation = {
  combats: Map<string, EstimationCombat>;
  tatamis: Map<string, EstimationTatami>;
};

const LANCES: ReadonlySet<StatutAEstimer> = new Set(["in_progress", "paused"]);

type File = {
  cle: string;
  combats: CombatAEstimer[];
  position: number;
  finPrecedenteMs: number | null;
  premierNonLanceVu: boolean;
  tete: Evaluation | null;
};

type Evaluation = {
  debutMs: number;
  debutDeFileMs: number;
  finMs: number;
  plancherApplique: boolean;
  attendRepos: boolean;
  finDeReposMs: number | null;
  bloque: boolean;
};

const SLOTS: readonly Slot[] = ["A", "B"];

function comparerChaines(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function estimerLesHoraires(
  entree: EntreeEstimation,
  options: OptionsEstimation = { enchainement: "decalage" },
): ResultatEstimation {
  const maintenant = entree.maintenantMs;
  const espacementMs = Math.max(0, entree.espacementSecondes) * 1000;
  const tatamis = new Map(entree.tatamis.map((t) => [t.id, t]));

  const retenus = entree.combats.filter((c) => {
    const t = tatamis.get(c.tatamiId);
    if (!t) return false;
    return !(t.soeur && options.enchainement === "aucun");
  });

  const lances = new Set<string>();
  for (const c of retenus) {
    if (LANCES.has(c.statut)) lances.add(`${c.tatamiId}|${c.jour}`);
  }

  const parCategorie = new Map<string, CombatAEstimer[]>();
  for (const c of retenus) {
    const liste = parCategorie.get(c.categoryId);
    if (liste) liste.push(c);
    else parCategorie.set(c.categoryId, [c]);
  }
  const sources = new Map<string, readonly [string | null, string | null]>();
  for (const liste of parCategorie.values()) {
    const proxies = liste.map((c) => versPropagation(c));
    for (const c of liste) {
      const s = SLOTS.map((slot, i) =>
        c.athletes[i] === null
          ? (findFeederFight(proxies, versPropagation(c), slot)?.id ?? null)
          : null,
      );
      if (s[0] !== null || s[1] !== null) sources.set(c.id, [s[0] ?? null, s[1] ?? null]);
    }
  }

  const files = new Map<string, File>();
  for (const c of retenus) {
    const t = tatamis.get(c.tatamiId)!;
    const cle = `${t.physique ?? t.id}|${c.jour}`;
    const f = files.get(cle);
    if (f) f.combats.push(c);
    else
      files.set(cle, {
        cle,
        combats: [c],
        position: 0,
        finPrecedenteMs: null,
        premierNonLanceVu: false,
        tete: null,
      });
  }
  for (const f of files.values()) {
    f.combats.sort((a, b) => {
      const la = LANCES.has(a.statut) ? 0 : 1;
      const lb = LANCES.has(b.statut) ? 0 : 1;
      if (la !== lb) return la - lb;
      if (la === 0) {
        const da = a.startedAtMs ?? 0;
        const db = b.startedAtMs ?? 0;
        if (da !== db) return da - db;
      }
      const ea = tatamis.get(a.tatamiId)!.enchainement ?? 0;
      const eb = tatamis.get(b.tatamiId)!.enchainement ?? 0;
      if (ea !== eb) return ea - eb;
      if (a.rang !== b.rang) return a.rang - b.rang;
      return comparerChaines(a.id, b.id);
    });
  }
  const ordreDesFiles = [...files.values()].sort((a, b) => comparerChaines(a.cle, b.cle));

  const fileDuCombat = new Map<string, File>();
  for (const f of ordreDesFiles) for (const c of f.combats) fileDuCombat.set(c.id, f);
  const combatsParAthlete = new Map<string, string[]>();
  const dependants = new Map<string, string[]>();
  const indexer = (index: Map<string, string[]>, cle: string, id: string) => {
    const liste = index.get(cle);
    if (liste) liste.push(id);
    else index.set(cle, [id]);
  };
  for (const c of retenus) {
    for (const athlete of c.athletes)
      if (athlete !== null) indexer(combatsParAthlete, athlete, c.id);
    for (const source of sources.get(c.id) ?? [])
      if (source !== null) indexer(dependants, source, c.id);
  }
  const perimer = (ids: readonly string[] | undefined) => {
    for (const id of ids ?? []) {
      const f = fileDuCombat.get(id);
      if (f !== undefined && f.combats[f.position]?.id === id) f.tete = null;
    }
  };

  const ancres = new Map<string, number>();

  const finParAthlete = new Map<string, number>();
  for (const [athlete, fin] of Object.entries(entree.reposParAthlete)) {
    if (Number.isFinite(fin)) finParAthlete.set(athlete, fin);
  }

  const places = new Map<string, EstimationCombat>();

  const ancrage = (c: CombatAEstimer): number => {
    const cle = `${c.tatamiId}|${c.jour}`;
    const connue = ancres.get(cle);
    if (connue !== undefined) return connue;
    const t = tatamis.get(c.tatamiId)!;
    const courante = c.jour === entree.journee.index;
    const lance = lances.has(cle) || (courante && t.lanceAujourdhui === true);
    let valeur: number;
    if (lance) {
      const derniere = courante ? (t.derniereFinMs ?? null) : null;
      valeur = derniere === null ? maintenant : Math.max(maintenant, derniere + espacementMs);
    } else {
      const prevu = t.debutPrevuMs[c.jour];
      valeur = prevu === null || prevu === undefined ? maintenant : Math.max(maintenant, prevu);
    }
    ancres.set(cle, valeur);
    return valeur;
  };

  const evaluer = (f: File, c: CombatAEstimer, ignorerSources: boolean): Evaluation => {
    const dureeMs = Math.max(0, c.dureeSecondes) * 1000;
    if (LANCES.has(c.statut)) {
      const debut = c.startedAtMs ?? maintenant;
      const pauseEnCours =
        c.statut === "paused" && c.pausedAtMs !== null ? Math.max(0, maintenant - c.pausedAtMs) : 0;
      const fin = Math.max(maintenant, debut + dureeMs + Math.max(0, c.pausedMs) + pauseEnCours);
      return {
        debutMs: debut,
        debutDeFileMs: debut,
        finMs: fin,
        plancherApplique: false,
        attendRepos: false,
        finDeReposMs: null,
        bloque: false,
      };
    }

    let base = ancrage(c);
    if (f.finPrecedenteMs !== null) base = Math.max(base, f.finPrecedenteMs + espacementMs);

    const reposMs = multiplicateurDeRepos({ division: c.division, type: c.type }) * dureeMs;
    let repos: number | null = null;
    let bloque = false;
    const sourcesDuCombat = sources.get(c.id);
    for (let i = 0; i < 2; i += 1) {
      const athlete = c.athletes[i as 0 | 1];
      let fin: number | null = null;
      if (athlete !== null) {
        const derniere = finParAthlete.get(athlete);
        if (derniere !== undefined) fin = derniere + reposMs;
      } else {
        const source = sourcesDuCombat?.[i as 0 | 1] ?? null;
        const estimee = source === null ? undefined : places.get(source);
        if (estimee) fin = estimee.finMs + reposMs;
        else if (source !== null && !ignorerSources) bloque = true;
      }
      if (fin !== null) repos = repos === null ? fin : Math.max(repos, fin);
    }

    const plancher = c.plancherMs;
    const sansRepos = plancher === null ? base : Math.max(base, plancher);
    const debut = repos === null ? sansRepos : Math.max(sansRepos, repos);
    return {
      debutMs: debut,
      debutDeFileMs: sansRepos,
      finMs: debut + dureeMs,
      plancherApplique: plancher !== null && plancher > Math.max(base, repos ?? base),
      attendRepos: repos !== null && repos > sansRepos,
      finDeReposMs: repos,
      bloque,
    };
  };

  const placer = (f: File, c: CombatAEstimer, e: Evaluation, dependanceIgnoree: boolean) => {
    const lance = LANCES.has(c.statut);
    let aPresent = false;
    if (!lance && !f.premierNonLanceVu) {
      f.premierNonLanceVu = true;
      aPresent =
        entree.journee.commencee && c.jour === entree.journee.index && e.debutMs <= maintenant;
    }
    places.set(c.id, {
      fightId: c.id,
      etat: lance ? "en_cours" : "a_venir",
      debutMs: e.debutMs,
      debutDeFileMs: e.debutDeFileMs,
      finMs: e.finMs,
      aPresent,
      plancherApplique: e.plancherApplique,
      attendRepos: e.attendRepos,
      finDeReposMs: e.finDeReposMs,
      dependanceIgnoree,
    });
    f.finPrecedenteMs = e.finMs;
    f.position += 1;
    f.tete = null;
    for (const athlete of c.athletes) {
      if (athlete === null) continue;
      const avant = finParAthlete.get(athlete);
      finParAthlete.set(athlete, avant === undefined ? e.finMs : Math.max(avant, e.finMs));
      perimer(combatsParAthlete.get(athlete));
    }
    perimer(dependants.get(c.id));
  };

  const meilleur = (
    a: { f: File; c: CombatAEstimer; e: Evaluation } | null,
    b: { f: File; c: CombatAEstimer; e: Evaluation },
  ) => {
    if (a === null) return b;
    if (b.e.debutMs !== a.e.debutMs) return b.e.debutMs < a.e.debutMs ? b : a;
    const parFile = comparerChaines(b.f.cle, a.f.cle);
    if (parFile !== 0) return parFile < 0 ? b : a;
    return comparerChaines(b.c.id, a.c.id) < 0 ? b : a;
  };

  for (;;) {
    let pret: { f: File; c: CombatAEstimer; e: Evaluation } | null = null;
    let enAttente: { f: File; c: CombatAEstimer; e: Evaluation } | null = null;
    for (const f of ordreDesFiles) {
      const c = f.combats[f.position];
      if (c === undefined) continue;
      if (f.tete === null) f.tete = evaluer(f, c, false);
      const e = f.tete;
      if (!e.bloque) pret = meilleur(pret, { f, c, e });
    }
    if (pret === null) {
      for (const f of ordreDesFiles) {
        const c = f.combats[f.position];
        if (c === undefined) continue;
        enAttente = meilleur(enAttente, { f, c, e: evaluer(f, c, true) });
      }
    }
    if (pret !== null) {
      placer(pret.f, pret.c, pret.e, false);
      continue;
    }
    if (enAttente !== null) {
      placer(enAttente.f, enAttente.c, enAttente.e, true);
      continue;
    }
    break;
  }

  const resultatTatamis = new Map<string, EstimationTatami>();
  for (const t of entree.tatamis) {
    resultatTatamis.set(t.id, { tatamiId: t.id, finEstimeeMs: null, restants: 0 });
  }
  for (const c of retenus) {
    if (c.jour !== entree.journee.index) continue;
    const e = places.get(c.id);
    const t = resultatTatamis.get(c.tatamiId);
    if (!e || !t) continue;
    t.restants += 1;
    t.finEstimeeMs = t.finEstimeeMs === null ? e.finMs : Math.max(t.finEstimeeMs, e.finMs);
  }

  return { combats: places, tatamis: resultatTatamis };
}

function versPropagation(c: CombatAEstimer): PropagationFight {
  return {
    id: c.id,
    division: c.division,
    indexInDivision: c.index,
    type: c.type,
    slotA: c.athletes[0],
    slotB: c.athletes[1],
    isBye: false,
    state: "scheduled",
    winner: null,
    winMethod: null,
    needsArbitration: false,
    version: 0,
  };
}

export function ecartDeRythmeMinutes(
  finEstimeeMs: number,
  finPrevueMs: number,
  effetSecondes: number,
): number {
  return arrondiALaMinute((finEstimeeMs - (finPrevueMs + effetSecondes * 1000)) / 60_000);
}

function arrondiALaMinute(minutes: number): number {
  const arrondi = Math.sign(minutes) * Math.round(Math.abs(minutes));
  return arrondi === 0 ? 0 : arrondi;
}

export type CouleurDEcart = "bleu" | "vert" | "orange" | "rouge";

export function couleurDEcart(minutes: number): CouleurDEcart {
  const m = arrondiALaMinute(minutes);
  if (m <= -10) return "bleu";
  if (m <= 9) return "vert";
  if (m <= 30) return "orange";
  return "rouge";
}

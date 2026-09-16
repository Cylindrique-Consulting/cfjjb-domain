import { findFeederFight, type PropagationFight, type Slot } from "./bracket-propagation";
import { multiplicateurDeRepos } from "./fight-rest";

/**
 * L'ESTIMATEUR UNIQUE DES HEURES DE PASSAGE (TB1, TB2, TB4, T9.1, T9.3, T12.1,
 * T12.5, T12.6).
 *
 * Une seule règle sert tous les écrans qui affichent une heure : tableau de
 * bord, check-in, prochains combats, ordre des combats, planning, tableaux et
 * vue publique, ainsi que le refus d'un déplacement qui placerait un combat
 * avant sa source. Deux calculs écrits chacun de leur côté finiraient par dire
 * deux heures différentes pour le même combat.
 *
 * Ce que l'estimation prend en compte :
 *
 *   · la FILE RÉELLE de chaque tatami (ordre de passage courant), les combats
 *     soldés (terminés, forfaits, annulés) en étant absents ;
 *   · la durée réglementaire de chaque combat PLUS l'espacement entre deux
 *     combats consécutifs d'un tatami ;
 *   · le REPOS des athlètes : un combat n'est pas estimé avant la fin du repos
 *     de ses athlètes, une durée de combat avant un tour ordinaire, deux avant
 *     une finale (`multiplicateurDeRepos`), à compter de la fin réelle ou
 *     estimée de leur combat précédent, sur n'importe quel tatami. Un combat
 *     dont un adversaire est inconnu hérite de la fin estimée de son combat
 *     source (`findFeederFight`), supposé disputé ;
 *   · l'ANCRAGE : tant qu'aucun combat du tatami n'est lancé ce jour-là, la
 *     file part de max(maintenant, début prévu du tatami). Un démarrage tardif
 *     se lit donc comme du retard, et une salle regardée à 08:00 n'annonce pas
 *     une heure d'avance sur un planning de 09:00 ;
 *   · le PLANCHER : l'heure estimée d'un combat ne descend jamais sous l'heure
 *     prévue de sa catégorie moins 90 minutes. Il est appliqué dans la
 *     simulation (les combats suivants du tatami en découlent) et ne sert qu'à
 *     l'affichage : il n'empêche aucun lancement ;
 *   · « À PRÉSENT » : le prochain combat à lancer d'un tatami, quand la journée
 *     est commencée et que son heure estimée est déjà atteinte ;
 *   · l'ENCHAÎNEMENT de compétitions qui se suivent sur les mêmes tatamis
 *     physiques : les combats non soldés de la compétition précédente passent
 *     devant, et leurs athlètes communs portent leur repos.
 *
 * Ce que l'estimation ne fait jamais : réordonner une file. Si le prochain
 * combat attend la fin d'un repos, le tatami attend.
 *
 * MODULE PUR : l'instant courant est un PARAMÈTRE. Mêmes entrées, même sortie.
 */

/** Le plancher d'affichage : heure prévue de la catégorie moins 90 minutes. */
export const PLANCHER_AFFICHAGE_MS = 90 * 60_000;

/** Les statuts d'un combat NON SOLDÉ. Un combat soldé n'entre pas dans le calcul. */
export type StatutAEstimer = "pending" | "called" | "ready" | "in_progress" | "paused";

/** Le type structurel d'un combat, celui de `PropagationFight`. */
export type TypeDeCombatAEstimer = PropagationFight["type"];

export type CombatAEstimer = {
  id: string;
  /** Le tatami du combat (identifiant de `TatamiAEstimer`). */
  tatamiId: string;
  /** Le rang de passage dans la file de son tatami : un entier, ordre total avec `id`. */
  rang: number;
  /** La journée du combat : 0 pour le jour 1, 1 pour le jour 2. */
  jour: 0 | 1;
  statut: StatutAEstimer;
  /** L'instant réel de lancement, pour un combat en cours ou en pause. */
  startedAtMs: number | null;
  /** L'instant de la mise en pause en cours, `null` sinon. */
  pausedAtMs: number | null;
  /** Le temps de pause déjà cumulé, en millisecondes. */
  pausedMs: number;
  /** La durée réglementaire du combat, en secondes. */
  dureeSecondes: number;
  categoryId: string;
  division: number;
  index: number;
  type: TypeDeCombatAEstimer;
  /**
   * Les deux athlètes (clés opaques, identiques d'une compétition à l'autre),
   * `null` pour un emplacement encore inconnu.
   */
  athletes: readonly [string | null, string | null];
  /** L'heure prévue de la catégorie moins 90 minutes, ou `null`. */
  plancherMs: number | null;
};

export type TatamiAEstimer = {
  id: string;
  /**
   * La clé du tatami PHYSIQUE. Deux tatamis de même clé partagent une seule
   * file (compétitions qui se suivent). Par défaut, l'identifiant.
   */
  physique?: string;
  /** Tatami d'une compétition précédente sur le même tatami physique. */
  soeur?: boolean;
  /**
   * L'ordre d'enchaînement sur le tatami physique : une valeur plus petite
   * passe devant. Par défaut 0.
   */
  enchainement?: number;
  /** Le début prévu du tatami pour chaque journée, `null` s'il est inconnu. */
  debutPrevuMs: readonly [number | null, number | null];
  /** Un combat de ce tatami a-t-il été lancé pendant la journée courante ? */
  lanceAujourdhui?: boolean;
  /** La fin réelle du dernier combat du tatami pendant la journée courante. */
  derniereFinMs?: number | null;
};

export type EntreeEstimation = {
  maintenantMs: number;
  /** L'espacement effectif entre deux combats d'un tatami, en secondes. */
  espacementSecondes: number;
  /** La journée courante, et « un combat de cette journée a été lancé ». */
  journee: { index: 0 | 1; commencee: boolean };
  tatamis: readonly TatamiAEstimer[];
  combats: readonly CombatAEstimer[];
  /**
   * La fin réelle du dernier combat DISPUTÉ et terminé de chaque athlète, sur
   * toutes les compétitions liées. Le prédicat « disputé » n'est pas refait
   * ici : il appartient à `aDisputeLeCombat` et à sa jumelle en base.
   */
  reposParAthlete: Readonly<Record<string, number>>;
};

export type OptionsEstimation = {
  /**
   * `decalage` : les combats non soldés des tatamis `soeur` passent devant sur
   * le même tatami physique. `aucun` : ils sont ignorés.
   */
  enchainement: "decalage" | "aucun";
};

export type EstimationCombat = {
  fightId: string;
  etat: "a_venir" | "en_cours";
  /** Début estimé (ou réel pour un combat en cours). */
  debutMs: number;
  /**
   * Le début que la seule PLACE dans la file donnerait : espacement, ancrage et
   * plancher, sans attendre le repos des athlètes ni les combats sources. C'est
   * l'heure du créneau ; `debutMs` la repousse quand un athlète n'est pas prêt.
   * Sert à refuser un déplacement qui placerait un combat avant sa source.
   */
  debutDeFileMs: number;
  /** Fin estimée, jamais avant maintenant pour un combat en cours. */
  finMs: number;
  /** Prochain combat à lancer de son tatami, journée commencée, heure atteinte. */
  aPresent: boolean;
  /** Le plancher de 90 minutes a repoussé ce combat. */
  plancherApplique: boolean;
  /** La fin du repos d'un athlète a repoussé ce combat. */
  attendRepos: boolean;
  /** La fin de repos la plus tardive de ses athlètes, `null` s'il n'y en a pas. */
  finDeReposMs: number | null;
  /**
   * Une source rangée après son dépendant ne pouvait pas être estimée avant
   * lui : la contrainte a été ignorée plutôt que de bloquer le calcul.
   */
  dependanceIgnoree: boolean;
};

export type EstimationTatami = {
  tatamiId: string;
  /** La fin estimée de la journée courante, `null` s'il n'y reste rien. */
  finEstimeeMs: number | null;
  /** Le nombre de combats non soldés de la journée courante. */
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

/**
 * LES HEURES ESTIMÉES DE TOUS LES COMBATS NON SOLDÉS, ET LA FIN DE CHAQUE TATAMI.
 *
 * Simulation chronologique sur tous les tatamis à la fois : à chaque pas, la
 * tête de file la plus précoce dont les sources sont estimées est placée. Une
 * source qui ne peut pas l'être avant son dépendant (rangée après lui) est
 * ignorée et signalée, jamais attendue indéfiniment.
 */
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

  // Les tatamis (et journées) où un combat est déjà lancé : l'ancrage change.
  const lances = new Set<string>();
  for (const c of retenus) {
    if (LANCES.has(c.statut)) lances.add(`${c.tatamiId}|${c.jour}`);
  }

  // LES SOURCES STRUCTURELLES, par catégorie, calculées une fois.
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

  // LES FILES : une par tatami physique et par journée.
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

  const finParAthlete = new Map<string, number>();
  for (const [athlete, fin] of Object.entries(entree.reposParAthlete)) {
    if (Number.isFinite(fin)) finParAthlete.set(athlete, fin);
  }

  const places = new Map<string, EstimationCombat>();

  const ancrage = (c: CombatAEstimer): number => {
    const t = tatamis.get(c.tatamiId)!;
    const courante = c.jour === entree.journee.index;
    const lance = lances.has(`${c.tatamiId}|${c.jour}`) || (courante && t.lanceAujourdhui === true);
    if (lance) {
      const derniere = courante ? (t.derniereFinMs ?? null) : null;
      return derniere === null ? maintenant : Math.max(maintenant, derniere + espacementMs);
    }
    const prevu = t.debutPrevuMs[c.jour];
    return prevu === null || prevu === undefined ? maintenant : Math.max(maintenant, prevu);
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
    for (const athlete of c.athletes) {
      if (athlete === null) continue;
      const avant = finParAthlete.get(athlete);
      finParAthlete.set(athlete, avant === undefined ? e.finMs : Math.max(avant, e.finMs));
    }
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
      const e = evaluer(f, c, false);
      if (e.bloque) enAttente = meilleur(enAttente, { f, c, e: evaluer(f, c, true) });
      else pret = meilleur(pret, { f, c, e });
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

/**
 * L'ÉCART DE RYTHME D'UN TATAMI, en minutes entières (TB1.1, TB1.3) :
 * fin estimée − (fin prévue d'origine + effet des ajouts et retraits).
 *
 * Positif : retard. Négatif : avance. L'arrondi est symétrique autour de zéro,
 * pour qu'une avance et un retard de même durée s'affichent avec le même
 * nombre.
 */
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

/**
 * LA COULEUR D'UN ÉCART (TB1.2), à la minute arrondie, identique pour toutes
 * les compétitions : avance de 10 minutes ou plus → bleu ; de −9 à +9 → vert ;
 * retard de +10 à +30 → orange ; au-delà de +30 → rouge.
 */
export function couleurDEcart(minutes: number): CouleurDEcart {
  const m = arrondiALaMinute(minutes);
  if (m <= -10) return "bleu";
  if (m <= 9) return "vert";
  if (m <= 30) return "orange";
  return "rouge";
}

/**
 * LES STATISTIQUES DE COMBAT — ce qui se dérive du journal, et ce qui ne s'en
 * dérive pas.
 *
 * Le journal de scoring (`competition_fight_events`) enregistre des VALEURS :
 * un côté (`a` / `b`), une portée (`points` / `advantages` / `penalties`), un
 * delta, un instant. L'état du combat (`competition_fight_states`) y ajoute une
 * méthode de victoire et, depuis la PR plateforme #766, un type de soumission.
 *
 * Beaucoup de choses s'en déduisent sans rien inventer : bilan
 * victoires/défaites, adversaires rencontrés, victoires par méthode, points
 * marqués et encaissés, avantages, pénalités, face-à-face. Ce module les dérive,
 * et rien d'autre.
 *
 * ┌─ CE QUI NE SE DÉRIVE PAS, ET QUI EST LE CŒUR DE CE MODULE ─────────────────┐
 * │ LA TECHNIQUE DERRIÈRE UN POINT. `+3` est un passage de garde, et c'est sûr. │
 * │ Mais `+2` est un renversement OU une amenée au sol OU un genou-ventre :     │
 * │ trois gestes différents, une seule valeur.                                  │
 * │                                                                             │
 * │ Une statistique intitulée « balayages » construite sur les `+2` est donc    │
 * │ FAUSSE pour une part INCONNUE de ses lignes, et personne ne peut dire        │
 * │ laquelle. C'est le pire type d'erreur que ce projet puisse produire : un    │
 * │ chiffre plausible, affiché avec autorité, qu'aucune relecture ne peut       │
 * │ infirmer sans remonter à chaque combat.                                     │
 * │                                                                             │
 * │ LES SEULS LIBELLÉS AUTORISÉS POUR LES POINTS SONT LES VALEURS : « points », │
 * │ « points à +2 », « avantages », « pénalités ». JAMAIS un nom de geste.      │
 * │ La seule technique enregistrée par ce système est `submissionType`, parce   │
 * │ qu'elle a été OBSERVÉE et saisie, jamais recalculée.                        │
 * │                                                                             │
 * │ `tests/statistiques-honnetes.test.ts` (ici) et son jumeau dans              │
 * │ `cfjjb-platform` verrouillent cette règle par un balayage de source. Le     │
 * │ verrou de la plateforme ne lit QUE `app`, `lib` et `components` : ce        │
 * │ package, consommé depuis `node_modules`, lui est invisible. D'où le jumeau. │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ ET TOUT EST À ZÉRO ───────────────────────────────────────────────────────┐
 * │ La bascule vers le nouvel outil est NETTE : aucune reprise de l'historique. │
 * │ Toute statistique de combat vaut donc zéro jusqu'à la première compétition  │
 * │ jouée sur le nouvel outil, pour les 90 000 licenciés.                       │
 * │                                                                             │
 * │ Un objet de compteurs à zéro se lit comme un FAIT MESURÉ : « ce combattant  │
 * │ n'a jamais soumis personne » est une phrase sur quelqu'un qui a combattu.   │
 * │ Elle serait fausse pour tout le monde le jour de la bascule. L'état vide    │
 * │ est donc de PREMIÈRE CLASSE et se lit avant tout le reste :                 │
 * │ `{ aDesCombats: false }` n'a AUCUN compteur à afficher par erreur.          │
 * │                                                                             │
 * │ Même raisonnement que `computeFillRate`, qui rend `null` et non `0` quand   │
 * │ la capacité est nulle.                                                      │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * VOCABULAIRE. Les ENTRÉES parlent la langue de la base (`winMethod`, `side`,
 * `scope`, `submissionType`) parce qu'elles sont recopiées de ses colonnes ; les
 * SORTIES parlent français, parce qu'elles sont affichées et que c'est là que le
 * nom donné à un chiffre engage. Même partage que `db-vocabulary.ts`.
 *
 * IDENTITÉ. Ce module ne connaît que les identifiants qu'on lui donne. Sur une
 * compétition, ce sont des `competition_registrations.id` ; pour un palmarès
 * PLURIANNUEL, l'appelant doit avoir résolu le licencié AVANT d'appeler — sinon
 * chaque saison produit un combattant différent, et le bilan de dix ans est
 * celui d'un jour.
 *
 * Module pur : aucune IO, aucune dépendance.
 */

import type { FightState, WinMethod } from "./bracket-propagation";

// ===================================================================
// LE VOCABULAIRE DU JOURNAL
// ===================================================================

/** Les deux côtés d'un combat, tels que `competition_fight_events.side` les nomme. */
export type FightSide = "a" | "b";

/** `competition_fight_events.scope` : la portée d'un delta. */
export type ScoreScope = "points" | "advantages" | "penalties";

/**
 * LES 17 VALEURS DE `competition_fight_states.submission_type`.
 *
 * Bornées, et c'est le point : une saisie libre compterait « armbar », « clé de
 * bras » et « juji gatame » comme TROIS techniques dans un classement.
 *
 * `other` n'est pas « inconnu » : c'est une soumission OBSERVÉE dont le type
 * n'est pas dans cette liste, accompagnée d'une note libre. Une soumission dont
 * le type n'a pas été relevé vaut `null` et se compte à part (`typeNonReleve`) —
 * les ranger dans `other` gonflerait une catégorie réelle avec de l'absence de
 * saisie.
 *
 * Source : migration `20261019000002_type_de_soumission.sql` (`cfjjb-platform`).
 */
export const SUBMISSION_TYPES = [
  "armbar",
  "triangle",
  "rear_naked_choke",
  "guillotine",
  "kimura",
  "americana",
  "omoplata",
  "bow_and_arrow",
  "cross_collar",
  "ezekiel",
  "arm_triangle",
  "north_south",
  "footlock",
  "kneebar",
  "toe_hold",
  "heel_hook",
  "other",
] as const;

export type SubmissionType = (typeof SUBMISSION_TYPES)[number];

/** Une valeur lue en base est-elle un type de soumission connu ? */
export function isSubmissionType(value: string | null | undefined): value is SubmissionType {
  return value != null && (SUBMISSION_TYPES as readonly string[]).includes(value);
}

/**
 * Un événement du journal, réduit aux seuls champs qui portent une VALEUR.
 *
 * `kind` n'y figure pas, et son absence est délibérée : voir `foldScores`.
 */
export type ScoreEvent = {
  readonly fightId: string;
  readonly side: FightSide | null;
  readonly scope: ScoreScope | null;
  readonly delta: number | null;
};

/** Les six compteurs d'un combat, tels que la table de marque les affiche. */
export type FightScores = {
  readonly pointsA: number;
  readonly pointsB: number;
  readonly advantagesA: number;
  readonly advantagesB: number;
  readonly penaltiesA: number;
  readonly penaltiesB: number;
};

const SCORES_VIDES: FightScores = {
  pointsA: 0,
  pointsB: 0,
  advantagesA: 0,
  advantagesB: 0,
  penaltiesA: 0,
  penaltiesB: 0,
};

/**
 * LE PLIAGE DU JOURNAL — jumeau exact de `jour_j_fold_scores` (Postgres).
 *
 * Le score affiché EST la somme des deltas. Deux points valent d'être connus :
 *
 * ⚠ ON NE FILTRE PAS SUR `kind`, ET C'EST LA SEULE FAÇON JUSTE. `undo` et
 * `score_correction` portent un delta NÉGATIF de même `(side, scope)` : les
 * écarter en ne gardant que `score` / `advantage` / `penalty` ferait recompter
 * chaque point annulé. Le pliage est une somme, donc il ne peut pas dériver.
 *
 * ⚠ UNE ENTRÉE EST CRÉÉE POUR TOUT COMBAT VU DANS LE JOURNAL, même si aucun de
 * ses événements ne porte de delta (un combat terminé par soumission à la
 * première seconde n'a que `start` et `finish`). C'est ce qui permet à
 * l'appelant de distinguer « journal fourni, score nul » de « journal absent »
 * par un simple `.get(fightId) ?? null` — la seconde situation est celle d'une
 * reprise papier, et ses points ne sont dans aucun total.
 *
 * On ne borne PAS à zéro : un total négatif ne peut venir que d'un journal
 * corrompu, et l'écraser en `0` le rendrait invisible. La contrainte
 * `points_a >= 0` de la base est le bon endroit pour refuser, pas ici.
 */
export function foldScores(events: readonly ScoreEvent[]): Map<string, FightScores> {
  const parCombat = new Map<string, FightScores>();
  for (const e of events) {
    const courant = parCombat.get(e.fightId) ?? SCORES_VIDES;
    if (e.side == null || e.scope == null || e.delta == null || !Number.isFinite(e.delta)) {
      // Un événement sans valeur (start, pause, finish, note) ne change aucun
      // compteur mais PROUVE que le journal de ce combat existe.
      parCombat.set(e.fightId, courant);
      continue;
    }
    parCombat.set(e.fightId, ajouteDelta(courant, e.side, e.scope, e.delta));
  }
  return parCombat;
}

/** Un delta, ajouté au bon compteur. Six cases écrites, aucune clé calculée. */
function ajouteDelta(
  s: FightScores,
  side: FightSide,
  scope: ScoreScope,
  delta: number,
): FightScores {
  const estA = side === "a";
  switch (scope) {
    case "points":
      return estA ? { ...s, pointsA: s.pointsA + delta } : { ...s, pointsB: s.pointsB + delta };
    case "advantages":
      return estA
        ? { ...s, advantagesA: s.advantagesA + delta }
        : { ...s, advantagesB: s.advantagesB + delta };
    case "penalties":
      return estA
        ? { ...s, penaltiesA: s.penaltiesA + delta }
        : { ...s, penaltiesB: s.penaltiesB + delta };
  }
}

// ===================================================================
// LE COMBAT, TEL QU'UNE STATISTIQUE LE VOIT
// ===================================================================

/**
 * Un combat enregistré, recopié de `competition_fights` et de son état.
 *
 * `state` est la vue de PROPAGATION du statut (`jour_j_propagation_state` côté
 * serveur) : seul `finished` entre dans une statistique. Il est obligatoire, et
 * non défaillant à `finished` : un défaut ferait entrer en silence les combats
 * en cours d'un tapis voisin dans le bilan d'un combattant.
 */
export type FightRecord = {
  readonly fightId: string;
  readonly state: FightState;
  readonly registrationA: string | null;
  readonly registrationB: string | null;
  /** L'identifiant du vainqueur, pas son côté : c'est lui qui se compare. */
  readonly winner: string | null;
  readonly winMethod: WinMethod | null;
  /**
   * La soumission RÉELLEMENT portée. `null` = non relevée, jamais « other ».
   * La base garantit qu'elle n'existe que sur `winMethod = 'submission'`.
   */
  readonly submissionType?: SubmissionType | null;
  /**
   * Les six compteurs pliés depuis le journal, ou `null` si le journal de ce
   * combat n'a pas été fourni (reprise papier, lecture partielle).
   */
  readonly scores?: FightScores | null;
  /**
   * L'instant de la FIN, au chrono du combat, en millisecondes.
   *
   * ⚠ IL N'EST PAS DANS LE JOURNAL, et c'est mesuré : `day_fight_finish` insère
   * son événement `finish` SANS `fight_clock_ms`. Le prendre sur le dernier
   * événement scoré donnerait l'instant du dernier point, pas celui de la
   * soumission — et zéro pour toute soumission portée sans qu'aucun point n'ait
   * été marqué, c'est-à-dire le cas le plus courant.
   *
   * L'appelant le fournit donc explicitement, ou pas du tout. La source
   * raisonnable est `finished_at - started_at - paused_ms`, avec sa limite :
   * elle diverge du chrono officiel dès qu'un `clock_adjust` est passé.
   *
   * Absent ou `null` : le temps est NON MESURÉ, et se compte comme tel. Jamais
   * comme zéro.
   */
  readonly finishClockMs?: number | null;
};

/**
 * LA MÉTHODE, RANGÉE. Six cases, et le rangement n'est pas cosmétique.
 *
 * `wo` (l'adversaire ne s'est pas présenté) et `abandon` (il a arrêté sur le
 * tapis) restent DEUX cases : les fondre sous « forfait » ferait disparaître la
 * différence entre un combat gagné sans combattre et un combat interrompu.
 *
 * `bye` n'y figure pas : personne n'est monté sur le tapis, ce n'est pas un
 * combat. `double_wo` non plus : il n'a pas de vainqueur.
 */
export type MethodeVictoire =
  "points" | "soumission" | "decision" | "abandon" | "disqualification" | "forfait";

export const METHODES_VICTOIRE = [
  "points",
  "soumission",
  "decision",
  "abandon",
  "disqualification",
  "forfait",
] as const satisfies readonly MethodeVictoire[];

/**
 * `WinMethod` (base) → `MethodeVictoire` (affichage), ou `null` pour ce qui
 * n'est pas une victoire attribuable.
 *
 * La méthode est celle du COMBAT : elle se range au crédit du vainqueur ET au
 * débit du perdant. Une défaite « par disqualification » est celle du disqualifié.
 */
export function methodeVictoireDe(win: WinMethod | null | undefined): MethodeVictoire | null {
  switch (win) {
    case "points":
      return "points";
    case "submission":
      return "soumission";
    case "decision":
      return "decision";
    case "abandon":
      return "abandon";
    case "dq":
      return "disqualification";
    case "wo":
      return "forfait";
    // `double_wo` et `bye` n'ont pas de case, par construction : le premier n'a
    // pas de vainqueur, le second pas de combat.
    default:
      return null;
  }
}

/** Ce qu'un combattant a fait FACE À un adversaire donné. Table de consultation. */
export type BilanContre = {
  readonly combats: number;
  readonly victoires: number;
  readonly defaites: number;
};

/** Le compte des soumissions PORTÉES, et l'honnêteté de ses trous. */
export type SoumissionsStat = {
  /** Victoires par soumission. */
  readonly total: number;
  /**
   * Par type OBSERVÉ. Une table de consultation, pas un classement : elle ne
   * porte aucun ordre, et l'ordonner par identifiant n'aurait aucun sens.
   */
  readonly parType: ReadonlyMap<SubmissionType, number>;
  /** Soumissions dont le type n'a pas été saisi. JAMAIS rangées dans `other`. */
  readonly typeNonReleve: number;
  /** Soumissions dont l'instant de fin a été fourni. */
  readonly tempsMesures: number;
  /** Soumissions dont l'instant de fin est inconnu. Jamais comptées comme 0 ms. */
  readonly tempsNonMesures: number;
  /** `null` tant qu'aucun temps n'a été mesuré : « on ne sait pas » n'est pas « 0 ». */
  readonly plusRapideMs: number | null;
  readonly medianeMs: number | null;
};

/**
 * LE BILAN D'UN COMBATTANT, ou l'aveu qu'il n'a pas encore combattu.
 *
 * L'union est le contrat : `aDesCombats: false` ne porte AUCUN compteur, donc
 * aucun écran ne peut afficher « 0 soumission » à quelqu'un qui n'a jamais
 * combattu. C'est la forme, et non un commentaire, qui l'empêche.
 */
export type StatistiquesCombattant =
  | { readonly aDesCombats: false }
  | {
      readonly aDesCombats: true;
      /** Combats TERMINÉS où il figure. Les byes n'en sont pas. */
      readonly combats: number;
      readonly victoires: number;
      readonly defaites: number;
      /** Combats terminés sans vainqueur (`double_wo`). Ils ne créditent personne. */
      readonly sansVainqueur: number;
      readonly victoiresParMethode: Readonly<Record<MethodeVictoire, number>>;
      readonly defaitesParMethode: Readonly<Record<MethodeVictoire, number>>;
      /**
       * Victoires (ou défaites) dont la méthode n'a pas été relevée. La base
       * l'interdit sur un combat terminé ; un état construit hors ligne, lui,
       * peut être incomplet, et ce compteur est ce qui l'empêche de disparaître
       * dans une case arbitraire.
       */
      readonly victoiresSansMethode: number;
      readonly defaitesSansMethode: number;
      readonly adversairesDistincts: number;
      /** Table de consultation par adversaire. Sans ordre : ne pas trier par identifiant. */
      readonly adversaires: ReadonlyMap<string, BilanContre>;
      readonly pointsMarques: number;
      readonly pointsEncaisses: number;
      readonly avantagesMarques: number;
      readonly avantagesEncaisses: number;
      /** Pénalités reçues PAR lui : le côté d'une pénalité est celui qui la subit. */
      readonly penalitesRecues: number;
      readonly penalitesAdverses: number;
      /**
       * Combats retenus dont le journal n'a pas été fourni. Leurs points ne sont
       * dans aucun des totaux ci-dessus : un total muet sur ses trous invite à
       * lire « il n'a rien marqué » là où il faut lire « on n'a pas regardé ».
       */
      readonly combatsSansJournal: number;
      readonly soumissions: SoumissionsStat;
    };

// ===================================================================
// LA DÉRIVATION
// ===================================================================

const compteursVides = (): Record<MethodeVictoire, number> => ({
  points: 0,
  soumission: 0,
  decision: 0,
  abandon: 0,
  disqualification: 0,
  forfait: 0,
});

/** Le côté d'un combattant dans un combat, ou `null` s'il n'y figure pas. */
function coteDe(f: FightRecord, combattantId: string): FightSide | null {
  if (f.registrationA === combattantId) return "a";
  if (f.registrationB === combattantId) return "b";
  return null;
}

/**
 * Les combats qui ENTRENT dans une statistique, dédoublonnés.
 *
 * ⚠ LE DÉDOUBLONNAGE N'EST PAS DE LA PRUDENCE, IL EST LA RÈGLE. La façon
 * naturelle de lire les combats d'un athlète est DEUX requêtes
 * (`registration_a = X`, puis `registration_b = X`) parce qu'aucun index ne
 * couvre les deux colonnes à la fois ; leur union se fait côté appelant, par
 * concaténation, et une concaténation ne dédoublonne rien. Un seul combat
 * compté deux fois double le bilan de quelqu'un.
 *
 * Un `bye` est écarté ici : c'est un placement, pas un combat. Un combattant qui
 * n'a que des byes n'a donc AUCUN combat, et le bilan le dit.
 */
function combatsRetenus(fights: readonly FightRecord[]): FightRecord[] {
  const vus = new Map<string, FightRecord>();
  for (const f of fights) {
    if (f.state !== "finished") continue;
    if (f.winMethod === "bye") continue;
    if (!vus.has(f.fightId)) vus.set(f.fightId, f);
  }
  return [...vus.values()];
}

/**
 * LE BILAN D'UN COMBATTANT.
 *
 * `fights` peut contenir n'importe quoi : les combats d'une compétition entière,
 * ceux d'un autre athlète, des doublons. Seuls les combats terminés où
 * `combattantId` figure sont retenus.
 */
export function statistiquesCombattant(
  combattantId: string,
  fights: readonly FightRecord[],
): StatistiquesCombattant {
  const retenus = combatsRetenus(fights).filter((f) => coteDe(f, combattantId) !== null);

  // L'ÉTAT VIDE, LU EN PREMIER. Aucun compteur n'est construit : il n'y a rien à
  // afficher, et surtout rien qui puisse se lire comme une mesure.
  if (retenus.length === 0) return { aDesCombats: false };

  const victoiresParMethode = compteursVides();
  const defaitesParMethode = compteursVides();
  const adversaires = new Map<string, BilanContre>();
  const parType = new Map<SubmissionType, number>();
  const tempsSoumission: number[] = [];

  let victoires = 0;
  let defaites = 0;
  let sansVainqueur = 0;
  let victoiresSansMethode = 0;
  let defaitesSansMethode = 0;
  let pointsMarques = 0;
  let pointsEncaisses = 0;
  let avantagesMarques = 0;
  let avantagesEncaisses = 0;
  let penalitesRecues = 0;
  let penalitesAdverses = 0;
  let combatsSansJournal = 0;
  let soumissionsPortees = 0;
  let typeNonReleve = 0;
  let tempsNonMesures = 0;

  for (const f of retenus) {
    const cote = coteDe(f, combattantId);
    if (cote === null) continue;
    const adverse = cote === "a" ? f.registrationB : f.registrationA;
    const gagne = f.winner != null && f.winner === combattantId;
    const perdu = f.winner != null && f.winner !== combattantId;
    const methode = methodeVictoireDe(f.winMethod);

    if (gagne) {
      victoires++;
      if (methode) victoiresParMethode[methode]++;
      else victoiresSansMethode++;
    } else if (perdu) {
      defaites++;
      if (methode) defaitesParMethode[methode]++;
      else defaitesSansMethode++;
    } else {
      // Ni vainqueur ni perdant : le combat s'est joué sans vainqueur
      // (`double_wo`). Il compte comme disputé — même règle que `noContest`
      // dans `pool-ranking` — et ne crédite personne.
      sansVainqueur++;
    }

    if (adverse != null) {
      const bilan = adversaires.get(adverse) ?? { combats: 0, victoires: 0, defaites: 0 };
      adversaires.set(adverse, {
        combats: bilan.combats + 1,
        victoires: bilan.victoires + (gagne ? 1 : 0),
        defaites: bilan.defaites + (perdu ? 1 : 0),
      });
    }

    const s = f.scores;
    if (s == null) {
      combatsSansJournal++;
    } else if (cote === "a") {
      pointsMarques += s.pointsA;
      pointsEncaisses += s.pointsB;
      avantagesMarques += s.advantagesA;
      avantagesEncaisses += s.advantagesB;
      penalitesRecues += s.penaltiesA;
      penalitesAdverses += s.penaltiesB;
    } else {
      pointsMarques += s.pointsB;
      pointsEncaisses += s.pointsA;
      avantagesMarques += s.advantagesB;
      avantagesEncaisses += s.advantagesA;
      penalitesRecues += s.penaltiesB;
      penalitesAdverses += s.penaltiesA;
    }

    // LE TEMPS NE SE COMPTE QUE SUR LES SOUMISSIONS QU'IL A PORTÉES. Une
    // soumission SUBIE est un combat du même journal, avec le même chrono, et
    // rien ne la distingue d'une soumission portée sauf le vainqueur.
    if (gagne && f.winMethod === "submission") {
      soumissionsPortees++;
      if (isSubmissionType(f.submissionType)) {
        parType.set(f.submissionType, (parType.get(f.submissionType) ?? 0) + 1);
      } else {
        typeNonReleve++;
      }
      const ms = f.finishClockMs;
      if (ms != null && Number.isFinite(ms) && ms >= 0) tempsSoumission.push(ms);
      else tempsNonMesures++;
    }
  }

  return {
    aDesCombats: true,
    combats: retenus.length,
    victoires,
    defaites,
    sansVainqueur,
    victoiresParMethode,
    defaitesParMethode,
    victoiresSansMethode,
    defaitesSansMethode,
    adversairesDistincts: adversaires.size,
    adversaires,
    pointsMarques,
    pointsEncaisses,
    avantagesMarques,
    avantagesEncaisses,
    penalitesRecues,
    penalitesAdverses,
    combatsSansJournal,
    soumissions: {
      total: soumissionsPortees,
      parType,
      typeNonReleve,
      tempsMesures: tempsSoumission.length,
      tempsNonMesures,
      plusRapideMs: minimum(tempsSoumission),
      medianeMs: mediane(tempsSoumission),
    },
  };
}

function minimum(valeurs: readonly number[]): number | null {
  if (valeurs.length === 0) return null;
  return valeurs.reduce((min, v) => (v < min ? v : min), valeurs[0] as number);
}

/**
 * La médiane, ou `null` sur un échantillon VIDE.
 *
 * Le tri porte sur des DURÉES, jamais sur des identifiants : trier des UUID n'a
 * aucun sens et la clé structurelle de ce dépôt est
 * `(division, indexInDivision, type)`.
 */
function mediane(valeurs: readonly number[]): number | null {
  if (valeurs.length === 0) return null;
  const tries = [...valeurs].sort((x, y) => x - y);
  const milieu = Math.floor(tries.length / 2);
  if (tries.length % 2 === 1) return tries[milieu] as number;
  return ((tries[milieu - 1] as number) + (tries[milieu] as number)) / 2;
}

// ===================================================================
// LE FACE-À-FACE
// ===================================================================

/** Une rencontre, telle qu'elle s'affiche dans un historique. */
export type Rencontre = {
  readonly fightId: string;
  readonly vainqueur: string | null;
  readonly winMethod: WinMethod | null;
  readonly submissionType: SubmissionType | null;
};

/**
 * L'historique entre DEUX combattants, ou l'aveu qu'ils ne se sont jamais
 * rencontrés.
 *
 * Même contrat que le bilan : « ils ne se sont jamais rencontrés » et « 0 à 0 »
 * sont deux phrases différentes, et une seule est vraie le jour de la bascule.
 */
export type FaceAFace =
  | { readonly seSontRencontres: false }
  | {
      readonly seSontRencontres: true;
      readonly combats: number;
      readonly victoiresA: number;
      readonly victoiresB: number;
      readonly sansVainqueur: number;
      readonly rencontres: readonly Rencontre[];
    };

/**
 * LE FACE-À-FACE ENTRE DEUX COMBATTANTS.
 *
 * Un combat n'est retenu que si les deux y figurent, CHACUN D'UN CÔTÉ. Tester
 * « l'un OU l'autre y figure » ramènerait tous les combats des deux athlètes ;
 * compter deux fois le même identifiant de combat doublerait leur historique.
 * Les deux fautes donnent un nombre plausible.
 */
export function faceAFace(
  combattantA: string,
  combattantB: string,
  fights: readonly FightRecord[],
): FaceAFace {
  if (combattantA === combattantB) return { seSontRencontres: false };

  const rencontres: Rencontre[] = [];
  let victoiresA = 0;
  let victoiresB = 0;
  let sansVainqueur = 0;

  for (const f of combatsRetenus(fights)) {
    const coteA = coteDe(f, combattantA);
    const coteB = coteDe(f, combattantB);
    if (coteA === null || coteB === null || coteA === coteB) continue;

    if (f.winner === combattantA) victoiresA++;
    else if (f.winner === combattantB) victoiresB++;
    else sansVainqueur++;

    rencontres.push({
      fightId: f.fightId,
      vainqueur: f.winner,
      winMethod: f.winMethod ?? null,
      submissionType: isSubmissionType(f.submissionType) ? f.submissionType : null,
    });
  }

  if (rencontres.length === 0) return { seSontRencontres: false };
  return {
    seSontRencontres: true,
    combats: rencontres.length,
    victoiresA,
    victoiresB,
    sansVainqueur,
    rencontres,
  };
}

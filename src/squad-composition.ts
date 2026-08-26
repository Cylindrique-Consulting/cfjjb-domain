/**
 * L'AUTO-COMPOSITION DES ÉQUIPES A / B / C.
 *
 * Un club répartit ses combattants en équipes A, B et C jusqu'à un délai FERME
 * après la clôture des inscriptions (défaut 72 h, `competitions.
 * squad_window_hours`). Passé ce délai, le système compose seul.
 *
 * ┌─ POURQUOI LE DÉLAI EST FERME ─────────────────────────────────────────────┐
 * │ Sans auto-composition, une compétition attend le dernier club retardataire │
 * │ pour générer ses tableaux. L'inaction d'un club deviendrait un veto sur la  │
 * │ journée entière : exactement la dépendance aux personnes que ce programme   │
 * │ existe pour supprimer. L'auto-composition n'est donc pas un secours, c'est  │
 * │ la règle par défaut ; la composition par le club est ce qui la précède.     │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * LA RÈGLE : RÉPARTITION ÉQUILIBRÉE PAR CATÉGORIE. Trois combattants d'un même
 * club dans une catégorie vont en A, B et C ; deux vont en A et B. La lettre
 * étant une clé de séparation du tirage, les répartir revient à demander qu'ils
 * se rencontrent le plus tard possible.
 *
 * TROIS DÉCISIONS, prises ici plutôt que supposées :
 *
 * 1. AU-DELÀ DE TROIS, LES LETTRES TOURNENT. Un quatrième combattant reprend A,
 *    un cinquième B. Les deux autres options ont été écartées : refuser de
 *    composer rendrait à un club la capacité de bloquer la génération, ce que le
 *    délai ferme vient précisément de lui retirer ; et une quatrième lettre est
 *    interdite par le schéma (`check (letter in ('A','B','C'))`) pour une raison
 *    de fond - la contrainte de tirage ne sait séparer que deux moitiés de
 *    tableau, une lettre de plus ne sépare donc rien de plus.
 *
 * 2. LE TIRAGE EST DÉRIVÉ PAR INSCRIPTION, PAS CONSOMMÉ EN FILE. Chaque
 *    combattant reçoit une clé de tirage `mulberry32(fnv1a(graine|id))`, et les
 *    lettres se distribuent dans l'ordre de ces clés. Un flux unique consommé
 *    dans l'ordre de lecture aurait été tout aussi déterministe SUR LE PAPIER et
 *    faux en pratique : une lecture PostgREST ne garantit aucun ordre, donc deux
 *    exécutions du même délai auraient rendu deux compositions, sans que rien ne
 *    dise laquelle fait foi. Ici la composition ne dépend que de (graine,
 *    identifiants), et `tests/squad-composition.test.ts` le prouve en rejouant
 *    la même population dans un ordre mélangé.
 *
 * 3. UNE LETTRE DÉJÀ POSÉE NE BOUGE JAMAIS. L'auto-composition COMPLÈTE : elle
 *    remplit les vides et compte les lettres existantes pour équilibrer autour
 *    d'elles. Un club qui a mis ses trois combattants en A garde ses trois A -
 *    c'est un choix, pas une erreur, et le corriger d'office ferait mentir
 *    l'écran qui affiche « composé par le club ».
 *
 * Module pur : aucune IO, aucune dépendance.
 */

import { fnv1a, mulberry32 } from "./prng";
import { DEFAULT_SEEDING_PLAN, type SeedingPlan } from "./seeding-plan";

// ===================================================================
// Le vocabulaire
// ===================================================================

/** Les trois lettres, dans l'ordre où elles se distribuent à égalité de charge. */
export const SQUAD_LETTERS = ["A", "B", "C"] as const;
export type SquadLetter = (typeof SQUAD_LETTERS)[number];

/** `competition_squads.source`. `auto` DOIT s'afficher : voir le commentaire de la colonne. */
export type SquadSource = "club" | "auto" | "federation";

/** Le défaut de `competitions.squad_window_hours`, et sa borne haute (deux semaines). */
export const SQUAD_WINDOW_HOURS_DEFAULT = 72;
export const SQUAD_WINDOW_HOURS_MAX = 336;

/**
 * Un inscrit à composer.
 *
 * `categoryKey` est FOURNIE par l'appelant, et ce module ne la devine jamais -
 * même contrat que `seeding-plan.ts` avec les clés d'équipe. La composer ici
 * demanderait de rejouer la résolution ceinture/âge/genre/poids/discipline, qui
 * vit dans `sizing.ts` et dans la base, et en donnerait une seconde version.
 */
export type SquadCandidate = {
  readonly registrationId: string;
  /** Sans club, pas d'équipe : `competition_squads` est unique par (compétition, club, lettre). */
  readonly clubId: string | null;
  /**
   * L'ÉQUIPE du club pour cette saison, quand il en a une (CYL-502).
   *
   * FOURNIE, JAMAIS DEVINÉE — même contrat que `categoryKey`. Le noyau ne sait
   * pas lire d'affiliation ; c'est l'appelant qui résout, et lui seul sait de
   * quelle saison il parle.
   *
   * ┌─ POURQUOI ELLE CHANGE LE GROUPEMENT ─────────────────────────────────────┐
   * │ La règle fédérale est « deux combattants au plus par ÉQUIPE et par        │
   * │ catégorie ». Une team fédère plusieurs clubs : équilibrer par club        │
   * │ laisserait deux combattants de deux clubs d'une même équipe recevoir la   │
   * │ lettre A chacun, et le tirage les tiendrait pour deux sous-équipes        │
   * │ différentes — c'est-à-dire ne les séparerait pas.                         │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  readonly teamId?: string | null;
  readonly categoryKey: string;
  /** La lettre déjà posée, s'il y en a une. */
  readonly letter?: SquadLetter | null;
  /** Qui l'a posée. Sert à rendre la composition telle qu'elle sera affichée. */
  readonly source?: SquadSource | null;
};

export type SquadAssignment = {
  readonly registrationId: string;
  readonly clubId: string;
  /**
   * L'ENTITÉ SUR LAQUELLE LA LETTRE A ÉTÉ ÉQUILIBRÉE : l'équipe, ou le club à
   * défaut. Rendue parce que l'appelant en a besoin pour deux choses qu'il ne
   * peut pas redéduire : écrire `competition_squads.team_id`, et fabriquer la
   * clé de séparation du tirage.
   */
  readonly ownerId: string;
  readonly categoryKey: string;
  readonly letter: SquadLetter;
  /** `auto` ⟺ cette lettre vient d'être composée par le système. */
  readonly source: SquadSource;
};

export type SquadComposition = {
  /** TOUTE la population composable, lettres existantes comprises, dans l'ordre d'entrée. */
  readonly assignments: readonly SquadAssignment[];
  /**
   * Les sous-équipes qu'il faut faire exister pour porter ces lettres.
   *
   * `clubId` reste rendu parce que la ligne en base le porte encore — c'est
   * l'écran de répartition du club qui la lit. Mais l'IDENTITÉ de la
   * sous-équipe est `teamId` quand il est présent : deux clubs d'une même
   * équipe qui partagent une lettre forment UNE sous-équipe, pas deux.
   */
  readonly squads: readonly {
    readonly clubId: string;
    readonly teamId: string | null;
    readonly letter: SquadLetter;
  }[];
  /**
   * Les inscriptions SANS CLUB, qui ne peuvent pas recevoir de lettre. Rendues
   * plutôt que tues : un combattant sans club rattaché est une anomalie de
   * données qu'il faut voir, pas une ligne à faire disparaître.
   */
  readonly withoutClub: readonly string[];
};

// ===================================================================
// La fenêtre de composition
// ===================================================================

/**
 * L'instant où la main passe du club au système, en absolu (`clôture + N h`),
 * comme `now() + interval` côté Postgres. `null` si la clôture est illisible.
 */
export function squadCompositionDeadline(
  registrationsCloseAtIso: string | null | undefined,
  windowHours: number = SQUAD_WINDOW_HOURS_DEFAULT,
): string | null {
  if (!registrationsCloseAtIso) return null;
  const closeAt = Date.parse(registrationsCloseAtIso);
  if (!Number.isFinite(closeAt) || !Number.isFinite(windowHours)) return null;
  return new Date(closeAt + windowHours * 3_600_000).toISOString();
}

/**
 * Le club a-t-il encore la main ?
 *
 * EN CAS DE DATE ILLISIBLE, LA FENÊTRE EST RÉPUTÉE FERMÉE. Les deux risques ne
 * sont pas symétriques : une fenêtre fermée à tort fait composer le système à la
 * place d'un club, ce qui s'affiche (`source = 'auto'`) et se corrige tant que
 * les tableaux ne sont pas générés ; une fenêtre ouverte à tort bloque la
 * génération de toute la compétition en attendant une action qui ne viendra
 * jamais.
 */
export function isSquadWindowOpen(
  nowIso: string,
  registrationsCloseAtIso: string | null | undefined,
  windowHours: number = SQUAD_WINDOW_HOURS_DEFAULT,
): boolean {
  const deadline = squadCompositionDeadline(registrationsCloseAtIso, windowHours);
  if (deadline === null) return false;
  const now = Date.parse(nowIso);
  if (!Number.isFinite(now)) return false;
  return now < Date.parse(deadline);
}

// ===================================================================
// La composition
// ===================================================================

/**
 * La clé de tirage d'une inscription : une valeur de [0, 1[ tirée de la graine
 * de compétition ET de l'identifiant de l'inscription. Le même combattant,
 * la même graine, la même clé - quel que soit l'ordre de lecture.
 */
function drawKey(seed: string, registrationId: string): number {
  return mulberry32(fnv1a(`${seed}|squad|${registrationId}`))();
}

/** La lettre la moins chargée ; à charge égale, A avant B avant C. */
function leastLoadedLetter(load: ReadonlyMap<SquadLetter, number>): SquadLetter {
  let best: SquadLetter = "A";
  let bestLoad = Number.POSITIVE_INFINITY;
  for (const letter of SQUAD_LETTERS) {
    const n = load.get(letter) ?? 0;
    if (n < bestLoad) {
      best = letter;
      bestLoad = n;
    }
  }
  return best;
}

/**
 * La composition automatique d'une compétition entière.
 *
 * Elle est TOTALE et IDEMPOTENTE : rappelée sur son propre résultat, elle rend
 * le même résultat, puisque toutes les lettres sont alors posées.
 */
export function autoComposeSquads(
  candidates: readonly SquadCandidate[],
  seed: string,
): SquadComposition {
  const withoutClub: string[] = [];

  // La charge par (club, catégorie), alimentée D'ABORD par les lettres déjà
  // posées : l'équilibrage se fait AUTOUR d'elles, il ne les recalcule pas.
  const load = new Map<string, Map<SquadLetter, number>>();
  const loadOf = (ownerId: string, categoryKey: string): Map<SquadLetter, number> => {
    // Clé PRÉFIXÉE PAR LA LONGUEUR : « ab » + « c » et « a » + « bc » sont deux
    // groupes différents, et une concaténation nue les confondrait en silence.
    const key = ownerId.length + ":" + ownerId + ":" + categoryKey;
    const existing = load.get(key);
    if (existing) return existing;
    const fresh = new Map<SquadLetter, number>();
    load.set(key, fresh);
    return fresh;
  };

  // `clubId` vide vaut ABSENT : une chaîne vide ne désigne aucun club, et la
  // laisser passer créerait une équipe rattachée à rien.
  const withClub = (c: SquadCandidate): c is SquadCandidate & { clubId: string } =>
    typeof c.clubId === "string" && c.clubId.length > 0;

  /**
   * L'ENTITÉ DE RATTACHEMENT : l'équipe si le club en a une, le club sinon.
   *
   * C'est la même règle que partout ailleurs dans le produit, et elle n'est
   * pas un repli par défaut : un club sans équipe se voit appliquer « deux au
   * plus » à son propre niveau, ce qui est exactement ce que la fédération
   * demande.
   */
  const owner = (c: SquadCandidate & { clubId: string }): string =>
    typeof c.teamId === "string" && c.teamId.length > 0 ? c.teamId : c.clubId;

  for (const c of candidates) {
    if (!withClub(c) || !c.letter) continue;
    const l = loadOf(owner(c), c.categoryKey);
    l.set(c.letter, (l.get(c.letter) ?? 0) + 1);
  }

  // Les inscriptions à composer, dans l'ordre de leur clé de tirage. C'est le
  // SEUL endroit où l'aléa entre : il décide qui, des trois, prend le A.
  const aComposer = candidates
    .filter(withClub)
    .filter((c) => !c.letter)
    .map((candidate) => ({ candidate, key: drawKey(seed, candidate.registrationId) }))
    .sort(
      (a, b) =>
        a.key - b.key ||
        // Départage de mesure nulle (deux clés identiques), présent pour que la
        // fonction reste TOTALE et indépendante de l'ordre de lecture jusque
        // dans ce cas-là. Ce n'est pas un tri par identifiant : l'ordre est
        // celui du tirage, l'identifiant n'arbitre qu'une collision.
        (a.candidate.registrationId < b.candidate.registrationId ? -1 : 1),
    );

  const composed = new Map<string, SquadLetter>();
  for (const { candidate } of aComposer) {
    const l = loadOf(owner(candidate), candidate.categoryKey);
    const letter = leastLoadedLetter(l);
    l.set(letter, (l.get(letter) ?? 0) + 1);
    composed.set(candidate.registrationId, letter);
  }

  // Restitution dans l'ORDRE D'ENTRÉE : l'appelant relit sa propre liste. Les
  // lettres, elles, ne doivent rien à cet ordre - c'est la garantie du point 2.
  const assignments: SquadAssignment[] = [];
  const squads: { clubId: string; teamId: string | null; letter: SquadLetter }[] = [];
  const seen = new Set<string>();

  for (const c of candidates) {
    if (!withClub(c)) {
      withoutClub.push(c.registrationId);
      continue;
    }
    const letter = c.letter ?? composed.get(c.registrationId);
    if (!letter) continue;
    const ownerId = owner(c);
    assignments.push({
      registrationId: c.registrationId,
      clubId: c.clubId,
      ownerId,
      categoryKey: c.categoryKey,
      letter,
      source: c.letter ? (c.source ?? "club") : "auto",
    });
    // LA CLÉ DE SOUS-ÉQUIPE EST CELLE DE L'ENTITÉ, pas du club : deux clubs
    // d'une même équipe qui partagent une lettre forment UNE sous-équipe, et
    // c'est tout l'objet de CYL-502. La clé du `seen` doit donc l'être aussi,
    // sans quoi on créerait deux lignes pour la même sous-équipe.
    const squadKey = squadTeamId(ownerId, letter);
    if (!seen.has(squadKey)) {
      seen.add(squadKey);
      squads.push({
        clubId: c.clubId,
        teamId: ownerId === c.clubId ? null : ownerId,
        letter,
      });
    }
  }

  return { assignments, squads, withoutClub };
}

// ===================================================================
// Le branchement sur le tirage
// ===================================================================

/**
 * La clé d'ÉQUIPE d'une lettre, pour `BracketEntry.teamId`.
 *
 * La lettre seule ne peut pas être la clé : le A de Marseille et le A de Lyon
 * ne sont pas la même équipe, et les confondre demanderait au tirage de séparer
 * des gens qui n'ont rien à voir. En base, `squad_id` porte déjà cette unicité
 * (unique (competition_id, club_id, letter)) ; cette fonction est ce qu'on
 * utilise quand on compose AVANT d'avoir écrit les lignes.
 */
export function squadTeamId(ownerId: string, letter: SquadLetter): string {
  return `${ownerId}#${letter}`;
}

/**
 * Le plan de tirage qui FAIT QUELQUE CHOSE des lettres : les deux contraintes
 * d'équipe du plan par défaut, allumées.
 *
 * ⚠ CE QUE LA RÉPARTITION ÉQUILIBRÉE PRODUIT RÉELLEMENT, mesuré et non supposé.
 * À trois combattants ou moins par (club, catégorie), les lettres sont toutes
 * DIFFÉRENTES : aucune paire de même équipe n'existe, ces contraintes ne voient
 * donc rien, et la séparation de ces trois-là repose ENTIÈREMENT sur l'anti-club
 * du plan par défaut, qui est déjà actif sans aucune lettre. Les contraintes
 * d'équipe ne commencent à mordre qu'à partir du QUATRIÈME combattant d'un club
 * dans une catégorie - le cas où deux d'entre eux partagent une lettre.
 *
 * Autrement dit, la lettre ne rachète pas l'anti-club : elle le NOMME (sur le
 * tableau et sur la TV) et elle ajoute une séparation là où l'anti-club sature.
 * `tests/squad-composition.test.ts` mesure les deux régimes plutôt que de
 * répéter la promesse.
 */
export const SQUAD_SEEDING_PLAN: SeedingPlan = {
  order: DEFAULT_SEEDING_PLAN.order,
  constraints: DEFAULT_SEEDING_PLAN.constraints.map((c) =>
    c.key === "team" ? { ...c, enabled: true } : c,
  ),
  pins: DEFAULT_SEEDING_PLAN.pins,
};

/** Une entité qui aligne plus de combattants qu'une catégorie n'en tolère. */
export type DepassementParEquipe = {
  readonly ownerId: string;
  readonly categoryKey: string;
  readonly registrationIds: readonly string[];
};

/**
 * OÙ LA RÈGLE « DEUX AU PLUS » EST DÉPASSÉE (CYL-502).
 *
 * ┌─ POURQUOI CE CONSTAT NE SE DÉDUIT PAS DE LA COMPOSITION ──────────────────┐
 * │ `autoComposeSquads` répartit au mieux : à sept combattants d'une même      │
 * │ équipe, il rend trois lettres et deux d'entre elles en portent trois. Il   │
 * │ ne se plaint pas — ce n'est pas son rôle, un tirage doit sortir.           │
 * │                                                                           │
 * │ Mais l'écran de répartition du club doit pouvoir SURLIGNER ces groupes-là, │
 * │ et la génération doit pouvoir les rapporter. Sans ce constat, un club      │
 * │ découvre au bord du tapis que la règle n'a pas pu être tenue pour lui.     │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * Le seuil est un PARAMÈTRE et non une constante cachée : la fédération l'a
 * fixé à deux, mais c'est une décision, pas une propriété du tirage.
 */
export function detecterDepassementsParEquipe(
  candidates: readonly SquadCandidate[],
  seuil = 2,
): DepassementParEquipe[] {
  const groupes = new Map<string, { ownerId: string; categoryKey: string; ids: string[] }>();

  for (const c of candidates) {
    if (typeof c.clubId !== "string" || c.clubId.length === 0) continue;
    const ownerId = typeof c.teamId === "string" && c.teamId.length > 0 ? c.teamId : c.clubId;
    // Même clé préfixée par la longueur qu'ailleurs dans ce module : « ab »+« c »
    // et « a »+« bc » sont deux groupes différents.
    const key = ownerId.length + ":" + ownerId + ":" + c.categoryKey;
    const g = groupes.get(key) ?? { ownerId, categoryKey: c.categoryKey, ids: [] };
    g.ids.push(c.registrationId);
    groupes.set(key, g);
  }

  return (
    [...groupes.values()]
      .filter((g) => g.ids.length > seuil)
      .map((g) => ({ ownerId: g.ownerId, categoryKey: g.categoryKey, registrationIds: g.ids }))
      // Ordre STABLE : le plus gros dépassement d'abord. Un rapport qui change
      // d'une exécution à l'autre ne se compare pas.
      .sort(
        (a, b) =>
          b.registrationIds.length - a.registrationIds.length ||
          a.ownerId.localeCompare(b.ownerId) ||
          a.categoryKey.localeCompare(b.categoryKey),
      )
  );
}

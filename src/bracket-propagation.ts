import { finSansVainqueurAttendUnArbitrage } from "./arbitrage";
import type { GeneratedFight } from "./bracket-generator";

/**
 * PROPAGATION D'UN TABLEAU — le module dont tout le jour J dépend.
 *
 * Il sert quatre appelants qui doivent produire des résultats IDENTIQUES :
 * le navigateur d'un opérateur (y compris hors ligne), le serveur, la console
 * podium et le calcul du palmarès. Deux implémentations divergeraient en
 * silence — un tableau propagé d'un côté et corrigé de l'autre n'a aucun moyen
 * de signaler qu'il ne suit pas les mêmes règles.
 *
 * ┌─ LE PIÈGE QUI CORROMPRAIT CHAQUE TABLEAU ─────────────────────────────────┐
 * │ L'application de référence trie les combats frères par IDENTIFIANT ENTIER  │
 * │ (`sort((a,b) => a.id - b.id)`) parce qu'elle alloue ses clés dans l'ordre  │
 * │ du tableau. Cette plateforme utilise des UUID : les trier n'a AUCUN sens.  │
 * │                                                                            │
 * │ La clé structurelle est `(division, indexInDivision, type)`, déjà unique   │
 * │ en base et déjà émise par le générateur. Ce module n'ordonne JAMAIS par    │
 * │ identifiant — un portage naïf casserait tous les tableaux sans erreur      │
 * │ visible.                                                                   │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * Convention du générateur : `division` compte à l'envers depuis la finale
 * (1 = finale, 2 = demies, la plus profonde = premier tour), et le combat
 * d'index i envoie son vainqueur vers `floor(i/2)` de la division inférieure,
 * emplacement A si i est pair, B sinon.
 *
 * Le module ne mute rien : il rend des PLANS. C'est ce qui permet à la même
 * décision d'être appliquée par un réducteur en mémoire côté navigateur et par
 * une fonction SQL côté serveur, puis comparée.
 */

export type FightState = "scheduled" | "in_progress" | "finished" | "cancelled";

/**
 * Méthode de victoire.
 *
 * `bye` et `double_wo` ne sont pas des décisions d'arbitre mais des états
 * structurels : le premier dit que personne n'a combattu, le second qu'aucun
 * vainqueur n'existe. Les distinguer de `wo` importe — un `wo` a un vainqueur.
 *
 * RELEASE B (v0.17.0, réponses du client du 15/09/2026) :
 *
 *   · `double_dq` : les DEUX athlètes sont disqualifiés (DQ1.1), chacun avec
 *     son motif (`dqReasonA`, `dqReasonB`). Combat DISPUTÉ, sans vainqueur.
 *   · `double_blessure` : arrêt pour blessure des deux combattants à égalité
 *     parfaite (SB3.2, IBJJF Rules Book art. 2). Combat DISPUTÉ, sans vainqueur.
 *   · `designation` : désignation entre coéquipiers en finale (guide des points
 *     v1.2 §7.2). Un vainqueur, mais AUCUN combat disputé (pas de repos).
 *
 * Une fin sans vainqueur peut attendre un arbitrage (`arbitrage.ts`) : tant
 * qu'il n'est pas rendu, le tableau n'avance pas de ce côté.
 */
export type WinMethod =
  | "points"
  | "submission"
  | "abandon"
  | "wo"
  | "double_wo"
  | "dq"
  | "decision"
  | "bye"
  | "double_dq"
  | "double_blessure"
  | "designation";

/** Les deux fins d'un combat DISPUTÉ qui ne désignent aucun vainqueur. */
export type MethodeSansVainqueur = "double_dq" | "double_blessure";

/** Le motif d'une disqualification, par athlète (colonnes `dq_reason*`). */
export type MotifDeDisqualification = "technique" | "disciplinaire";

/**
 * L'arbitrage RENDU sur une fin sans vainqueur (colonnes `arbitrage_*` de
 * `competition_fight_states`). Sa seule présence dit « l'arbitrage est rendu »
 * (`arbitrage_le` posé) :
 *
 *   · `tirage` : le Responsable a saisi le tirage au sort ; le gagnant est
 *     `winner`, et le perdant du tirage est le perdant du combat ;
 *   · `decision` : le Responsable a saisi la suite retenue ; `winner` est le
 *     qualifié, ou `null` si personne ne l'est ;
 *   · `null` : l'arbitrage est rendu AILLEURS que sur ce combat (combats
 *     supplémentaires créés, ou classement saisi pour la catégorie).
 */
export type ArbitrageRendu = { mode: "tirage" | "decision" | null };

export type PropagationFight = {
  id: string;
  division: number;
  indexInDivision: number;
  type: "BraketFight" | "BraketFightPool3" | "BraketFightRepechage3";
  slotA: string | null;
  slotB: string | null;
  isBye: boolean;
  state: FightState;
  winner: string | null;
  winMethod: WinMethod | null;
  /**
   * Le combat ne peut PAS avancer tout seul et attend un arbitrage humain.
   *
   * Posé quand un double forfait laisse un combat aval sans vainqueur possible.
   * L'alternative — faire avancer quelqu'un d'office — inventerait un résultat.
   */
  needsArbitration: boolean;
  /**
   * Ce `wo`/`double_wo` a été PRONONCÉ PAR LA CASCADE, pas par un arbitre.
   *
   * Seul un WO de cascade est révocable : si son vainqueur devient à son tour
   * éliminé (élimination séquentielle), la cascade le dénoue. Un `wo` d'arbitre
   * (jamais marqué) reste acquis — c'est l'invariant I2. Optionnel et par défaut
   * absent : un combat qui n'a jamais été touché par la cascade ne le porte pas,
   * et le client hors ligne, qui ne connaît pas l'ensemble des éliminés, ne
   * révoque jamais (le serveur fait foi à la relecture).
   */
  cascadeForfeit?: boolean;
  /** Le motif d'une disqualification simple (`dq`), s'il est connu. */
  dqReason?: MotifDeDisqualification | null;
  /** Les motifs d'une double disqualification, côté A et côté B. */
  dqReasonA?: MotifDeDisqualification | null;
  dqReasonB?: MotifDeDisqualification | null;
  /** La case « Arrêt pour blessure des deux combattants » était cochée (SB3.2). */
  doubleBlessure?: boolean;
  /** L'arbitrage rendu sur une fin sans vainqueur, `null`/absent sinon. */
  arbitrage?: ArbitrageRendu | null;
  version: number;
};

export type Slot = "A" | "B";
export type SlotWrite = { fightId: string; slot: Slot; registrationId: string | null };
export type FightPatch = { fightId: string } & Partial<Omit<PropagationFight, "id">>;

/**
 * Ce que l'appelant croyait vrai au moment de décider.
 *
 * Le serveur compare `state` et `version` avant d'appliquer : tout écart est un
 * conflit (un autre appareil est passé avant), et le plan est refusé plutôt
 * qu'appliqué sur un état qu'il n'a pas vu. C'est le verrou pessimiste, et c'est
 * ce qui rend vrai « un combat déjà en cours ailleurs ne peut pas être écrasé en
 * silence ».
 */
export type Expectation = { fightId: string; state: FightState; version: number };

export type Plan = {
  patches: FightPatch[];
  propagation: SlotWrite[];
  expected: Expectation[];
};

// ------------------------------------------------------------------
// Lecture
// ------------------------------------------------------------------

/**
 * Clé STRUCTURELLE d'un combat, et non son identifiant.
 *
 * C'est elle qui permet à ce module de fonctionner sur des combats générés (qui
 * n'ont pas encore d'identifiant) comme sur des combats enregistrés.
 */
export function structuralKey(
  f: Pick<PropagationFight, "division" | "indexInDivision" | "type">,
): string {
  return `${f.division}:${f.indexInDivision}:${f.type}`;
}

/**
 * Adapte la sortie du générateur à la forme de propagation.
 *
 * C'est l'adaptateur qui rend le croisement testable : la preuve de parité n° 1
 * exige que `planByeCascade(fromGenerated(...))` soit VIDE, parce que le
 * générateur pré-place déjà les vainqueurs de bye. Si ce n'est pas un no-op, les
 * deux implémentations ont divergé.
 */
export function fromGenerated(
  fights: readonly GeneratedFight[],
  idOf: (f: GeneratedFight) => string = structuralKey,
): PropagationFight[] {
  return fights.map((f) => ({
    id: idOf(f),
    division: f.division,
    indexInDivision: f.indexInDivision,
    type: f.type,
    slotA: f.slotA,
    slotB: f.slotB,
    isBye: f.isBye,
    // Un bye est structurellement terminé : personne ne monte sur le tapis, et
    // son qualifié est connu dès la génération.
    state: f.isBye ? "finished" : "scheduled",
    winner: f.isBye ? (f.slotA ?? f.slotB) : null,
    winMethod: f.isBye ? "bye" : null,
    needsArbitration: false,
    version: 0,
  }));
}

const regulars = (fights: readonly PropagationFight[]): PropagationFight[] =>
  fights.filter((f) => f.type === "BraketFight");

/** La division du premier tour (la plus profonde). */
export function deepestDivision(fights: readonly PropagationFight[]): number {
  return regulars(fights).reduce((max, f) => Math.max(max, f.division), 0);
}

function at(
  fights: readonly PropagationFight[],
  division: number,
  indexInDivision: number,
): PropagationFight | null {
  return (
    fights.find(
      (f) =>
        f.type === "BraketFight" &&
        f.division === division &&
        f.indexInDivision === indexInDivision,
    ) ?? null
  );
}

/**
 * Un NOURRICIER à une case donnée : un combat ordinaire OU le repêchage d'un
 * tableau de trois.
 *
 * `at()` reste réservé aux CIBLES de la montée d'un vainqueur, qui sont toujours
 * des `BraketFight` (miroir de `jour_j_next_slot`). Mais à trois inscrits le
 * repêchage occupe la case du bye au premier tour : il NOURRIT le côté A de la
 * finale comme une demie nourrit l'autre. Le chercher avec `at()` rendait `null`
 * (trou #3), donc `isSlotImpossible(finale, "A")` restait faux pour toujours et
 * une finale dont le repêchage meurt sans vainqueur ne se soldait jamais côté
 * client. Miroir de `jour_j_feeder_fight` (20261230000004), qui accepte les deux
 * types ; le combat de 3e place reste exclu : il DÉTERMINE une place.
 */
function nourricierA(
  fights: readonly PropagationFight[],
  division: number,
  indexInDivision: number,
): PropagationFight | null {
  return (
    fights.find(
      (f) =>
        (f.type === "BraketFight" || f.type === "BraketFightRepechage3") &&
        f.division === division &&
        f.indexInDivision === indexInDivision,
    ) ?? null
  );
}

export function pool3Of(fights: readonly PropagationFight[]): PropagationFight | null {
  return fights.find((f) => f.type === "BraketFightPool3") ?? null;
}

/**
 * LE REPÊCHAGE D'UNE CATÉGORIE À TROIS, s'il existe.
 *
 * ┌─ POURQUOI IL PREND LA PLACE DU BYE, ET NON UNE DIVISION À LUI ────────────┐
 * │ À trois inscrits, l'arbre de taille 4 portait un bye : un combattant       │
 * │ passait GRATUITEMENT en finale, et la catégorie ne comptait que deux       │
 * │ combats réels. Décision produit du 10/09/2026 : ce passage gratuit         │
 * │ disparaît. Le troisième n'attend plus la finale, il attend le PERDANT de   │
 * │ la demie, et le vainqueur de ce combat-là monte en finale.                 │
 * │                                                                            │
 * │ Il se pose donc EXACTEMENT là où était le bye — même division, même index  │
 * │ — et cela n'est pas un détail d'implémentation : `findNextSlot` route      │
 * │ alors son vainqueur vers la finale SANS UNE LIGNE DE PLUS, par la même     │
 * │ arithmétique que tous les autres combats. Une division à part aurait       │
 * │ demandé une règle de propagation parallèle, c'est-à-dire une cinquième     │
 * │ implémentation à tenir d'accord avec les quatre autres.                    │
 * │                                                                            │
 * │ SON EMPLACEMENT VIDE EST TOUJOURS `A`, par construction du générateur : le │
 * │ combattant qui attend est posé en `B`. La règle du perdant n'a donc pas à  │
 * │ deviner de quel côté écrire.                                               │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
export function repechage3Of(fights: readonly PropagationFight[]): PropagationFight | null {
  return fights.find((f) => f.type === "BraketFightRepechage3") ?? null;
}

/** L'emplacement suivant d'un vainqueur, ou `null` s'il n'y en a pas. */
export function findNextSlot(
  fights: readonly PropagationFight[],
  fight: PropagationFight,
): { fightId: string; slot: Slot } | null {
  // Le combat de 3e place ne mène nulle part : il DÉTERMINE une place.
  if (fight.type === "BraketFightPool3") return null;
  if (fight.division <= 1) return null;
  const cible = at(fights, fight.division - 1, Math.floor(fight.indexInDivision / 2));
  if (!cible) return null;
  return { fightId: cible.id, slot: fight.indexInDivision % 2 === 0 ? "A" : "B" };
}

/**
 * L'emplacement du PERDANT d'une demi-finale dans le combat de 3e place.
 *
 * Cette règle n'existait que dans le code de l'application de référence, jamais
 * dans sa spécification : la demie d'index 0 alimente l'emplacement A, celle
 * d'index 1 l'emplacement B — même convention que la propagation du vainqueur.
 */
/**
 * L'emplacement du PERDANT de la demie dans le REPÊCHAGE d'une catégorie à trois.
 *
 * Le pendant de `findPool3Slot`, pour l'autre « perdant de » du système. La
 * demie est l'unique combat ordinaire de la division 2 : le repêchage occupe
 * l'autre index, et son emplacement libre est toujours `A`.
 */
export function findRepechage3Slot(
  fights: readonly PropagationFight[],
  demie: PropagationFight,
): { fightId: string; slot: Slot } | null {
  if (demie.type !== "BraketFight" || demie.division !== 2) return null;
  const rep = repechage3Of(fights);
  if (!rep) return null;
  // Un repêchage ne se nourrit pas de lui-même, et une demie d'un autre index
  // que celui qui reste n'existe pas à trois : on le vérifie plutôt que de le
  // supposer, parce que la supposition tiendrait jusqu'au jour où elle tombe.
  if (rep.indexInDivision === demie.indexInDivision) return null;
  return { fightId: rep.id, slot: "A" };
}

export function findPool3Slot(
  fights: readonly PropagationFight[],
  semi: PropagationFight,
): { fightId: string; slot: Slot } | null {
  if (semi.type !== "BraketFight" || semi.division !== 2) return null;
  if (semi.indexInDivision > 1) return null;
  const p3 = pool3Of(fights);
  if (!p3) return null;
  return { fightId: p3.id, slot: semi.indexInDivision === 0 ? "A" : "B" };
}

/** Le perdant d'un combat terminé, ou `null` si aucun vainqueur n'est désigné. */
export function loserOf(fight: PropagationFight): string | null {
  if (!fight.winner) return null;
  if (fight.slotA === fight.winner) return fight.slotB;
  if (fight.slotB === fight.winner) return fight.slotA;
  return null;
}

/**
 * Le combat AMONT qui alimente un emplacement — l'INVERSE de `findNextSlot` /
 * `findPool3Slot` / `findRepechage3Slot`. Miroir de `jour_j_feeder_fight` côté
 * SQL (20261230000004).
 *
 *   BraketFight (div d, idx i, slot A|B) ← combat (div d+1, idx 2i + (B?1:0)),
 *                                          ordinaire OU repêchage
 *   Pool3       (slot A|B)               ← demie (div 2, idx 0|1)
 *   Repêchage   (slot A)                 ← la demie de l'AUTRE index (div 2, idx 1 − i)
 *   Repêchage   (slot B)                 ← aucun : le 3e y est posé au tirage
 *
 * À trois inscrits (repêchage à l'index 0), le nourricier du côté A de la
 * finale est donc le REPÊCHAGE, celui du côté B la demie.
 *
 * `null` s'il n'y a pas de nourricier (le slot est alimenté par une tête de
 * série, pas par un combat amont).
 */
export function findFeederFight(
  fights: readonly PropagationFight[],
  fight: Pick<PropagationFight, "type" | "division" | "indexInDivision">,
  slot: Slot,
): PropagationFight | null {
  if (fight.type === "BraketFightPool3") {
    return nourricierA(fights, 2, slot === "A" ? 0 : 1);
  }
  if (fight.type === "BraketFightRepechage3") {
    return slot === "A" ? nourricierA(fights, 2, 1 - fight.indexInDivision) : null;
  }
  return nourricierA(
    fights,
    fight.division + 1,
    fight.indexInDivision * 2 + (slot === "A" ? 0 : 1),
  );
}

/** Une fin SANS vainqueur d'un combat disputé : double DQ ou double blessure. */
export function estFinSansVainqueur(f: Pick<PropagationFight, "state" | "winMethod">): boolean {
  return (
    f.state === "finished" && (f.winMethod === "double_dq" || f.winMethod === "double_blessure")
  );
}

/**
 * Un emplacement est-il STRUCTURELLEMENT impossible à remplir ? Son nourricier
 * ne produira JAMAIS l'occupant attendu. Miroir de `jour_j_slot_impossible`.
 *
 *   · montée (cible BraketFight) : impossible si le nourricier est `double_wo`
 *     (aucun vainqueur ne monte) ou `cancelled`. Un `wo` NORMAL fait monter un
 *     vainqueur → PAS impossible.
 *   · descente du perdant (cible Pool3 OU repêchage d'un tableau de trois) :
 *     impossible si la demie nourricière est `wo`/`double_wo`/`cancelled` (aucun
 *     perdant réel), ou si son perdant est éliminé (il ne descend pas). Le côté
 *     B du repêchage n'a pas de nourricier : jamais impossible.
 *   · FIN SANS VAINQUEUR (release B) : un nourricier terminé en `double_dq` ou
 *     `double_blessure` sans vainqueur ATTEND l'arbitrage quand la règle en
 *     demande un et qu'il n'est pas rendu (l'emplacement n'est PAS impossible :
 *     le tableau attend) ; sinon personne ne sort de ce combat, l'emplacement
 *     est impossible — c'est le « passage sans adversaire » de DQ1.2. Un
 *     nourricier arbitré par tirage (ou décision) a un vainqueur et suit la
 *     règle ordinaire.
 *
 * Un nourricier `scheduled`/`in_progress` n'est PAS impossible : on attend.
 */
export function isSlotImpossible(
  fights: readonly PropagationFight[],
  fight: Pick<PropagationFight, "type" | "division" | "indexInDivision">,
  slot: Slot,
  eliminated: ReadonlySet<string> = new Set(),
): boolean {
  const feeder = findFeederFight(fights, fight, slot);
  if (!feeder) return false;
  if (feeder.state === "cancelled") return true;
  if (feeder.state !== "finished") return false;

  if (estFinSansVainqueur(feeder) && feeder.winner === null) {
    return !finSansVainqueurAttendUnArbitrage(fights, feeder);
  }

  if (fight.type === "BraketFightPool3" || fight.type === "BraketFightRepechage3") {
    if (feeder.winMethod === "wo" || feeder.winMethod === "double_wo") return true;
    const perdant = loserOf(feeder);
    return perdant === null || eliminated.has(perdant);
  }
  return feeder.winMethod === "double_wo";
}

// ------------------------------------------------------------------
// Moteur interne
// ------------------------------------------------------------------

type Brouillon = {
  fights: PropagationFight[];
  patches: Map<string, FightPatch>;
  writes: Map<string, SlotWrite>;
  vus: Set<string>;
};

function ouvrir(fights: readonly PropagationFight[]): Brouillon {
  return {
    fights: fights.map((f) => ({ ...f })),
    patches: new Map(),
    writes: new Map(),
    vus: new Set(),
  };
}

function patcher(b: Brouillon, fightId: string, patch: Omit<FightPatch, "fightId">): void {
  const cible = b.fights.find((f) => f.id === fightId);
  if (!cible) return;
  Object.assign(cible, patch);
  b.patches.set(fightId, { ...(b.patches.get(fightId) ?? { fightId }), ...patch });
  b.vus.add(fightId);
}

function ecrire(b: Brouillon, w: SlotWrite): void {
  const cible = b.fights.find((f) => f.id === w.fightId);
  if (!cible) return;
  if (w.slot === "A") cible.slotA = w.registrationId;
  else cible.slotB = w.registrationId;
  b.writes.set(`${w.fightId}:${w.slot}`, w);
  b.vus.add(w.fightId);
}

function fermer(b: Brouillon, original: readonly PropagationFight[]): Plan {
  const parId = new Map(original.map((f) => [f.id, f] as const));
  return {
    patches: [...b.patches.values()],
    propagation: [...b.writes.values()],
    // L'attendu porte sur l'état ORIGINAL de chaque combat touché : c'est ce que
    // l'appelant croyait vrai, et donc ce que le serveur doit vérifier.
    expected: [...b.vus]
      .map((id) => parId.get(id))
      .filter((f): f is PropagationFight => f !== undefined)
      .map((f) => ({ fightId: f.id, state: f.state, version: f.version })),
  };
}

/**
 * Propage le vainqueur d'un combat terminé, et le perdant d'une demie vers le
 * combat de 3e place OU vers le repêchage d'un tableau de trois.
 *
 * Les deux descentes ne coexistent jamais (3e place à partir de quatre
 * inscrits, repêchage à trois seulement), et le SQL les sert par la même
 * fonction, `jour_j_pool3_slot`, appelée par `day_fight_finish`.
 */
function propager(b: Brouillon, fight: PropagationFight): void {
  const suivant = findNextSlot(b.fights, fight);
  if (suivant && fight.winner) {
    ecrire(b, { ...suivant, registrationId: fight.winner });
  }
  // TROU #1 (audit du 11/09/2026) : `findRepechage3Slot` était définie,
  // exportée et juste, mais `propager` ne l'appelait jamais. Le serveur écrivait
  // le perdant de la demie dans le repêchage, le client non : son attendu
  // optimiste, ses aperçus et ses chaînes de réouverture ignoraient la case.
  const descente = findPool3Slot(b.fights, fight) ?? findRepechage3Slot(b.fights, fight);
  if (descente) {
    const perdant = loserOf(fight);
    // Le perdant d'une demie descend — SAUF s'il est éliminé (miroir du
    // `jour_j_control_verdict(v_loser) <> 'elimine'` de `day_fight_finish`).
    // L'application de référence l'y plaçait quand même, en comptant sur le staff
    // pour l'en retirer ; placer un athlète éliminé dans un combat de médaille
    // est faux, et c'est un écart assumé avec elle.
    if (perdant && !b.vus.has(`elimine:${perdant}`)) {
      ecrire(b, { ...descente, registrationId: perdant });
    }
  }
}

// ------------------------------------------------------------------
// Plans
// ------------------------------------------------------------------

/**
 * Les emplacements que la résolution des byes doit remplir.
 *
 * DOIT ÊTRE VIDE sur une sortie fraîche du générateur : celui-ci pré-place déjà
 * les vainqueurs de bye. C'est la preuve de parité la plus économique du projet —
 * trois lignes de test qui détectent toute divergence entre les deux modules.
 */
export function planByeCascade(fights: readonly PropagationFight[]): SlotWrite[] {
  const out: SlotWrite[] = [];
  for (const f of fights) {
    if (!f.isBye || f.type !== "BraketFight") continue;
    const gagnant = f.winner ?? f.slotA ?? f.slotB;
    const suivant = findNextSlot(fights, f);
    if (!gagnant || !suivant) continue;
    const cible = fights.find((x) => x.id === suivant.fightId);
    const dejaLa = suivant.slot === "A" ? cible?.slotA : cible?.slotB;
    if (dejaLa !== gagnant) out.push({ ...suivant, registrationId: gagnant });
  }
  return out;
}

/** Terminer un combat sur une décision d'arbitre. */
export function planFinish(
  fights: readonly PropagationFight[],
  fightId: string,
  winner: string,
  method: WinMethod,
  eliminated: ReadonlySet<string> = new Set(),
): Plan {
  const b = ouvrir(fights);
  for (const e of eliminated) b.vus.add(`elimine:${e}`);

  const fight = b.fights.find((f) => f.id === fightId);
  if (!fight) return fermer(b, fights);

  patcher(b, fightId, { state: "finished", winner, winMethod: method, needsArbitration: false });
  propager(
    b,
    b.fights.find((f) => f.id === fightId)!,
  );

  // POINT FIXE. Le vainqueur qui vient d'arriver au tour suivant peut lui-même
  // être éliminé : c'est exactement le cas que l'application de référence rate,
  // parce qu'elle ne balaie qu'au moment du forfait et jamais au moment où un
  // emplacement se remplit.
  if (eliminated.size > 0) forfaitsEnPointFixe(b, eliminated);

  const plan = fermer(b, fights);
  return { ...plan, expected: plan.expected.filter((e) => !e.fightId.startsWith("elimine:")) };
}

/** La fin sans vainqueur telle que la saisit la table de marque. */
export type FinSansVainqueur =
  | {
      method: "double_dq";
      dqReasonA: MotifDeDisqualification;
      dqReasonB: MotifDeDisqualification;
    }
  | { method: "double_blessure" };

/**
 * Terminer un combat SANS VAINQUEUR : double disqualification (DQ1.1) ou
 * double blessure à égalité parfaite (SB3.2).
 *
 * N'ÉCRIT AUCUN EMPLACEMENT, et c'est la règle (miroir de `day_fight_finish`) :
 * aucun des deux n'avance. Le combat suivant attend, puis la cascade le règle
 * (« passage sans adversaire ») quand la règle d'arbitrage est nulle, ou il
 * attend l'arbitrage du Responsable quand elle ne l'est pas
 * (`isSlotImpossible`). Le point fixe ne tourne qu'avec des éliminés, comme
 * `planFinish`.
 */
export function planFinishSansVainqueur(
  fights: readonly PropagationFight[],
  fightId: string,
  fin: FinSansVainqueur,
  eliminated: ReadonlySet<string> = new Set(),
): Plan {
  const b = ouvrir(fights);
  for (const e of eliminated) b.vus.add(`elimine:${e}`);

  const fight = b.fights.find((f) => f.id === fightId);
  if (!fight) return fermer(b, fights);

  patcher(b, fightId, {
    state: "finished",
    winner: null,
    winMethod: fin.method,
    dqReasonA: fin.method === "double_dq" ? fin.dqReasonA : null,
    dqReasonB: fin.method === "double_dq" ? fin.dqReasonB : null,
    doubleBlessure: fin.method === "double_blessure",
    arbitrage: null,
    needsArbitration: false,
  });

  if (eliminated.size > 0) forfaitsEnPointFixe(b, eliminated);

  const plan = fermer(b, fights);
  return { ...plan, expected: plan.expected.filter((e) => !e.fightId.startsWith("elimine:")) };
}

/**
 * Rendre l'ARBITRAGE d'une fin sans vainqueur (miroir de `day_fight_arbitrer`,
 * et, pour `mode: null`, de `day_arbitrage_combats_creer` et
 * `day_categorie_classement_saisir` qui marquent l'arbitrage rendu).
 *
 *   · `tirage` : `gagnant` est obligatoire ; il monte comme un vainqueur, et le
 *     perdant du tirage descend comme le perdant du combat (1re demi-finale d'un
 *     tableau de trois → 2e demi-finale) ;
 *   · `decision` : `gagnant` est le qualifié retenu, ou `null` (personne ne
 *     l'est, l'emplacement aval devient impossible) ;
 *   · `null` : l'arbitrage est rendu ailleurs (combats créés, classement saisi).
 *
 * La méthode (`double_dq`, `double_blessure`) et les motifs ne changent pas :
 * l'arbitrage s'AJOUTE au résultat, il ne le réécrit pas.
 */
export function planArbitrage(
  fights: readonly PropagationFight[],
  fightId: string,
  arbitrage: { mode: ArbitrageRendu["mode"]; gagnant: string | null },
  eliminated: ReadonlySet<string> = new Set(),
): Plan {
  const b = ouvrir(fights);
  for (const e of eliminated) b.vus.add(`elimine:${e}`);
  const fight = b.fights.find((f) => f.id === fightId);
  if (!fight) return fermer(b, fights);

  patcher(b, fightId, { winner: arbitrage.gagnant, arbitrage: { mode: arbitrage.mode } });
  if (arbitrage.gagnant !== null) {
    propager(
      b,
      b.fights.find((f) => f.id === fightId)!,
    );
  }
  forfaitsEnPointFixe(b, eliminated);

  const plan = fermer(b, fights);
  return { ...plan, expected: plan.expected.filter((e) => !e.fightId.startsWith("elimine:")) };
}

/**
 * DISQUALIFIÉ DISCIPLINAIRE, lu sur les combats — miroir de
 * `jour_j_disqualifie_disciplinaire` : perdant d'un `dq` au motif
 * disciplinaire, ou côté disciplinaire d'une double disqualification.
 *
 * C'est le point de branchement de L7 : tant que la procédure de validation
 * n'existe pas, une disqualification disciplinaire saisie à la table vaut
 * « validée » (décision D4 du lot L5).
 */
export function estDisqualifieDisciplinaire(
  fights: readonly PropagationFight[],
  registrationId: string,
): boolean {
  return fights.some((f) => {
    if (f.state !== "finished") return false;
    if (f.winMethod === "dq") {
      return f.dqReason === "disciplinaire" && loserOf(f) === registrationId;
    }
    if (f.winMethod === "double_dq") {
      return (
        (f.slotA === registrationId && f.dqReasonA === "disciplinaire") ||
        (f.slotB === registrationId && f.dqReasonB === "disciplinaire")
      );
    }
    return false;
  });
}

/**
 * Retire un FANTÔME (vainqueur d'un WO révoqué) de l'emplacement aval.
 *
 * Aval non démarré (`scheduled`) → on vide l'emplacement ET on signale
 * l'arbitrage : le tour suivant (b)/(b') tranchera peut-être, sinon un humain.
 * Aval déjà joué ou en cours → on ne lui RETIRE PAS son occupant (invariant I5),
 * on se contente de signaler l'arbitrage.
 */
function desavancerFantome(
  b: Brouillon,
  suivant: { fightId: string; slot: Slot } | null,
  fantome: string | null,
): void {
  if (!suivant || fantome === null) return;
  const aval = b.fights.find((f) => f.id === suivant.fightId);
  if (!aval) return;
  const present = suivant.slot === "A" ? aval.slotA : aval.slotB;
  if (present !== fantome) return;
  if (aval.state === "scheduled") ecrire(b, { ...suivant, registrationId: null });
  patcher(b, suivant.fightId, { needsArbitration: true });
}

/**
 * LE POINT FIXE DE LA CASCADE. Un seul combat tranché par tour de boucle, par
 * ORDRE DE PRIORITÉ — miroir de `jour_j_forfait_cascade` (v2) côté SQL :
 *
 *   (a) révocation d'un WO de cascade dont le vainqueur est devenu éliminé
 *   (classique) un combat aux deux côtés connus dont au moins un est éliminé
 *   (b) avancement quand l'adversaire est structurellement impossible
 *   (b') annulation quand plus AUCUN participant n'est possible
 *
 * Chaque action retire son propre déclencheur (un `finished`/`cancelled` n'est
 * plus `scheduled`, un `wo` re-prononcé n'a plus de vainqueur éliminé), donc la
 * boucle converge ; la garde-compteur est une défense.
 */
function forfaitsEnPointFixe(b: Brouillon, eliminated: ReadonlySet<string>): void {
  const estElimine = (r: string | null): boolean => r !== null && eliminated.has(r);
  let bouge = true;
  let garde = b.fights.length * 6;

  while (bouge && garde-- > 0) {
    bouge = false;

    // ── (a) RÉVOCATION d'un WO fantôme ─────────────────────────────────────
    // Un `wo` PRONONCÉ PAR LA CASCADE dont le vainqueur est DÉSORMAIS éliminé
    // (élimination séquentielle). Du plus profond vers la finale, la chaîne se
    // dénoue d'elle-même. Un `wo` d'arbitre (jamais marqué) reste acquis (I2).
    //
    // AUCUN FILTRE DE TYPE, comme `jour_j_forfait_cascade` (20261230000001) :
    // le repêchage d'un tableau de trois et le combat de 3e place se révoquent
    // comme n'importe quel combat. Le filtre `BraketFight` voulait dire « tout
    // sauf la petite finale » et écartait aussi le repêchage.
    const revoquable = b.fights
      .filter(
        (f) =>
          !f.isBye &&
          f.state === "finished" &&
          f.winMethod === "wo" &&
          f.cascadeForfeit === true &&
          estElimine(f.winner),
      )
      .sort((x, y) => y.division - x.division || x.indexInDivision - y.indexInDivision)[0];
    if (revoquable) {
      const fantome = revoquable.winner;
      const perdant = revoquable.slotA === fantome ? revoquable.slotB : revoquable.slotA;
      const suivant = findNextSlot(b.fights, revoquable);
      if (perdant !== null && !estElimine(perdant)) {
        // FLIP (défensif) : l'autre côté redevenu valide gagne le WO à sa place.
        patcher(b, revoquable.id, { winner: perdant, winMethod: "wo", cascadeForfeit: true });
        if (suivant) {
          const aval = b.fights.find((f) => f.id === suivant.fightId);
          const present = aval ? (suivant.slot === "A" ? aval.slotA : aval.slotB) : undefined;
          if (aval && present === fantome) {
            if (aval.state === "scheduled") ecrire(b, { ...suivant, registrationId: perdant });
            else patcher(b, suivant.fightId, { needsArbitration: true });
          }
        }
      } else if (perdant === null) {
        // ANNULATION : l'adversaire était structurellement impossible (WO (b)),
        // il n'y a personne d'autre — le combat n'aura jamais lieu.
        patcher(b, revoquable.id, { state: "cancelled", winner: null, winMethod: null });
        desavancerFantome(b, suivant, fantome);
      } else {
        // DOUBLE FORFAIT : les deux côtés éliminés, aucun vainqueur.
        patcher(b, revoquable.id, { winner: null, winMethod: "double_wo" });
        desavancerFantome(b, suivant, fantome);
      }
      bouge = true;
      continue;
    }

    // ── (classique) un combat non résolu, DEUX côtés connus, ≥ 1 éliminé ────
    // Sans filtre de type, miroir du SQL : un repêchage « perdant de la demie
    // contre le 3e » dont le 3e est éliminé se solde par forfait, et son
    // vainqueur monte en finale (TR1.2).
    const classique = b.fights.find(
      (f) =>
        !f.isBye &&
        f.state === "scheduled" &&
        f.slotA !== null &&
        f.slotB !== null &&
        (estElimine(f.slotA) || estElimine(f.slotB)),
    );
    if (classique) {
      if (estElimine(classique.slotA) && estElimine(classique.slotB)) {
        // DOUBLE FORFAIT : aucun vainqueur, l'aval demande un arbitrage.
        patcher(b, classique.id, { state: "finished", winner: null, winMethod: "double_wo" });
        const suivant = findNextSlot(b.fights, classique);
        if (suivant) {
          ecrire(b, { ...suivant, registrationId: null });
          patcher(b, suivant.fightId, { needsArbitration: true });
        }
      } else {
        const survivant = estElimine(classique.slotA) ? classique.slotB : classique.slotA;
        patcher(b, classique.id, {
          state: "finished",
          winner: survivant,
          winMethod: "wo",
          cascadeForfeit: true,
        });
        propager(
          b,
          b.fights.find((x) => x.id === classique.id)!,
        );
      }
      bouge = true;
      continue;
    }

    // ── (b) AVANCEMENT sur adversaire structurellement impossible ──────────
    // Un côté occupé et valide, l'autre slot vide et IMPOSSIBLE → la personne
    // présente gagne par WO (décision produit). Vaut aussi pour le bronze (Pool3).
    const avancable = b.fights.find(
      (f) =>
        !f.isBye &&
        f.state === "scheduled" &&
        ((f.slotA !== null &&
          f.slotB === null &&
          !estElimine(f.slotA) &&
          isSlotImpossible(b.fights, f, "B", eliminated)) ||
          (f.slotB !== null &&
            f.slotA === null &&
            !estElimine(f.slotB) &&
            isSlotImpossible(b.fights, f, "A", eliminated))),
    );
    if (avancable) {
      const gagnant = avancable.slotA ?? avancable.slotB;
      // `needsArbitration: false`, comme le SQL (`needs_arbitration = false`) :
      // un combat soldé n'attend plus d'arbitrage, même si un double forfait
      // amont l'avait marqué en vidant son autre côté.
      patcher(b, avancable.id, {
        state: "finished",
        winner: gagnant,
        winMethod: "wo",
        cascadeForfeit: true,
        needsArbitration: false,
      });
      propager(
        b,
        b.fights.find((x) => x.id === avancable.id)!,
      );
      bouge = true;
      continue;
    }

    // ── (b') ANNULATION : aucun participant possible ───────────────────────
    // Occupant éliminé face à un slot impossible, ou deux slots vides et
    // impossibles → le combat n'aura JAMAIS lieu.
    const annulable = b.fights.find(
      (f) =>
        !f.isBye &&
        f.state === "scheduled" &&
        ((f.slotA !== null &&
          estElimine(f.slotA) &&
          f.slotB === null &&
          isSlotImpossible(b.fights, f, "B", eliminated)) ||
          (f.slotB !== null &&
            estElimine(f.slotB) &&
            f.slotA === null &&
            isSlotImpossible(b.fights, f, "A", eliminated)) ||
          (f.slotA === null &&
            f.slotB === null &&
            isSlotImpossible(b.fights, f, "A", eliminated) &&
            isSlotImpossible(b.fights, f, "B", eliminated))),
    );
    if (annulable) {
      patcher(b, annulable.id, {
        state: "cancelled",
        winner: null,
        winMethod: null,
        needsArbitration: false,
      });
      bouge = true;
      continue;
    }
  }
}

/**
 * La cascade d'élimination : hors-poids, absent, ou forfait prononcé.
 *
 * Les combats DÉJÀ TERMINÉS ne sont jamais touchés : un compétiteur qui a gagné
 * avant de se peser garde sa victoire, seuls ses combats à venir tombent.
 */
export function planForfeit(
  fights: readonly PropagationFight[],
  eliminated: ReadonlySet<string>,
): Plan {
  const b = ouvrir(fights);
  for (const e of eliminated) b.vus.add(`elimine:${e}`);
  forfaitsEnPointFixe(b, eliminated);
  const plan = fermer(b, fights);
  return { ...plan, expected: plan.expected.filter((e) => !e.fightId.startsWith("elimine:")) };
}

/**
 * « Refaire le combat » — annule UN SEUL forfait.
 *
 * Ne restaure aucun autre combat de la même élimination et n'efface PAS le
 * verdict qui l'a causée : annuler un pointage ne ressuscite pas une journée.
 * Réservé au commissaire, et l'interface doit demander confirmation en disant
 * que le vainqueur déjà propagé sera retiré.
 *
 * Si le combat aval a déjà commencé, ce n'est pas à ce module de refuser : le
 * garde `expected` le fera côté serveur, avec l'état autoritaire à l'appui.
 */
export function planUndoForfeit(fights: readonly PropagationFight[], fightId: string): Plan {
  const b = ouvrir(fights);
  const fight = b.fights.find((f) => f.id === fightId);
  if (!fight) return fermer(b, fights);

  const ancienVainqueur = fight.winner;
  patcher(b, fightId, {
    state: "scheduled",
    winner: null,
    winMethod: null,
    needsArbitration: false,
  });

  // Retirer le vainqueur propagé — de l'aval ET de la case du perdant : combat
  // de 3e place, ou case A du repêchage d'un tableau de trois (trou #1).
  const suivant = findNextSlot(b.fights, fight);
  if (suivant && ancienVainqueur) {
    const cible = b.fights.find((f) => f.id === suivant.fightId);
    const present = suivant.slot === "A" ? cible?.slotA : cible?.slotB;
    if (present === ancienVainqueur) ecrire(b, { ...suivant, registrationId: null });
  }
  const descente = findPool3Slot(b.fights, fight) ?? findRepechage3Slot(b.fights, fight);
  if (descente) {
    const cible = b.fights.find((f) => f.id === descente.fightId);
    const present = descente.slot === "A" ? cible?.slotA : cible?.slotB;
    if (present !== null && present !== undefined) {
      ecrire(b, { ...descente, registrationId: null });
    }
  }

  return fermer(b, fights);
}

// ------------------------------------------------------------------
// Application en mémoire
// ------------------------------------------------------------------

/**
 * Applique un plan EN MÉMOIRE : patches, puis écritures d'emplacements, version
 * incrémentée par ligne touchée — l'arithmétique des fonctions SQL.
 *
 * Le moteur de podium s'en sert pour lire un tableau « comme la cascade l'aura
 * soldé » : un combat dont un côté est structurellement impossible est un WO
 * que le serveur prononce, qu'il l'ait déjà écrit ou non.
 */
export function appliquerLePlan(
  fights: readonly PropagationFight[],
  plan: Plan,
): PropagationFight[] {
  const out = fights.map((f) => ({ ...f }));
  const touches = new Set<string>();
  for (const p of plan.patches) {
    const cible = out.find((f) => f.id === p.fightId);
    if (!cible) continue;
    const { fightId: _id, ...reste } = p;
    Object.assign(cible, reste);
    touches.add(cible.id);
  }
  for (const w of plan.propagation) {
    const cible = out.find((f) => f.id === w.fightId);
    if (!cible) continue;
    if (w.slot === "A") cible.slotA = w.registrationId;
    else cible.slotB = w.registrationId;
    touches.add(cible.id);
  }
  for (const f of out) if (touches.has(f.id)) f.version += 1;
  return out;
}

// Le PODIUM ne vit plus ici : `computePodium` est retiré en release B
// (v0.17.0) au profit du moteur de classement officiel, `podium-officiel.ts`,
// qui lit l'éligibilité, les places multiples et vacantes et l'arbitrage.

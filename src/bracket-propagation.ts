import type { GeneratedFight } from "./bracket-generator";
import type { ThirdPlaceMode } from "./enums";

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
 */
export type WinMethod =
  "points" | "submission" | "abandon" | "wo" | "double_wo" | "dq" | "decision" | "bye";

export type PropagationFight = {
  id: string;
  division: number;
  indexInDivision: number;
  type: "BraketFight" | "BraketFightPool3";
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

export function pool3Of(fights: readonly PropagationFight[]): PropagationFight | null {
  return fights.find((f) => f.type === "BraketFightPool3") ?? null;
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

/** Propage le vainqueur d'un combat terminé, et le perdant vers le Pool3 si c'est une demie. */
function propager(b: Brouillon, fight: PropagationFight): void {
  const suivant = findNextSlot(b.fights, fight);
  if (suivant && fight.winner) {
    ecrire(b, { ...suivant, registrationId: fight.winner });
  }
  const p3 = findPool3Slot(b.fights, fight);
  if (p3) {
    const perdant = loserOf(fight);
    // Le perdant d'une demie va au combat de 3e place — SAUF s'il est éliminé.
    // L'application de référence l'y plaçait quand même, en comptant sur le staff
    // pour l'en retirer ; placer un athlète éliminé dans un combat de médaille
    // est faux, et c'est un écart assumé avec elle.
    if (perdant && !b.vus.has(`elimine:${perdant}`)) {
      ecrire(b, { ...p3, registrationId: perdant });
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

function forfaitsEnPointFixe(b: Brouillon, eliminated: ReadonlySet<string>): void {
  let bouge = true;
  let garde = b.fights.length * 4;

  while (bouge && garde-- > 0) {
    bouge = false;
    for (const f of b.fights) {
      if (f.type !== "BraketFight" || f.state !== "scheduled") continue;
      const aElimine = f.slotA !== null && eliminated.has(f.slotA);
      const bElimine = f.slotB !== null && eliminated.has(f.slotB);
      if (!aElimine && !bElimine) continue;

      if (aElimine && bElimine) {
        // DOUBLE FORFAIT : aucun vainqueur. Rien ne propage, et le combat aval
        // se retrouve avec un emplacement définitivement vide — il demande un
        // arbitrage plutôt qu'un avancement inventé.
        patcher(b, f.id, { state: "finished", winner: null, winMethod: "double_wo" });
        const suivant = findNextSlot(b.fights, f);
        if (suivant) {
          ecrire(b, { ...suivant, registrationId: null });
          patcher(b, suivant.fightId, { needsArbitration: true });
        }
        bouge = true;
        continue;
      }

      const survivant = aElimine ? f.slotB : f.slotA;
      if (survivant === null) {
        // Adversaire encore inconnu : le combat amont n'est pas joué. On
        // n'invente rien, on attendra que l'emplacement se remplisse — d'où le
        // point fixe plutôt qu'un unique balayage.
        continue;
      }
      patcher(b, f.id, { state: "finished", winner: survivant, winMethod: "wo" });
      propager(
        b,
        b.fights.find((x) => x.id === f.id)!,
      );
      bouge = true;
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

  // Retirer le vainqueur propagé — de l'aval ET du combat de 3e place.
  const suivant = findNextSlot(b.fights, fight);
  if (suivant && ancienVainqueur) {
    const cible = b.fights.find((f) => f.id === suivant.fightId);
    const present = suivant.slot === "A" ? cible?.slotA : cible?.slotB;
    if (present === ancienVainqueur) ecrire(b, { ...suivant, registrationId: null });
  }
  const p3 = findPool3Slot(b.fights, fight);
  if (p3) {
    const cible = b.fights.find((f) => f.id === p3.fightId);
    const present = p3.slot === "A" ? cible?.slotA : cible?.slotB;
    if (present !== null && present !== undefined) ecrire(b, { ...p3, registrationId: null });
  }

  return fermer(b, fights);
}

// ------------------------------------------------------------------
// Podium
// ------------------------------------------------------------------

export type Podium = {
  gold: string | null;
  silver: string | null;
  /** Un bronze si un combat de 3e place a été joué, deux ex æquo sinon. */
  bronze: string[];
  complete: boolean;
  /** Ce qui manque, en clair — pour l'écrire à l'écran plutôt que de rester muet. */
  missing: string[];
};

export function computePodium(
  fights: readonly PropagationFight[],
  opts: { thirdPlaceMode: ThirdPlaceMode; singleCompetitor?: string | null } = {
    thirdPlaceMode: "pool3",
  },
): Podium {
  // Un seul inscrit : or automatique, aucun combat. C'est une victoire par
  // construction et non un podium incomplet.
  if (opts.singleCompetitor) {
    return { gold: opts.singleCompetitor, silver: null, bronze: [], complete: true, missing: [] };
  }

  const missing: string[] = [];
  const finale = at(fights, 1, 0);
  if (!finale) {
    return {
      gold: null,
      silver: null,
      bronze: [],
      complete: false,
      missing: ["Aucun combat dans cette catégorie"],
    };
  }
  if (finale.state !== "finished") missing.push("Finale non terminée");

  const gold = finale.state === "finished" ? finale.winner : null;
  const silver = finale.state === "finished" ? loserOf(finale) : null;

  const p3 = pool3Of(fights);
  let bronze: string[] = [];
  if (p3) {
    if (p3.state === "finished" && p3.winner) {
      bronze = [p3.winner];
    } else {
      // UN COMBAT DE 3e PLACE PRÉVU MAIS NON JOUÉ NE RETOMBE PAS sur les
      // perdants des demies : ce serait décerner deux bronzes ex æquo alors
      // qu'un seul est en jeu. L'application de référence a ce défaut.
      missing.push("Petite finale prévue mais non terminée");
    }
  } else if (opts.thirdPlaceMode === "shared_bronze") {
    const demies = [at(fights, 2, 0), at(fights, 2, 1)].filter(
      (f): f is PropagationFight => f !== null,
    );
    const perdants = demies
      .filter((f) => f.state === "finished")
      .map(loserOf)
      .filter((x): x is string => x !== null);
    bronze = perdants;
    if (demies.some((f) => f.state !== "finished")) missing.push("Demi-finale non terminée");
  }

  return { gold, silver, bronze, complete: missing.length === 0 && gold !== null, missing };
}

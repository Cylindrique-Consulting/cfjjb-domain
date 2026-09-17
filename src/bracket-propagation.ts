import { finSansVainqueurAttendUnArbitrage } from "./arbitrage";
import type { GeneratedFight } from "./bracket-generator";

export type FightState = "scheduled" | "in_progress" | "finished" | "cancelled";

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

export type MethodeSansVainqueur = "double_dq" | "double_blessure";

export type MotifDeDisqualification = "technique" | "disciplinaire";

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
  needsArbitration: boolean;
  cascadeForfeit?: boolean;
  dqReason?: MotifDeDisqualification | null;
  dqReasonA?: MotifDeDisqualification | null;
  dqReasonB?: MotifDeDisqualification | null;
  doubleBlessure?: boolean;
  arbitrage?: ArbitrageRendu | null;
  version: number;
};

export type Slot = "A" | "B";
export type SlotWrite = { fightId: string; slot: Slot; registrationId: string | null };
export type FightPatch = { fightId: string } & Partial<Omit<PropagationFight, "id">>;

export type Expectation = { fightId: string; state: FightState; version: number };

export type Plan = {
  patches: FightPatch[];
  propagation: SlotWrite[];
  expected: Expectation[];
};

export function structuralKey(
  f: Pick<PropagationFight, "division" | "indexInDivision" | "type">,
): string {
  return `${f.division}:${f.indexInDivision}:${f.type}`;
}

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
    state: f.isBye ? "finished" : "scheduled",
    winner: f.isBye ? (f.slotA ?? f.slotB) : null,
    winMethod: f.isBye ? "bye" : null,
    needsArbitration: false,
    version: 0,
  }));
}

const regulars = (fights: readonly PropagationFight[]): PropagationFight[] =>
  fights.filter((f) => f.type === "BraketFight");

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

export function repechage3Of(fights: readonly PropagationFight[]): PropagationFight | null {
  return fights.find((f) => f.type === "BraketFightRepechage3") ?? null;
}

export function findNextSlot(
  fights: readonly PropagationFight[],
  fight: PropagationFight,
): { fightId: string; slot: Slot } | null {
  if (fight.type === "BraketFightPool3") return null;
  if (fight.division <= 1) return null;
  const cible = at(fights, fight.division - 1, Math.floor(fight.indexInDivision / 2));
  if (!cible) return null;
  return { fightId: cible.id, slot: fight.indexInDivision % 2 === 0 ? "A" : "B" };
}

export function findRepechage3Slot(
  fights: readonly PropagationFight[],
  demie: PropagationFight,
): { fightId: string; slot: Slot } | null {
  if (demie.type !== "BraketFight" || demie.division !== 2) return null;
  const rep = repechage3Of(fights);
  if (!rep) return null;
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

export function loserOf(fight: PropagationFight): string | null {
  if (!fight.winner) return null;
  if (fight.slotA === fight.winner) return fight.slotB;
  if (fight.slotB === fight.winner) return fight.slotA;
  return null;
}

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

export function estFinSansVainqueur(f: Pick<PropagationFight, "state" | "winMethod">): boolean {
  return (
    f.state === "finished" && (f.winMethod === "double_dq" || f.winMethod === "double_blessure")
  );
}

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
    expected: [...b.vus]
      .map((id) => parId.get(id))
      .filter((f): f is PropagationFight => f !== undefined)
      .map((f) => ({ fightId: f.id, state: f.state, version: f.version })),
  };
}

function propager(b: Brouillon, fight: PropagationFight): void {
  const suivant = findNextSlot(b.fights, fight);
  if (suivant && fight.winner) {
    ecrire(b, { ...suivant, registrationId: fight.winner });
  }
  const descente = findPool3Slot(b.fights, fight) ?? findRepechage3Slot(b.fights, fight);
  if (descente) {
    const perdant = loserOf(fight);
    if (perdant && !b.vus.has(`elimine:${perdant}`)) {
      ecrire(b, { ...descente, registrationId: perdant });
    }
  }
}

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

  if (cascadeEnJeu(b.fights, eliminated)) forfaitsEnPointFixe(b, eliminated);

  const plan = fermer(b, fights);
  return { ...plan, expected: plan.expected.filter((e) => !e.fightId.startsWith("elimine:")) };
}

export type FinSansVainqueur =
  | {
      method: "double_dq";
      dqReasonA: MotifDeDisqualification;
      dqReasonB: MotifDeDisqualification;
    }
  | { method: "double_blessure" };

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

  if (cascadeEnJeu(b.fights, eliminated)) forfaitsEnPointFixe(b, eliminated);

  const plan = fermer(b, fights);
  return { ...plan, expected: plan.expected.filter((e) => !e.fightId.startsWith("elimine:")) };
}

function cascadeEnJeu(
  fights: readonly PropagationFight[],
  eliminated: ReadonlySet<string>,
): boolean {
  return eliminated.size > 0 || fights.some((f) => estFinSansVainqueur(f) && f.winner === null);
}

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

function forfaitsEnPointFixe(b: Brouillon, eliminated: ReadonlySet<string>): void {
  const estElimine = (r: string | null): boolean => r !== null && eliminated.has(r);
  let bouge = true;
  let garde = b.fights.length * 6;

  while (bouge && garde-- > 0) {
    bouge = false;

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
        patcher(b, revoquable.id, { state: "cancelled", winner: null, winMethod: null });
        desavancerFantome(b, suivant, fantome);
      } else {
        patcher(b, revoquable.id, { winner: null, winMethod: "double_wo" });
        desavancerFantome(b, suivant, fantome);
      }
      bouge = true;
      continue;
    }

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

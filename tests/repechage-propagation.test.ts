import { describe, expect, it } from "vitest";
import { generateBracket, type BracketEntry } from "../src/bracket-generator";
import { classementOfficiel } from "../src/podium-officiel";
import {
  findFeederFight,
  findNextSlot,
  findRepechage3Slot,
  fromGenerated,
  isSlotImpossible,
  planFinish,
  planForfeit,
  planUndoForfeit,
  type Plan,
  type PropagationFight,
} from "../src/bracket-propagation";

// ===================================================================
// LE TABLEAU DE TROIS DANS LA PROPAGATION DU NOYAU (TR1, release A).
//
// Deux trous relevés par l'audit du 11/09/2026, lus dans le source :
//
//   #1 `propager` n'appelait jamais `findRepechage3Slot` : le perdant de la
//      1re demi-finale n'était pas écrit dans la 2e (le « repêchage ») côté
//      client, alors que le SQL (`jour_j_pool3_slot`) l'y écrit ;
//   #3 `at()` ne voit que les `BraketFight` : le nourricier du côté A de la
//      finale (le repêchage) était introuvable, `isSlotImpossible` restait
//      faux, et une finale dont la 2e demi-finale meurt sans vainqueur ne se
//      soldait jamais.
//
// Parité tenue contre le SQL DÉPLOYÉ : jour_j_next_slot, jour_j_pool3_slot et
// jour_j_slot_impossible (20261229000003), jour_j_feeder_fight (20261230000004),
// jour_j_forfait_cascade (20261230000001), day_fight_finish (20261225000013).
// ===================================================================

function entrees(n: number): BracketEntry[] {
  return Array.from({ length: n }, (_, i) => ({ registrationId: `r${i + 1}`, clubId: null }));
}

/** Applique un plan en mémoire (patches, puis écritures de cases). */
function appliquer(fights: PropagationFight[], plan: Plan): PropagationFight[] {
  const out = fights.map((f) => ({ ...f }));
  for (const p of plan.patches) {
    const cible = out.find((f) => f.id === p.fightId);
    if (!cible) continue;
    const { fightId: _id, ...reste } = p;
    Object.assign(cible, reste);
    cible.version += 1;
  }
  for (const w of plan.propagation) {
    const cible = out.find((f) => f.id === w.fightId);
    if (!cible) continue;
    if (w.slot === "A") cible.slotA = w.registrationId;
    else cible.slotB = w.registrationId;
    cible.version += 1;
  }
  return out;
}

type Trois = {
  fights: PropagationFight[];
  demie: PropagationFight;
  repechage: PropagationFight;
  finale: PropagationFight;
};

/**
 * Un vrai tirage à trois. Le générateur pose le repêchage à l'index 0 (la case
 * du bye) ; rien ne le GARANTIT, donc l'index 1 est éprouvé aussi.
 */
function trois(repechageALIndex: 0 | 1 = 0): Trois {
  const res = generateBracket(entrees(3), "graine-3", { thirdPlaceMode: "pool3" });
  if (res.kind !== "bracket") throw new Error("tableau attendu");
  const fights = fromGenerated(res.fights).map((f) => ({
    ...f,
    id: f.type === "BraketFightRepechage3" ? "rep" : f.division === 2 ? "demie" : `f${f.division}`,
    indexInDivision:
      f.division !== 2
        ? f.indexInDivision
        : f.type === "BraketFightRepechage3"
          ? repechageALIndex
          : 1 - repechageALIndex,
  }));
  const par = (id: string) => fights.find((f) => f.id === id)!;
  return { fights, demie: par("demie"), repechage: par("rep"), finale: par("f1") };
}

const lire = (fights: PropagationFight[], id: string) => fights.find((f) => f.id === id)!;

// -------------------------------------------------------------------
// TROU #1
// -------------------------------------------------------------------

describe("trou #1 : le perdant de la 1re demi-finale descend dans la 2e", () => {
  for (const index of [0, 1] as const) {
    it(`planFinish(demie) écrit le perdant en A de la 2e DF (repêchage à l'index ${index})`, () => {
      const { fights, demie } = trois(index);
      const [vainqueur, perdant] = [demie.slotA!, demie.slotB!];
      const plan = planFinish(fights, demie.id, vainqueur, "points");
      expect(plan.propagation).toContainEqual({
        fightId: "rep",
        slot: "A",
        registrationId: perdant,
      });
      // L'attendu optimiste couvre la case : sans elle, deux gestes pourraient
      // écrire la 2e DF sans que le second s'en aperçoive.
      expect(plan.expected.map((e) => e.fightId)).toContain("rep");
      const apres = appliquer(fights, plan);
      expect(lire(apres, "rep").slotA).toBe(perdant);
      // Et le vainqueur monte en finale, du côté de son index.
      const cote = index === 0 ? "slotB" : "slotA";
      expect(lire(apres, "f1")[cote]).toBe(vainqueur);
    });
  }

  it("un perdant ÉLIMINÉ ne descend pas (miroir de day_fight_finish)", () => {
    const { fights, demie } = trois();
    const perdant = demie.slotB!;
    const plan = planFinish(fights, demie.id, demie.slotA!, "points", new Set([perdant]));
    expect(plan.propagation.find((w) => w.fightId === "rep" && w.slot === "A")).toBeUndefined();
    expect(lire(appliquer(fights, plan), "rep").slotA).toBeNull();
  });

  it("planUndoForfeit sur la 1re DF vide la case A de la 2e DF", () => {
    const { fights, demie } = trois();
    const joue = appliquer(fights, planFinish(fights, demie.id, demie.slotA!, "wo"));
    expect(lire(joue, "rep").slotA).toBe(demie.slotB);
    const annule = appliquer(joue, planUndoForfeit(joue, demie.id));
    expect(lire(annule, "rep").slotA).toBeNull();
    expect(lire(annule, "demie").state).toBe("scheduled");
  });

  it("findRepechage3Slot reste la seule règle : aucune descente sans 2e DF", () => {
    const res = generateBracket(entrees(4), "graine-4", { thirdPlaceMode: "shared_bronze" });
    if (res.kind !== "bracket") throw new Error("tableau attendu");
    const fights = fromGenerated(res.fights);
    const demie = fights.find((f) => f.division === 2 && f.type === "BraketFight")!;
    expect(findRepechage3Slot(fights, demie)).toBeNull();
    const plan = planFinish(fights, demie.id, demie.slotA!, "points");
    // Seule la montée du vainqueur est écrite.
    expect(plan.propagation).toHaveLength(1);
  });
});

// -------------------------------------------------------------------
// TROU #3
// -------------------------------------------------------------------

describe("trou #3 : la 2e demi-finale est un nourricier", () => {
  it("findFeederFight : finale.A = 2e DF, finale.B = 1re DF, 2e DF.A = 1re DF, 2e DF.B = aucun", () => {
    const { fights, finale, repechage } = trois();
    expect(findFeederFight(fights, finale, "A")?.id).toBe("rep");
    expect(findFeederFight(fights, finale, "B")?.id).toBe("demie");
    expect(findFeederFight(fights, repechage, "A")?.id).toBe("demie");
    expect(findFeederFight(fights, repechage, "B")).toBeNull();
  });

  it("repêchage à l'index 1 : l'arithmétique suit l'index, comme jour_j_feeder_fight", () => {
    const { fights, finale, repechage } = trois(1);
    expect(findFeederFight(fights, finale, "A")?.id).toBe("demie");
    expect(findFeederFight(fights, finale, "B")?.id).toBe("rep");
    expect(findFeederFight(fights, repechage, "A")?.id).toBe("demie");
  });

  for (const fin of [
    { state: "finished", winMethod: "double_wo" },
    { state: "cancelled", winMethod: null },
  ] as const) {
    it(`isSlotImpossible(finale, A) si la 2e DF est ${fin.winMethod ?? fin.state}`, () => {
      const { fights, finale } = trois();
      const etat = fights.map((f) =>
        f.id === "rep" ? { ...f, state: fin.state, winMethod: fin.winMethod, winner: null } : f,
      );
      expect(isSlotImpossible(etat, finale, "A")).toBe(true);
      // Une 2e DF à venir n'est pas impossible : on attend.
      expect(isSlotImpossible(fights, finale, "A")).toBe(false);
    });
  }

  for (const methode of ["wo", "double_wo"] as const) {
    it(`isSlotImpossible(2e DF, A) si la 1re DF est ${methode}`, () => {
      const { fights, demie, repechage } = trois();
      const etat = fights.map((f) =>
        f.id === "demie"
          ? {
              ...f,
              state: "finished" as const,
              winMethod: methode,
              winner: methode === "wo" ? demie.slotA : null,
            }
          : f,
      );
      expect(isSlotImpossible(etat, repechage, "A")).toBe(true);
    });
  }

  it("isSlotImpossible(2e DF, A) si la 1re DF est annulée, ou si son perdant est éliminé", () => {
    const { fights, demie, repechage } = trois();
    const annulee = fights.map((f) =>
      f.id === "demie" ? { ...f, state: "cancelled" as const } : f,
    );
    expect(isSlotImpossible(annulee, repechage, "A")).toBe(true);

    const jouee = appliquer(fights, planFinish(fights, demie.id, demie.slotA!, "points"));
    expect(isSlotImpossible(jouee, repechage, "A")).toBe(false);
    expect(isSlotImpossible(jouee, repechage, "A", new Set([demie.slotB!]))).toBe(true);
    // Le côté B (le 3e, posé au tirage) n'est jamais impossible.
    expect(isSlotImpossible(jouee, repechage, "B", new Set([demie.slotB!]))).toBe(false);
  });
});

// -------------------------------------------------------------------
// SCÉNARIOS DU REGISTRE (TR1.2) — propagation seulement, le podium relève de L5
// -------------------------------------------------------------------

describe("les scénarios TR1 du registre", () => {
  function joueDemie(t: Trois, eliminated = new Set<string>()) {
    return appliquer(t.fights, planFinish(t.fights, "demie", t.demie.slotA!, "points", eliminated));
  }

  it("(a) C éliminé AVANT la 1re DF, puis la 1re DF est jouée : le perdant gagne la 2e DF par WO", () => {
    const t = trois();
    const [a, b, c] = [t.demie.slotA!, t.demie.slotB!, t.repechage.slotB!];
    const elimines = new Set([c]);
    // L'élimination seule ne solde rien : la case A de la 2e DF attend la 1re.
    const avant = appliquer(t.fights, planForfeit(t.fights, elimines));
    expect(lire(avant, "rep").state).toBe("scheduled");

    const apres = appliquer(avant, planFinish(avant, "demie", a, "points", elimines));
    const rep = lire(apres, "rep");
    expect(rep).toMatchObject({ state: "finished", winMethod: "wo", winner: b });
    expect(lire(apres, "f1")).toMatchObject({ slotA: b, slotB: a, state: "scheduled" });
  });

  it("(b) C éliminé APRÈS la 1re DF : même résultat, la finale est jouée", () => {
    const t = trois();
    const [a, b, c] = [t.demie.slotA!, t.demie.slotB!, t.repechage.slotB!];
    const joue = joueDemie(t);
    const apres = appliquer(joue, planForfeit(joue, new Set([c])));
    expect(lire(apres, "rep")).toMatchObject({ state: "finished", winMethod: "wo", winner: b });
    expect(lire(apres, "f1")).toMatchObject({ slotA: b, slotB: a, state: "scheduled" });
  });

  it("(c) un athlète de la 1re DF éliminé sans combattre : C gagne la 2e DF par WO, finale jouée", () => {
    const t = trois();
    const [a, b, c] = [t.demie.slotA!, t.demie.slotB!, t.repechage.slotB!];
    const apres = appliquer(t.fights, planForfeit(t.fights, new Set([a])));
    expect(lire(apres, "demie")).toMatchObject({ state: "finished", winMethod: "wo", winner: b });
    // L'éliminé n'a pas droit à la 2e DF : sa case reste vide, et impossible.
    expect(lire(apres, "rep")).toMatchObject({
      slotA: null,
      state: "finished",
      winMethod: "wo",
      winner: c,
    });
    expect(lire(apres, "f1")).toMatchObject({ slotA: c, slotB: b, state: "scheduled" });
  });

  it("(d) double forfait à la 1re DF : C gagne la 2e DF puis la finale par WO", () => {
    const t = trois();
    const [a, b, c] = [t.demie.slotA!, t.demie.slotB!, t.repechage.slotB!];
    const apres = appliquer(t.fights, planForfeit(t.fights, new Set([a, b])));
    expect(lire(apres, "demie")).toMatchObject({ winMethod: "double_wo", winner: null });
    expect(lire(apres, "rep")).toMatchObject({ state: "finished", winMethod: "wo", winner: c });
    expect(lire(apres, "f1")).toMatchObject({
      state: "finished",
      winMethod: "wo",
      winner: c,
      // Soldée, elle n'attend plus d'arbitrage (needs_arbitration = false en SQL).
      needsArbitration: false,
    });
  });

  it("(e) double forfait à la 2e DF après une 1re DF jouée : le vainqueur de la 1re gagne la finale par WO", () => {
    const t = trois();
    const [a, b, c] = [t.demie.slotA!, t.demie.slotB!, t.repechage.slotB!];
    const joue = joueDemie(t);
    const apres = appliquer(joue, planForfeit(joue, new Set([b, c])));
    expect(lire(apres, "rep")).toMatchObject({ winMethod: "double_wo", winner: null });
    expect(lire(apres, "f1")).toMatchObject({ state: "finished", winMethod: "wo", winner: a });
  });

  it("aucun podium ne reste bloqué sur un message « Repêchage »", () => {
    const t = trois();
    const c = classementOfficiel({ fights: t.fights, thirdPlaceMode: "pool3" });
    expect(c.manquant).toContain("2e demi-finale non terminée");
    expect(c.manquant.join(" ")).not.toMatch(/rep[êe]chage/i);
  });
});

// -------------------------------------------------------------------
// CASCADE SANS FILTRE DE TYPE (miroir de jour_j_forfait_cascade)
// -------------------------------------------------------------------

describe("la cascade traite la 2e DF et le combat de 3e place comme tout combat", () => {
  it("(classique) une 2e DF aux deux côtés connus avec un éliminé se solde par WO", () => {
    const t = trois();
    const joue = appliquer(t.fights, planFinish(t.fights, "demie", t.demie.slotA!, "points"));
    const plan = planForfeit(joue, new Set([t.demie.slotB!]));
    expect(lire(appliquer(joue, plan), "rep")).toMatchObject({
      state: "finished",
      winMethod: "wo",
      winner: t.repechage.slotB,
      cascadeForfeit: true,
    });
  });

  it("(a) un WO de cascade sur la 2e DF est RÉVOQUÉ si son vainqueur est éliminé ensuite", () => {
    const t = trois();
    const [a, b, c] = [t.demie.slotA!, t.demie.slotB!, t.repechage.slotB!];
    let etat = appliquer(t.fights, planFinish(t.fights, "demie", a, "points"));
    etat = appliquer(etat, planForfeit(etat, new Set([c])));
    expect(lire(etat, "rep").winner).toBe(b);
    expect(lire(etat, "f1").slotA).toBe(b);

    etat = appliquer(etat, planForfeit(etat, new Set([c, b])));
    expect(lire(etat, "rep")).toMatchObject({ winMethod: "double_wo", winner: null });
    // Le fantôme quitte la finale, qui se solde alors pour le vainqueur de la 1re DF.
    expect(lire(etat, "f1")).toMatchObject({ state: "finished", winMethod: "wo", winner: a });
  });

  it("(classique) un combat de 3e place aux deux côtés connus avec un éliminé se solde par WO", () => {
    const res = generateBracket(entrees(4), "graine-4", { thirdPlaceMode: "pool3" });
    if (res.kind !== "bracket") throw new Error("tableau attendu");
    let etat = fromGenerated(res.fights);
    for (const demie of etat.filter((f) => f.division === 2 && f.type === "BraketFight")) {
      etat = appliquer(etat, planFinish(etat, demie.id, demie.slotA!, "points"));
    }
    const p3 = etat.find((f) => f.type === "BraketFightPool3")!;
    expect(p3.slotA && p3.slotB).toBeTruthy();
    const apres = appliquer(etat, planForfeit(etat, new Set([p3.slotA!])));
    expect(apres.find((f) => f.id === p3.id)).toMatchObject({
      state: "finished",
      winMethod: "wo",
      winner: p3.slotB,
    });
  });
});

// -------------------------------------------------------------------
// PARITÉ AVEC LA SONDE SQL (db/audit/validate-migrations.ts, 4sexies-quinquies)
// -------------------------------------------------------------------

describe("parité avec la sonde SQL du repêchage", () => {
  it("routes b/a/a, nourriciers, puis la journée jouée comme dans la sonde", () => {
    // La sonde pose : demie (2,1) r1 contre r2 ; repêchage (2,0) vide contre r3 ;
    // finale (1,0) vide. Elle attend les routes b/a/a et les nourriciers
    // finale.a = repêchage, finale.b = demie, repêchage.b = null.
    const { fights, demie, repechage, finale } = trois();
    expect(findNextSlot(fights, demie)).toEqual({ fightId: "f1", slot: "B" });
    expect(findNextSlot(fights, repechage)).toEqual({ fightId: "f1", slot: "A" });
    expect(findRepechage3Slot(fights, demie)).toEqual({ fightId: "rep", slot: "A" });
    expect(findFeederFight(fights, finale, "A")?.id).toBe("rep");
    expect(findFeederFight(fights, finale, "B")?.id).toBe("demie");
    expect(findFeederFight(fights, repechage, "B")).toBeNull();

    // (b) la demie : A gagne. Le perdant descend en A du repêchage, le vainqueur en B de la finale.
    let etat = appliquer(fights, planFinish(fights, "demie", demie.slotA!, "points"));
    expect(lire(etat, "rep").slotA).toBe(demie.slotB);
    expect(lire(etat, "f1").slotB).toBe(demie.slotA);
    // (c) le repêchage : B (le 3e) gagne et monte en A de la finale.
    etat = appliquer(etat, planFinish(etat, "rep", repechage.slotB!, "points"));
    expect(lire(etat, "f1").slotA).toBe(repechage.slotB);
    // (d) deux combats terminés avant la finale.
    expect(etat.filter((f) => f.state === "finished")).toHaveLength(2);
  });
});

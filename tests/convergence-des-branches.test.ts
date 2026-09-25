import { describe, expect, it } from "vitest";
import type { GeneratedFight } from "../src/bracket-generator";
import { structuralKey } from "../src/bracket-propagation";
import {
  branchesDuPlan,
  debutsPourRapprocherLesBranches,
  ecartDesBranchesMs,
  regrouperLesDerniersTours,
  toursDeRegroupement,
  type BrancheDuPlan,
  type CombatDeBranche,
} from "../src/convergence-des-branches";
import { partiesDuCombat, repartirLesCombats } from "../src/repartition-tatamis";
import { MINUTE, heure, tableau, tatamis } from "./aides-planning";

function combatsDe(fights: GeneratedFight[], prefixe = "c"): CombatDeBranche[] {
  return fights.map((f) => ({
    id: `${prefixe}:${structuralKey(f)}`,
    division: f.division,
    indexInDivision: f.indexInDivision,
    type: f.type,
    isBye: f.isBye,
  }));
}

/** Le tatami de chaque combat selon la convergence progressive par défaut (PL1.4 C). */
function convergenceParDefaut(combats: CombatDeBranche[], parties: number): Map<string, string> {
  const places = repartirLesCombats({ tatamis: tatamis(parties), combats });
  return new Map([...places.values()].map((p) => [p.fightId, p.tatamiId] as const));
}

describe("les tours de regroupement avant la finale (REP.5 C)", () => {
  it("aucun à une ou deux parties, les demi-finales à trois ou quatre, quarts et demies à huit", () => {
    const seize = combatsDe(tableau(16));
    expect(toursDeRegroupement(seize, 1)).toBe(0);
    expect(toursDeRegroupement(seize, 2)).toBe(0);
    expect(toursDeRegroupement(seize, 3)).toBe(1);
    expect(toursDeRegroupement(seize, 4)).toBe(1);
    expect(toursDeRegroupement(seize, 8)).toBe(2);
    expect(toursDeRegroupement(seize, 9)).toBe(0);
  });
});

describe("regrouper les derniers tours sur le tatami de la finale (REP.5 C)", () => {
  it("à quatre parties, les deux demi-finales passent sur le tatami de la finale ; les branches ne bougent pas", () => {
    const combats = combatsDe(tableau(16));
    const avant = convergenceParDefaut(combats, 4);
    const finale = combats.find((c) => c.division === 1)!;
    const demies = combats.filter((c) => c.division === 2);
    const tatamiFinale = avant.get(finale.id)!;
    // Témoin : par défaut, l'une des demi-finales se joue ailleurs que la finale.
    expect(demies.some((d) => avant.get(d.id) !== tatamiFinale)).toBe(true);

    const apres = regrouperLesDerniersTours(combats, 4, avant, 1);
    for (const d of demies) expect(apres.get(d.id)).toBe(tatamiFinale);
    expect(apres.get(finale.id)).toBe(tatamiFinale);
    for (const c of combats.filter((x) => x.division > 2)) {
      expect(apres.get(c.id)).toBe(avant.get(c.id));
    }
  });

  it("à huit parties, un tour regroupe les demi-finales, deux regroupent aussi les quarts", () => {
    const combats = combatsDe(tableau(32));
    const avant = convergenceParDefaut(combats, 8);
    const tatamiFinale = avant.get(combats.find((c) => c.division === 1)!.id)!;
    const sur = (m: Map<string, string>, division: number) =>
      new Set(combats.filter((c) => c.division === division).map((c) => m.get(c.id)));

    const un = regrouperLesDerniersTours(combats, 8, avant, 1);
    expect(sur(un, 2)).toEqual(new Set([tatamiFinale]));
    expect(sur(un, 3)).toEqual(sur(avant, 3));
    expect(sur(avant, 3).size).toBeGreaterThan(1);

    const deux = regrouperLesDerniersTours(combats, 8, avant, 2);
    expect(sur(deux, 2)).toEqual(new Set([tatamiFinale]));
    expect(sur(deux, 3)).toEqual(new Set([tatamiFinale]));
    // Le premier tour reste dans ses huit branches.
    expect(sur(deux, 4)).toEqual(sur(avant, 4));
  });

  it("à trois parties, seule la demi-finale qui réunit les deux quarts de tableau bouge", () => {
    const combats = combatsDe(tableau(16));
    const avant = convergenceParDefaut(combats, 3);
    const apres = regrouperLesDerniersTours(combats, 3, avant, 1);
    const tatamiFinale = avant.get(combats.find((c) => c.division === 1)!.id)!;
    for (const c of combats) {
      const regroupement = c.division === 2 && partiesDuCombat(c, 3).convergence;
      expect(apres.get(c.id)).toBe(regroupement ? tatamiFinale : avant.get(c.id));
    }
  });

  it("rend le plan tel quel sans tour à regrouper, sans répartition ou sans finale placée", () => {
    const combats = combatsDe(tableau(16));
    const avant = convergenceParDefaut(combats, 4);
    expect(regrouperLesDerniersTours(combats, 4, avant, 0)).toEqual(avant);
    expect(regrouperLesDerniersTours(combats, 1, avant, 1)).toEqual(avant);
    const sansFinale = new Map(avant);
    sansFinale.delete(combats.find((c) => c.division === 1)!.id);
    expect(regrouperLesDerniersTours(combats, 4, sansFinale, 1)).toEqual(sansFinale);
  });
});

describe("les branches d'une catégorie répartie et leur rapprochement (REP.6 A)", () => {
  const combats = combatsDe(tableau(8));
  // Deux parties : les quarts 0-1 et 2-3, les demi-finales dans leur partie, la finale réunit.
  const horaires = new Map<string, { debutMs: number; finMs: number }>();
  const poser = (division: number, index: number, debut: string) => {
    const c = combats.find((x) => x.division === division && x.indexInDivision === index)!;
    horaires.set(c.id, { debutMs: heure(debut), finMs: heure(debut) + 5 * MINUTE });
  };
  poser(3, 0, "09:00");
  poser(3, 1, "09:07");
  poser(2, 0, "09:20");
  poser(3, 2, "09:00");
  poser(3, 3, "10:00");
  poser(2, 1, "10:40");
  poser(1, 0, "11:00");

  it("lit le début et la fin de chaque branche, hors regroupement", () => {
    const branches = branchesDuPlan(combats, 2, horaires);
    expect(branches).toEqual([
      { partie: 0, debutMs: heure("09:00"), finMs: heure("09:25"), combats: 3 },
      { partie: 1, debutMs: heure("09:00"), finMs: heure("10:45"), combats: 3 },
    ]);
    expect(ecartDesBranchesMs(branches)).toBe(80 * MINUTE);
    expect(branchesDuPlan(combats, 1, horaires)).toEqual([]);
    expect(ecartDesBranchesMs(branches.slice(0, 1))).toBe(0);
  });

  it("décale le début de la branche en avance de son avance, ou d'une fraction ; la plus tardive ne bouge pas", () => {
    const branches = branchesDuPlan(combats, 2, horaires);
    expect(debutsPourRapprocherLesBranches(branches)).toEqual(
      new Map([[0, heure("09:00") + 80 * MINUTE]]),
    );
    expect(debutsPourRapprocherLesBranches(branches, { fraction: 0.5 })).toEqual(
      new Map([[0, heure("09:00") + 40 * MINUTE]]),
    );
  });

  it("ne propose rien sous la marge, sous deux branches, ni pour des branches déjà ensemble", () => {
    const proches: BrancheDuPlan[] = [
      { partie: 0, debutMs: heure("09:00"), finMs: heure("10:00"), combats: 3 },
      { partie: 1, debutMs: heure("09:00"), finMs: heure("10:04"), combats: 3 },
    ];
    expect(debutsPourRapprocherLesBranches(proches, { margeMs: 5 * MINUTE }).size).toBe(0);
    expect(debutsPourRapprocherLesBranches(proches).size).toBe(1);
    expect(debutsPourRapprocherLesBranches(proches.slice(0, 1)).size).toBe(0);
    const ensemble = proches.map((b) => ({ ...b, finMs: heure("10:00") }));
    expect(debutsPourRapprocherLesBranches(ensemble).size).toBe(0);
  });
});

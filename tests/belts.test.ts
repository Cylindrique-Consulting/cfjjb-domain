import { describe, expect, it } from "vitest";
import {
  ALL_BELTS,
  BELT_AGE_BOUNDS,
  BELT_COLORS,
  BELT_LABELS,
  BELT_RANK_ORDER,
  HIDDEN_BELTS,
  KIDS_BELTS,
} from "../src/belts";
import type { BeltDb } from "../src/enums";

/**
 * CYL-483 — la confédération ne gère aucun grade au-dessus de la noire.
 *
 * Deux listes cohabitent volontairement, et c'est tout l'enjeu : `ALL_BELTS`
 * peuple les choix (elle s'arrête à la noire), `BELT_RANK_ORDER` donne le rang
 * (elle garde les 11 grades de l'enum). Les confondre casse dans un sens ou
 * dans l'autre — corail réapparaît à l'écran, ou un `indexOf` rend -1 sur une
 * donnée héritée.
 *
 * Ce verrou tient la relation entre les deux. `ALL_BELTS` est écrite en toutes
 * lettres dans la source, et non dérivée par filtrage : sans quoi ce fichier
 * ne vérifierait qu'une tautologie.
 */
describe("les grades masqués (CYL-483)", () => {
  it("ALL_BELTS n'expose aucun grade masqué et s'arrête à la noire", () => {
    for (const hidden of HIDDEN_BELTS) {
      expect(ALL_BELTS).not.toContain(hidden);
    }
    expect(ALL_BELTS[ALL_BELTS.length - 1]).toBe("black");
  });

  it("BELT_RANK_ORDER garde les grades masqués, après la noire", () => {
    for (const hidden of HIDDEN_BELTS) {
      expect(BELT_RANK_ORDER).toContain(hidden);
      expect(BELT_RANK_ORDER.indexOf(hidden)).toBeGreaterThan(BELT_RANK_ORDER.indexOf("black"));
    }
  });

  it("ALL_BELTS est exactement BELT_RANK_ORDER privée des grades masqués, dans le même ordre", () => {
    expect([...ALL_BELTS]).toEqual(BELT_RANK_ORDER.filter((b) => !HIDDEN_BELTS.includes(b)));
  });

  it("les ceintures enfants restent un sous-ensemble des grades gérés", () => {
    for (const belt of KIDS_BELTS) {
      expect(ALL_BELTS).toContain(belt);
    }
  });

  /**
   * Les tables d'affichage restent EXHAUSTIVES sur `BeltDb`. Une fiche héritée
   * portant un grade masqué doit encore s'afficher : masquer un grade, ce
   * n'est pas rendre `undefined` là où la donnée existe.
   */
  it("libellé, couleur et bornes d'âge couvrent encore les grades masqués", () => {
    for (const belt of BELT_RANK_ORDER as ReadonlyArray<BeltDb>) {
      expect(BELT_LABELS[belt]).toBeTruthy();
      expect(BELT_COLORS[belt]).toMatch(/^#[0-9a-f]{6}$/i);
      expect(BELT_AGE_BOUNDS[belt]).toBeDefined();
    }
  });
});

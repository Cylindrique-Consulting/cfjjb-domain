import { describe, expect, it } from "vitest";
import {
  MEDIDO_ITEM_HINT,
  MEDIDO_ITEM_LABEL,
  MEDIDO_ITEMS,
  medidoOverall,
  validateMedidoChecks,
  type MedidoChecks,
} from "../src/medido";

describe("la jauge a quatre points, et pas un vocabulaire libre", () => {
  it("expose exactement les quatre points décidés", () => {
    // Décision fédérale du 17/08/2026. Le compte est asséré pour qu'un cinquième
    // point ajouté sans décision se voie, plutôt que d'apparaître dans un écran.
    expect(MEDIDO_ITEMS).toEqual(["manche", "col", "pantalon", "ecussons"]);
  });

  it("chaque point a un libellé ET une explication", () => {
    // Un bénévole qui prend la jauge pour la première fois ne sait pas ce que
    // « pantalon » désigne. Sans explication à l'écran, c'est le commissaire
    // voisin qui l'explique — et deux commissaires expliqueront deux choses.
    for (const i of MEDIDO_ITEMS) {
      expect(MEDIDO_ITEM_LABEL[i], i).toBeTruthy();
      expect(MEDIDO_ITEM_HINT[i]?.length ?? 0, i).toBeGreaterThan(15);
    }
  });

  it("ne porte AUCUN seuil en centimètres", () => {
    // Les cotes de la jauge sont un document fédéral qui change sans que ce dépôt
    // en soit informé : un seuil recopié ici deviendrait faux en silence. Le
    // commissaire mesure et tranche, le système enregistre ce qu'il a tranché.
    const source = JSON.stringify({ MEDIDO_ITEM_LABEL, MEDIDO_ITEM_HINT });
    expect(source).not.toMatch(/\d+\s?(cm|mm)/);
  });
});

describe("une clé inconnue est refusée, pas nettoyée en silence", () => {
  it("accepte un dictionnaire valide", () => {
    expect(validateMedidoChecks({ manche: "conforme", col: "non_conforme" })).toEqual([]);
    expect(validateMedidoChecks({})).toEqual([]);
    expect(validateMedidoChecks(null)).toEqual([]);
  });

  it("refuse un point de contrôle inconnu", () => {
    // « sleeve » au lieu de « manche » est exactement la divergence qu'on
    // empêche : supprimer la clé en silence ferait perdre la mesure sans que
    // personne ne le sache.
    const p = validateMedidoChecks({ sleeve: "conforme" });
    expect(p).toHaveLength(1);
    expect(p[0]).toContain("sleeve");
  });

  it("refuse un verdict invalide", () => {
    expect(validateMedidoChecks({ manche: "ok" })[0]).toContain("manche");
    expect(validateMedidoChecks({ manche: true })).toHaveLength(1);
  });

  it("refuse ce qui n'est pas un objet", () => {
    for (const v of ["texte", 42, ["manche"], true]) {
      expect(validateMedidoChecks(v).length, JSON.stringify(v)).toBeGreaterThan(0);
    }
  });
});

describe("le verdict d'ensemble ne compense pas et ne suppose rien", () => {
  it("un seul point non conforme refuse le kimono", () => {
    // Pas de moyenne, pas de compensation : trois points bons et un mauvais font
    // un kimono non conforme.
    const c: MedidoChecks = {
      manche: "conforme",
      col: "conforme",
      pantalon: "conforme",
      ecussons: "non_conforme",
    };
    expect(medidoOverall(c)).toBe("non_conforme");
  });

  it("un contrôle VIDE ne vaut pas conforme", () => {
    // Le piège central : hériter d'un « conforme » par défaut ferait monter sur le
    // tapis un athlète que personne n'a regardé.
    expect(medidoOverall({})).toBeNull();
    expect(medidoOverall({ manche: "non_mesure", col: "non_mesure" })).toBeNull();
  });

  it("les points non mesurés ne bloquent pas ceux qui sont conformes", () => {
    // Un kimono bon sur la manche, le col et le pantalon n'attend pas les
    // écussons pour combattre.
    expect(medidoOverall({ manche: "conforme", ecussons: "non_mesure" })).toBe("conforme");
  });

  it("un refus l'emporte même si le reste n'est pas mesuré", () => {
    expect(medidoOverall({ manche: "non_conforme", col: "non_mesure" })).toBe("non_conforme");
  });
});

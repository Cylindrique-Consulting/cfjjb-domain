import { describe, expect, it } from "vitest";
import {
  canStartFight,
  controlStateOf,
  controlStateReason,
  type ControlInput,
  type ControlState,
  type MedidoStatus,
  type PresenceStatus,
  type WeighInStatus,
} from "../src/control-state";

/**
 * « Ce combattant peut-il combattre ? » sur le PRODUIT CARTÉSIEN complet.
 *
 * Cette fonction est le seul endroit qui joint les trois postes du jour J
 * (pointage, pesée, medido). Un trou dans sa table de vérité laisse la table de
 * marque improviser, et improviser au bord du tapis veut dire lancer un combat
 * contre quelqu'un d'éliminé.
 */

const PRESENCES: PresenceStatus[] = ["expected", "present", "absent", "withdrawn_onsite"];
const PESEES: WeighInStatus[] = ["pending", "passed", "failed", "waived", "absent"];
const MEDIDOS: MedidoStatus[] = ["pending", "conforme", "non_conforme", "non_presente"];
const TOUT_REQUIS = { presence: true, weighIn: true, medido: true } as const;

function entree(over: Partial<ControlInput> = {}): ControlInput {
  return {
    discipline: "gi",
    requirements: TOUT_REQUIS,
    presence: "present",
    weighIn: "passed",
    medido: "conforme",
    ...over,
  };
}

describe("controlStateOf — le cas nominal", () => {
  it("rend `ok` quand les trois contrôles sont faits", () => {
    expect(controlStateOf(entree())).toBe("ok");
  });

  it("rend `ok` sur une pesée dispensée : c'est une décision, pas une attente", () => {
    expect(controlStateOf(entree({ weighIn: "waived" }))).toBe("ok");
  });
});

describe("controlStateOf — `elimine` DOMINE tout", () => {
  it("un hors-poids qui n'a pas fait son medido est éliminé, pas en attente", () => {
    // Afficher « en attente de medido » ferait faire un poste à quelqu'un qui ne
    // combattra pas.
    expect(controlStateOf(entree({ weighIn: "failed", medido: "pending" }))).toBe("elimine");
  });

  it("un absent est éliminé même si tout le reste est en ordre", () => {
    expect(controlStateOf(entree({ presence: "absent" }))).toBe("elimine");
  });

  it("un désistement sur site élimine", () => {
    expect(controlStateOf(entree({ presence: "withdrawn_onsite" }))).toBe("elimine");
  });

  it("un forfait prononcé par le commissaire élimine, quel que soit le reste", () => {
    expect(controlStateOf(entree({ forfeited: true, presence: "present" }))).toBe("elimine");
  });

  it("BALAYAGE — `elimine` gagne sur toutes les combinaisons quand la pesée a échoué", () => {
    for (const presence of PRESENCES) {
      if (presence === "absent" || presence === "withdrawn_onsite") continue;
      for (const medido of MEDIDOS) {
        expect(
          controlStateOf(entree({ presence, medido, weighIn: "failed" })),
          `${presence}/${medido}`,
        ).toBe("elimine");
      }
    }
  });
});

describe("controlStateOf — l'asymétrie poids / kimono", () => {
  it("un gabarit non conforme BLOQUE sans éliminer", () => {
    // Le poids est définitif, le kimono est réparable : l'athlète en change et
    // repasse. Si personne ne revient, c'est le commissaire qui prononce le
    // forfait — la station rapporte un fait, elle ne décide pas.
    expect(controlStateOf(entree({ medido: "non_conforme" }))).toBe("bloque_gi");
  });

  it("un hors-poids ÉLIMINE", () => {
    expect(controlStateOf(entree({ weighIn: "failed" }))).toBe("elimine");
  });

  it("le medido ne s'applique PAS au No-Gi : il n'y a pas de kimono à mesurer", () => {
    expect(controlStateOf(entree({ discipline: "nogi", medido: "non_conforme" }))).toBe("ok");
    expect(controlStateOf(entree({ discipline: "nogi", medido: "pending" }))).toBe("ok");
  });

  it("une compétition sans poste de medido n'attend rien de ce côté", () => {
    expect(
      controlStateOf(
        entree({
          requirements: { presence: true, weighIn: true, medido: false },
          medido: "pending",
        }),
      ),
    ).toBe("ok");
  });
});

describe("controlStateOf — les attentes, dans l'ordre des postes", () => {
  it("le pointage passe avant la pesée", () => {
    expect(controlStateOf(entree({ presence: "expected", weighIn: "pending" }))).toBe(
      "attente_pointage",
    );
  });

  it("la pesée passe avant le medido", () => {
    expect(controlStateOf(entree({ weighIn: "pending", medido: "pending" }))).toBe("attente_pesee");
  });

  it("le medido en dernier", () => {
    expect(controlStateOf(entree({ medido: "pending" }))).toBe("attente_medido");
  });

  it("« ne s'est pas présenté au medido » est une attente, pas une élimination", () => {
    expect(controlStateOf(entree({ medido: "non_presente" }))).toBe("attente_medido");
  });
});

describe("controlStateOf — BALAYAGE du produit cartésien complet", () => {
  it("rend toujours un état connu, sur les 160 combinaisons", () => {
    const connus: ControlState[] = [
      "elimine",
      "bloque_gi",
      "attente_pointage",
      "attente_pesee",
      "attente_medido",
      "ok",
    ];
    let n = 0;
    for (const discipline of ["gi", "nogi"] as const) {
      for (const presence of PRESENCES) {
        for (const weighIn of PESEES) {
          for (const medido of MEDIDOS) {
            const etat = controlStateOf(entree({ discipline, presence, weighIn, medido }));
            expect(connus, `${discipline}/${presence}/${weighIn}/${medido}`).toContain(etat);
            n++;
          }
        }
      }
    }
    // Garde anti-balayage-vide : une boucle cassée rendrait ce test trivialement
    // vert en n'ayant rien parcouru.
    expect(n).toBe(2 * 4 * 5 * 4);
  });

  it("aucune combinaison ne rend `ok` avec un contrôle requis non fait", () => {
    for (const presence of PRESENCES) {
      for (const weighIn of PESEES) {
        for (const medido of MEDIDOS) {
          const etat = controlStateOf(entree({ presence, weighIn, medido }));
          if (etat !== "ok") continue;
          expect(presence).toBe("present");
          expect(["passed", "waived"]).toContain(weighIn);
          expect(medido).toBe("conforme");
        }
      }
    }
  });
});

describe("canStartFight", () => {
  it("exige que les DEUX combattants soient en état `ok`", () => {
    expect(canStartFight("ok", "ok")).toBe(true);
    expect(canStartFight("ok", "attente_pesee")).toBe(false);
    expect(canStartFight("bloque_gi", "ok")).toBe(false);
    expect(canStartFight("elimine", "elimine")).toBe(false);
  });
});

describe("controlStateReason", () => {
  it("donne un motif lisible pour chaque refus, et rien pour `ok`", () => {
    expect(controlStateReason("ok")).toBeNull();
    for (const etat of [
      "elimine",
      "bloque_gi",
      "attente_pointage",
      "attente_pesee",
      "attente_medido",
    ] as const) {
      const motif = controlStateReason(etat);
      // Le motif s'affiche sur la table de marque : un refus muet ferait
      // chercher la panne à l'opérateur.
      expect(motif, etat).toBeTruthy();
      expect(motif!.length, etat).toBeGreaterThan(8);
    }
  });
});

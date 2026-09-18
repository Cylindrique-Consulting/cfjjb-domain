import { describe, expect, it } from "vitest";
import {
  CODES_SANCTION,
  ISSUES_DE_REFUS,
  LIBELLES_MOMENT,
  MOMENTS_DE_FAUTE,
  ORIGINES_SANCTION,
  STATUTS_SANCTION,
  estCodeSanction,
  libelleCodeSanction,
  libellePublicDeSanction,
  libelleStaffDeSanction,
  statutDisciplinaireDeLaSanction,
} from "../src/sanctions-disciplinaires";
import { CAPABILITIES, canPerform, type Assignment, type StaffRole } from "../src/capabilities";
import { classementOfficiel } from "../src/podium-officiel";
import { tableauDeScenario } from "../src/arbitrage";
import type { PropagationFight } from "../src/bracket-propagation";

const poste = (role: StaffRole): Assignment => ({ role, tatamiScope: "all", tatamiIds: [] });

describe("le vocabulaire de la sanction disciplinaire", () => {
  it("porte les six articles nommés par le client, et rien d'autre", () => {
    expect([...CODES_SANCTION]).toEqual(["6.1.1", "6.1.2", "6.1.3", "6.1.4", "6.1.5", "6.1.6"]);
    expect(estCodeSanction("6.1.3")).toBe(true);
    expect(estCodeSanction("6.1.7")).toBe(false);
    expect(estCodeSanction("7.1")).toBe(false);
    expect(estCodeSanction(null)).toBe(false);
    expect(estCodeSanction(undefined)).toBe(false);
  });

  it("NE PRÉTEND PAS connaître le texte des articles", () => {
    // La fédération ne nous a transmis que les numéros (DQ2.6, DQ2.10). Six
    // phrases inventées seraient lues par un arbitre comme le règlement lui-même.
    for (const code of CODES_SANCTION) {
      expect(libelleCodeSanction(code)).toBe(`Article ${code}`);
    }
  });

  it("nomme les trois moments de la faute, les deux origines, les quatre statuts et les deux issues", () => {
    expect([...MOMENTS_DE_FAUTE]).toEqual(["avant", "pendant", "apres"]);
    expect(MOMENTS_DE_FAUTE.map((m) => LIBELLES_MOMENT[m])).toEqual([
      "avant le combat",
      "pendant le combat",
      "après le combat",
    ]);
    expect([...ORIGINES_SANCTION]).toEqual(["table", "hors_combat"]);
    expect([...STATUTS_SANCTION]).toEqual(["en_attente", "validee", "refusee", "annulee"]);
    expect([...ISSUES_DE_REFUS]).toEqual(["requalification", "reouverture"]);
  });
});

describe("le pont vers le moteur de classement", () => {
  it("un refus et une annulation RENDENT la place, une attente la suspend", () => {
    expect(statutDisciplinaireDeLaSanction("validee")).toBe("validee");
    expect(statutDisciplinaireDeLaSanction("en_attente")).toBe("en_attente");
    // DQ2.8 et DQ2.13 : le résultat et la place sont conservés.
    expect(statutDisciplinaireDeLaSanction("refusee")).toBe("aucune");
    expect(statutDisciplinaireDeLaSanction("annulee")).toBe("aucune");
    expect(statutDisciplinaireDeLaSanction(null)).toBe("aucune");
    expect(statutDisciplinaireDeLaSanction(undefined)).toBe("aucune");
  });

  it("le statut traduit décide vraiment de l'état rendu par classementOfficiel", () => {
    // LA SONDE QUI PROUVE QUE LE PONT SERT À QUELQUE CHOSE. Une finale gagnée sur
    // disqualification disciplinaire : tant que la sanction attend, la catégorie
    // n'est pas classable ; validée, elle l'est, sans le disqualifié.
    const finale: PropagationFight[] = tableauDeScenario(2).map((f) => ({
      ...f,
      state: "finished",
      winner: f.slotA,
      winMethod: "dq",
      dqReason: "disciplinaire",
    }));
    const eligibilite = (statut: Parameters<typeof statutDisciplinaireDeLaSanction>[0]) =>
      ["r1", "r2"].map((r) => ({
        registrationId: r,
        elimination: null,
        aCombattu: true,
        checkInValide: true,
        disciplinaire: r === "r2" ? statutDisciplinaireDeLaSanction(statut) : ("aucune" as const),
      }));

    const attente = classementOfficiel({
      fights: finale,
      thirdPlaceMode: "shared_bronze",
      eligibilite: eligibilite("en_attente"),
    });
    expect(attente.etat).toBe("disciplinaire_en_attente");

    const validee = classementOfficiel({
      fights: finale,
      thirdPlaceMode: "shared_bronze",
      eligibilite: eligibilite("validee"),
    });
    expect(validee.etat).toBe("complet");
    expect(validee.places.find((p) => p.rang === 1)?.registrationId).toBe("r1");
    expect(validee.places.find((p) => p.rang === 2)?.registrationId).toBeNull();

    // REFUSÉE ET REQUALIFIÉE EN TECHNIQUE : l'argent revient au perdant. Le motif
    // du combat, lui, est réécrit côté serveur ; ici c'est le statut qui parle.
    const refusee = classementOfficiel({
      fights: finale.map((f): PropagationFight => ({ ...f, dqReason: "technique" })),
      thirdPlaceMode: "shared_bronze",
      eligibilite: eligibilite("refusee"),
    });
    expect(refusee.etat).toBe("complet");
    expect(refusee.places.find((p) => p.rang === 2)?.registrationId).toBe("r2");
  });
});

describe("les libellés selon qui regarde (DQ2.11, T13.2)", () => {
  it("la salle et les vues publiques ne lisent que « Disqualification »", () => {
    expect(libellePublicDeSanction()).toBe("Disqualification");
    // Aucun paramètre : le motif n'a AUCUN chemin vers l'écran externe.
    expect(libellePublicDeSanction.length).toBe(0);
  });

  it("le staff lit l'état de la décision, pas seulement la sanction", () => {
    expect(libelleStaffDeSanction("en_attente")).toContain("en attente de validation");
    expect(libelleStaffDeSanction("validee")).toBe("Disqualifié (disciplinaire)");
    expect(libelleStaffDeSanction("refusee")).toContain("refusée");
    expect(libelleStaffDeSanction("annulee")).toContain("annulée");
    for (const statut of STATUTS_SANCTION) {
      // Le libellé du staff peut nommer la sanction ; il ne cite JAMAIS l'article.
      for (const code of CODES_SANCTION) {
        expect(libelleStaffDeSanction(statut)).not.toContain(code);
      }
    }
  });
});

describe("les quatre verbes de la sanction dans la matrice", () => {
  const verbes = [
    "sanction.validate",
    "sanction.refuse",
    "sanction.pronounce",
    "sanction.cancel",
  ] as const;

  it("sont réservés au Responsable de compétition", () => {
    for (const v of verbes) {
      expect(CAPABILITIES[v].roles, v).toEqual(["day_commissioner"]);
      expect(canPerform(v, [poste("day_commissioner")], null), v).toBe(true);
      expect(canPerform(v, [poste("table_operator")], null), v).toBe(false);
      expect(canPerform(v, [poste("tatami_commissioner")], null), v).toBe(false);
      expect(canPerform(v, [poste("podium")], null), v).toBe(false);
    }
  });

  it("ne sont PAS bornés à un tapis : la sanction porte sur l'athlète", () => {
    for (const v of verbes) {
      expect(CAPABILITIES[v].tatamiBound, v).toBe(false);
      // Sans tapis en main, le bandeau reste joignable depuis n'importe quel écran.
      expect(
        canPerform(v, [{ role: "day_commissioner", tatamiScope: "none", tatamiIds: [] }], null),
        v,
      ).toBe(true);
    }
  });
});

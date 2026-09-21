import { describe, expect, it } from "vitest";
import { proposerCombatsSupplementaires } from "../src/arbitrage";
import {
  classementOfficiel,
  libellePlaceVacante,
  medaillesDuClassement,
} from "../src/podium-officiel";
import { compact, K, P3, Tableau } from "./aides-classement";

const MODES = ["shared_bronze", "pool3"] as const;

describe("personne seule (PO3, IBJJF 4.4)", () => {
  const seul = (e: Partial<{ elim: boolean; valide: boolean; disc: boolean }>) =>
    classementOfficiel({
      fights: [],
      thirdPlaceMode: "pool3",
      seulInscrit: "r1",
      eligibilite: [
        {
          registrationId: "r1",
          elimination: e.elim ? { statut: "eliminated", motif: "overweight" } : null,
          aCombattu: false,
          checkInValide: e.valide ?? false,
          disciplinaire: e.disc ? "validee" : "aucune",
        },
      ],
    });

  it("or seulement au check-in validé (identité et pesée)", () => {
    expect(compact(seul({ valide: true }).places)).toEqual(["1:r1"]);
    expect(seul({ valide: true }).etat).toBe("complet");
  });

  it("check-in non validé : rien, la catégorie est en cours", () => {
    const c = seul({});
    expect(c.etat).toBe("en_cours");
    expect(c.places).toEqual([]);
  });

  it("éliminée (hors poids) : terminée sans médaillé, mention rouge avec le motif", () => {
    const c = seul({ elim: true });
    expect(c.etat).toBe("terminee_sans_medaille");
    expect(c.places).toEqual([]);
    expect(c.motifSansMedaille).toBe("Disqualifié(e) : hors poids. Aucune médaille.");
  });

  it("disqualifiée disciplinaire : terminée sans médaillé (IBJJF 4.3)", () => {
    const c = seul({ disc: true, valide: true });
    expect(c.etat).toBe("terminee_sans_medaille");
    expect(c.motifSansMedaille).toContain("disqualification disciplinaire");
  });
});

describe("catégorie à deux (règle CFJJB DQ1.5, T2.3)", () => {
  it("combat ordinaire : or et argent", () => {
    expect(compact(new Tableau(2).gagne(K(1, 0), "A").classement().places)).toEqual([
      "1:r1",
      "2:r2",
    ]);
  });

  it("un éliminé au check-in : or à l'autre, 2e place vacante (disqualification), pas de 3e", () => {
    const c = new Tableau(2).absents("r2").classement();
    expect(c.etat).toBe("complet");
    expect(compact(c.places)).toEqual(["1:r1", "2:vacante(disqualification)"]);
  });

  it("double disqualification technique : aucun champion, les deux sont 2es", () => {
    expect(compact(new Tableau(2).double(K(1, 0), "technique").classement().places)).toEqual([
      "1:vacante(disqualification)",
      "2:r1",
      "2:r2",
    ]);
  });

  it("double disqualification disciplinaire : ni classement ni médaille", () => {
    const c = new Tableau(2).double(K(1, 0), "disciplinaire").classement();
    expect(c.etat).toBe("terminee_sans_medaille");
    expect(medaillesDuClassement(c.places)).toEqual({ or: 0, argent: 0, bronze: 0 });
  });

  it("mixte : aucun champion, le disqualifié technique est 2e seul", () => {
    expect(compact(new Tableau(2).double(K(1, 0), "mixte").classement().places)).toEqual([
      "1:vacante(disqualification)",
      "2:r1",
    ]);
  });

  it("disqualification disciplinaire simple : or au vainqueur, 2e place vacante (IBJJF 4.3)", () => {
    const c = new Tableau(2).gagneParDq(K(1, 0), "A", "disciplinaire").classement();
    expect(compact(c.places)).toEqual(["1:r1", "2:vacante(disqualification_disciplinaire)"]);
  });

  it("double blessure à égalité en finale : tirage au sort saisi, puis podium ordinaire (SB3.2)", () => {
    const t = new Tableau(2).double(K(1, 0), "blessure");
    const avant = t.classement();
    expect(avant.etat).toBe("arbitrage_requis");
    expect(avant.arbitrage?.resolution).toBe("tirage");
    expect(compact(t.arbitre(K(1, 0), "tirage", "B").classement().places)).toEqual([
      "1:r2",
      "2:r1",
    ]);
  });
});

describe("T2.3 : un inéligible sans combat ne prend jamais de place (IBJJF 2.4.1, 4.2)", () => {
  it("bronze jamais donné à l'éliminé sans combat : le quart du même côté devient la demie", () => {
    const t = new Tableau(5)
      .gagne(K(3, 0), "A")
      .absents("r2")
      .gagne(K(2, 1), "A")
      .gagne(K(1, 0), "A");
    expect(compact(t.classement().places)).toEqual(["1:r1", "2:r3", "3:r5", "3:r4"]);
  });

  it("sans quart disputé (bye), la place reste vacante", () => {
    const t = new Tableau(4).absents("r3").gagne(K(2, 1), "A").gagne(K(1, 0), "A");
    expect(compact(t.classement().places)).toEqual([
      "1:r1",
      "2:r2",
      "3:vacante(disqualification)",
      "3:r4",
    ]);
  });

  it("combat de 3e place : l'éliminé n'y descend pas, l'autre perdant de demie a le bronze", () => {
    const t = new Tableau(4, "pool3").absents("r3").gagne(K(2, 1), "A").gagne(K(1, 0), "A");
    expect(compact(t.classement().places)).toEqual(["1:r1", "2:r2", "3:r4"]);
  });
});

describe("T2.4 B : double forfait en demi-finale (IBJJF 2.4.2 dernier point, 4.2.1)", () => {
  for (const mode of MODES) {
    it(`[${mode}] aucun des deux n'avait combattu : l'autre demie vaut finale, perdants des quarts 3es`, () => {
      const t = new Tableau(6, mode)
        .gagne(K(3, 0), "A")
        .gagne(K(3, 1), "A")
        .gagne(K(2, 0), "A")
        .absents("r3", "r4");
      if (mode === "pool3") t.cascade();
      const c = t.classement();
      expect(c.etat).toBe("complet");
      expect(compact(c.places)).toEqual(["1:r1", "2:r2", "3:r5", "3:r6"]);
    });
  }

  it("[shared_bronze] l'un avait combattu : finale gagnée par forfait, 2e vacante, il garde la 3e", () => {
    const t = new Tableau(7)
      .gagne(K(3, 0), "A")
      .gagne(K(3, 1), "A")
      .gagne(K(3, 2), "A")
      .gagne(K(2, 0), "A")
      .absents("r3", "r4");
    expect(compact(t.classement().places)).toEqual([
      "1:r1",
      "2:vacante(disqualification)",
      "3:r2",
      "3:r3",
    ]);
  });

  for (const mode of MODES) {
    it(`[${mode}] finaliste arrivé par forfait puis forfait en finale : la demie jouée vaut finale`, () => {
      const t = new Tableau(4, mode).gagne(K(2, 0), "A").absents("r4");
      t.elimines.add("r2");
      t.gagne(K(1, 0), "A", "wo");
      expect(t.combat(K(1, 0))).toMatchObject({ slotB: "r2", winner: "r1", winMethod: "wo" });
      expect(compact(t.classement().places)).toEqual(["1:r1", "2:r3"]);
    });
  }

  it("[pool3] l'un avait combattu : 2e vacante, le bronze est celui du combat de 3e place", () => {
    const t = new Tableau(7, "pool3")
      .gagne(K(3, 0), "A")
      .gagne(K(3, 1), "A")
      .gagne(K(3, 2), "A")
      .gagne(K(2, 0), "A")
      .absents("r3", "r4");
    expect(compact(t.classement().places)).toEqual(["1:r1", "2:vacante(disqualification)", "3:r2"]);
  });
});

describe("T2.1, T2.2 : l'absent qui a combattu garde sa place, la DQ technique est une défaite", () => {
  it("finaliste absent après avoir combattu : 2e (IBJJF 4.2.1)", () => {
    const t = new Tableau(4).gagne(K(2, 0), "A").gagne(K(2, 1), "A").absents("r2");
    expect(compact(t.classement().places)).toEqual(["1:r1", "2:r2", "3:r3", "3:r4"]);
  });

  it("disqualification technique en finale : simple défaite", () => {
    const t = new Tableau(4)
      .gagne(K(2, 0), "A")
      .gagne(K(2, 1), "A")
      .gagneParDq(K(1, 0), "A", "technique");
    expect(compact(t.classement().places)).toEqual(["1:r1", "2:r2", "3:r3", "3:r4"]);
  });
});

describe("IBJJF 2.4.1 : double disqualification en demi-finale (au moins quatre)", () => {
  for (const mode of MODES) {
    const demieDouble = (nature: "technique" | "disciplinaire" | "mixte" | "blessure") => {
      const t = new Tableau(4, mode).double(K(2, 0), nature).gagne(K(2, 1), "A").cascade();
      return t.classement();
    };

    it(`[${mode}] technique : l'autre demie devient la finale, les deux disqualifiés sont 3es`, () => {
      const c = demieDouble("technique");
      expect(c.etat).toBe("complet");
      expect(compact(c.places)).toEqual(["1:r2", "2:r4", "3:r1", "3:r3"]);
    });

    it(`[${mode}] disciplinaire : la 3e place reste vacante`, () => {
      expect(compact(demieDouble("disciplinaire").places)).toEqual([
        "1:r2",
        "2:r4",
        "3:vacante(disqualification_disciplinaire)",
      ]);
    });

    it(`[${mode}] mixte : le disqualifié technique garde la 3e place`, () => {
      expect(compact(demieDouble("mixte").places)).toEqual(["1:r2", "2:r4", "3:r1"]);
    });

    it(`[${mode}] SB3.2 : double blessure à égalité en demie, deux 3es`, () => {
      expect(compact(demieDouble("blessure").places)).toEqual(["1:r2", "2:r4", "3:r1", "3:r3"]);
    });
  }

  it("avant les demies : passage sans adversaire, jamais une victoire contre un disqualifié", () => {
    const t = new Tableau(8).double(K(3, 0), "technique").gagne(K(3, 1), "A").cascade();
    const demie = t.combat(K(2, 0));
    expect(demie.slotA).toBeNull();
    expect([demie.slotA, demie.slotB]).not.toContain("r1");
    expect([demie.slotA, demie.slotB]).not.toContain("r5");
    expect(demie).toMatchObject({ state: "finished", winMethod: "wo", winner: "r2" });

    t.gagne(K(3, 2), "A").gagne(K(3, 3), "A").gagne(K(2, 1), "A").gagne(K(1, 0), "A");
    expect(compact(t.classement().places)).toEqual(["1:r2", "2:r3", "3:r6", "3:r4"]);
  });
});

describe("IBJJF 2.4.2 : finale", () => {
  const joue = (mode: "shared_bronze" | "pool3") => {
    const t = new Tableau(8, mode);
    for (const i of [0, 1, 2, 3]) t.gagne(K(3, i), "A");
    return t.gagne(K(2, 0), "A").gagne(K(2, 1), "A");
  };

  it("[shared_bronze] DQ disciplinaire d'un seul finaliste : le perdant de demie battu par le champion est 2e", () => {
    const c = joue("shared_bronze").gagneParDq(K(1, 0), "B", "disciplinaire").classement();
    expect(compact(c.places)).toEqual([
      "1:r3",
      "2:r4",
      "3:r2",
      "3:vacante(disqualification_disciplinaire)",
    ]);
  });

  it("[pool3] le 2e promu avait le bronze : la 3e place qu'il libère reste vacante", () => {
    const c = joue("pool3").gagne(P3, "B").gagneParDq(K(1, 0), "B", "disciplinaire").classement();
    expect(compact(c.places)).toEqual([
      "1:r3",
      "2:r4",
      "3:vacante(disqualification_disciplinaire)",
    ]);
  });

  it("[pool3] le 2e promu avait perdu le combat de 3e place : le bronze ne bouge pas", () => {
    const c = joue("pool3").gagne(P3, "A").gagneParDq(K(1, 0), "B", "disciplinaire").classement();
    expect(compact(c.places)).toEqual(["1:r3", "2:r4", "3:r2"]);
  });

  it("tableau de trois, finale en double DQ technique : le perdant de la 2e demie est champion, deux 2es", () => {
    const t = new Tableau(3);
    const rep = K(2, 1, "BraketFightRepechage3");
    t.gagne(K(2, 0), "A").gagne(rep, "B").double(K(1, 0), "technique");
    const c = t.classement();
    expect(c.etat).toBe("complet");
    expect(compact(c.places)).toEqual(["1:r3", "2:r1", "2:r2"]);
  });
});

describe("tableau de trois, double blessure à égalité (IBJJF 2.4.1, SB3.2)", () => {
  const REP = K(2, 1, "BraketFightRepechage3");

  it("2e demie : le vainqueur de la 1re est champion, 2e place vacante, les deux blessés 3es", () => {
    const c = new Tableau(3).gagne(K(2, 0), "A").double(REP, "blessure").classement();
    expect(c.etat).toBe("complet");
    expect(c.arbitrage).toBeNull();
    expect(compact(c.places)).toEqual(["1:r1", "2:vacante(blessure)", "3:r3", "3:r2"]);
    expect(medaillesDuClassement(c.places)).toEqual({ or: 1, argent: 0, bronze: 2 });
  });

  it("1re demie : le 3e combattant est champion par forfait, 2e place vacante, les deux blessés 3es", () => {
    const c = new Tableau(3).double(K(2, 0), "blessure").classement();
    expect(c.etat).toBe("complet");
    expect(compact(c.places)).toEqual(["1:r2", "2:vacante(blessure)", "3:r1", "3:r3"]);
  });

  it("1re demie, 3e combattant absent : les deux blessés 3es, personne d'autre", () => {
    const c = new Tableau(3).absents("r2").double(K(2, 0), "blessure").classement();
    expect(c.etat).toBe("complet");
    expect(compact(c.places)).toEqual(["3:r1", "3:r3"]);
  });

  it("finale : tirage au sort saisi, le perdant du tirage 2e, le perdant de la 2e demie 3e", () => {
    const t = new Tableau(3).gagne(K(2, 0), "A").gagne(REP, "B").double(K(1, 0), "blessure");
    const avant = t.classement();
    expect(avant.etat).toBe("arbitrage_requis");
    expect(avant.arbitrage?.resolution).toBe("tirage");
    expect(compact(t.arbitre(K(1, 0), "tirage", "B").classement().places)).toEqual([
      "1:r2",
      "2:r1",
      "3:r3",
    ]);
  });
});

describe("IBJJF 2.4.3 : disqualification disciplinaire validée après combat, les battus remontent", () => {
  const avecFinale = (vainqueur: "A" | "B") => {
    const t = new Tableau(8);
    for (const i of [0, 1, 2, 3]) t.gagne(K(3, i), "A");
    t.gagne(K(2, 0), "A").gagne(K(2, 1), "A").gagne(K(1, 0), vainqueur);
    t.disciplinairesApres.add("r1");
    return t.classement();
  };

  it("après une finale perdue : D reste champion, C 2e, B 3e (exemple DQ2.3)", () => {
    expect(compact(avecFinale("B").places)).toEqual(["1:r3", "2:r2", "3:r5", "3:r4"]);
  });

  it("après une finale gagnée : D champion, C 2e, B 3e", () => {
    expect(compact(avecFinale("A").places)).toEqual(["1:r3", "2:r2", "3:r5", "3:r4"]);
  });
});

describe("disqualification disciplinaire en attente (L7) : le podium ne se fige pas", () => {
  it("état disciplinaire_en_attente, aucune place", () => {
    const t = new Tableau(4).gagne(K(2, 0), "A").gagne(K(2, 1), "A").gagne(K(1, 0), "A");
    t.enAttente.add("r3");
    const c = t.classement();
    expect(c.etat).toBe("disciplinaire_en_attente");
    expect(c.places).toEqual([]);
  });
});

describe("recette du 11/09 (lecture du 15/09)", () => {
  it("« Orange - U15 - Garçon - Pena » : or, argent au perdant de la seule demie jouée, pas de 3e", () => {
    const t = new Tableau(4).gagne(K(2, 0), "A").absents("r2", "r4");
    expect(compact(t.classement().places)).toEqual(["1:r1", "2:r3"]);
  });

  it("« Grise - U15 - Garçon - Leve » : or, argent (DQ technique), 3e place vacante (disciplinaire)", () => {
    const t = new Tableau(5)
      .gagneParDq(K(3, 0), "A", "disciplinaire")
      .gagneParDq(K(2, 0), "B", "technique")
      .absents("r3", "r4");
    expect(compact(t.classement().places)).toEqual([
      "1:r2",
      "2:r1",
      "3:vacante(disqualification_disciplinaire)",
    ]);
  });
});

describe("arbitrage requis puis résolu (DQ1.3)", () => {
  const demiesJouees = (n: 4 | 8) => {
    const t = new Tableau(n);
    if (n === 8) for (const i of [0, 1, 2, 3]) t.gagne(K(3, i), "A");
    return t.gagne(K(2, 0), "A").gagne(K(2, 1), "A");
  };

  it("finale double technique : les perdants des demies refont la finale, les disqualifiés sont 2es", () => {
    const t = demiesJouees(4).double(K(1, 0), "technique");
    const c = t.classement();
    expect(c.etat).toBe("arbitrage_requis");
    expect(c.arbitrage?.resolution).toBe("combats");
    const proposition = proposerCombatsSupplementaires(t.fights, t.combat(K(1, 0)));
    expect(proposition?.combats).toEqual([
      expect.objectContaining({ division: 1, indexInDivision: 1, slotA: "r3", slotB: "r4" }),
    ]);
    t.arbitre(K(1, 0), null, null).ajouterCombat(1, 1, "r3", "r4");
    expect(t.classement().etat).toBe("en_cours");
    t.gagne(K(1, 1), "A");
    expect(compact(t.classement().places)).toEqual(["1:r3", "2:r1", "2:r2", "3:r4"]);
  });

  it("finale mixte : le technique est 2e, la finale rejouée donne l'or et la 3e", () => {
    const t = demiesJouees(4).double(K(1, 0), "mixte").arbitre(K(1, 0), null, null);
    t.ajouterCombat(1, 1, "r3", "r4").gagne(K(1, 1), "A");
    expect(compact(t.classement().places)).toEqual(["1:r3", "2:r1", "3:r4"]);
  });

  it("finale double disciplinaire : les perdants des quarts battus par les nouveaux finalistes sont 3es", () => {
    const t = demiesJouees(8).double(K(1, 0), "disciplinaire").arbitre(K(1, 0), null, null);
    t.ajouterCombat(1, 1, "r2", "r4").gagne(K(1, 1), "A");
    expect(compact(t.classement().places)).toEqual(["1:r2", "2:r4", "3:r6", "3:r8"]);
  });

  for (const nature of ["technique", "disciplinaire"] as const) {
    it(`quatre demi-finalistes disqualifiés ${nature} : demies supplémentaires entre perdants des quarts`, () => {
      const t = new Tableau(8);
      for (const i of [0, 1, 2, 3]) t.gagne(K(3, i), "A");
      t.double(K(2, 0), nature).double(K(2, 1), nature);
      const c = t.classement();
      expect(c.arbitrage?.resolution).toBe("combats");
      const proposition = proposerCombatsSupplementaires(t.fights, t.combat(K(2, 0)));
      expect(
        proposition?.combats.map((x) => [x.division, x.indexInDivision, x.slotA, x.slotB]),
      ).toEqual([
        [2, 2, "r5", "r6"],
        [2, 3, "r7", "r8"],
        [1, 1, null, null],
      ]);
      t.arbitre(K(2, 0), null, null).arbitre(K(2, 1), null, null);
      t.ajouterCombat(2, 2, "r5", "r6")
        .ajouterCombat(2, 3, "r7", "r8")
        .ajouterCombat(1, 1, null, null);
      t.gagne(K(2, 2), "A").gagne(K(2, 3), "A").gagne(K(1, 1), "A");
      expect(t.combat(K(1, 1)).slotB).toBe("r7");
      const places = compact(t.classement().places);
      if (nature === "technique") {
        expect(places).toEqual(["1:r5", "2:r7", "3:r1", "3:r2", "3:r3", "3:r4"]);
      } else {
        expect(places).toEqual(["1:r5", "2:r7", "3:r6", "3:r8"]);
      }
    });
  }

  it("tableau de trois, 1re demie en double technique : tirage, le perdant dispute la 2e demie", () => {
    const t = new Tableau(3).double(K(2, 0), "technique");
    expect(t.classement().arbitrage?.resolution).toBe("tirage");
    t.arbitre(K(2, 0), "tirage", "A");
    const rep = K(2, 1, "BraketFightRepechage3");
    expect(t.combat(rep).slotA).toBe("r3");
    t.gagne(rep, "B").gagne(K(1, 0), "A");
    expect(compact(t.classement().places)).toEqual(["1:r1", "2:r2", "3:r3"]);
  });

  it("tableau de trois disciplinaire : classement saisi par le Responsable", () => {
    const t = new Tableau(3).double(K(2, 0), "disciplinaire");
    expect(t.classement().arbitrage?.resolution).toBe("classement");
    const c = classementOfficiel({
      ...t.entree(),
      classementSaisi: [
        { rang: 1, registrationId: "r2", motifVacance: null },
        { rang: 2, registrationId: null, motifVacance: "disqualification_disciplinaire" },
      ],
    });
    expect(c.etat).toBe("complet");
    expect(compact(c.places)).toEqual(["1:r2", "2:vacante(disqualification_disciplinaire)"]);
  });

  it("double blessure avant les demies : décision du Responsable, le qualifié retenu avance", () => {
    const t = new Tableau(8).double(K(3, 0), "blessure");
    expect(t.classement().arbitrage?.resolution).toBe("decision");
    t.arbitre(K(3, 0), "decision", "B");
    expect(t.combat(K(2, 0)).slotA).toBe("r5");
  });
});

describe("combat pour la 3e place sans vainqueur (DQ1.4, SB3.2 : cas non écrit)", () => {
  const petiteFinale = (nature: "technique" | "disciplinaire" | "mixte" | "blessure") =>
    new Tableau(4, "pool3")
      .gagne(K(2, 0), "A")
      .gagne(K(2, 1), "A")
      .gagne(K(1, 0), "A")
      .double(P3, nature);

  for (const nature of ["technique", "mixte", "blessure"] as const) {
    it(`${nature} : jamais deux 3es d'office, le Responsable désigne le 3e`, () => {
      const t = petiteFinale(nature);
      const c = t.classement();
      expect(c.etat).toBe("arbitrage_requis");
      expect(c.arbitrage?.resolution).toBe("decision");
      expect(compact(t.arbitre(P3, "decision", "A").classement().places)).toEqual([
        "1:r1",
        "2:r2",
        "3:r3",
      ]);
    });
  }

  it("décision « personne » : la 3e place reste vacante", () => {
    const c = petiteFinale("technique").arbitre(P3, "decision", null).classement();
    expect(c.etat).toBe("complet");
    expect(compact(c.places)).toEqual(["1:r1", "2:r2", "3:vacante(disqualification)"]);
  });

  it("double disciplinaire : sans décision, la 3e place est vacante (DQ2.2)", () => {
    const c = petiteFinale("disciplinaire").classement();
    expect(c.etat).toBe("complet");
    expect(compact(c.places)).toEqual([
      "1:r1",
      "2:r2",
      "3:vacante(disqualification_disciplinaire)",
    ]);
  });
});

describe("libellés", () => {
  it("« 3e place vacante (disqualification disciplinaire) »", () => {
    expect(libellePlaceVacante({ rang: 3, motifVacance: "disqualification_disciplinaire" })).toBe(
      "3e place vacante (disqualification disciplinaire)",
    );
    expect(libellePlaceVacante({ rang: 1, motifVacance: "disqualification" })).toBe(
      "1re place vacante (disqualification)",
    );
    expect(libellePlaceVacante({ rang: 2, motifVacance: "blessure" })).toBe(
      "2e place vacante (blessure des deux combattants)",
    );
  });

  it("le besoin en médailles ne compte que les places pourvues (T4.2)", () => {
    const c = new Tableau(4)
      .double(K(2, 0), "disciplinaire")
      .gagne(K(2, 1), "A")
      .cascade()
      .classement();
    expect(medaillesDuClassement(c.places)).toEqual({ or: 1, argent: 1, bronze: 0 });
  });
});

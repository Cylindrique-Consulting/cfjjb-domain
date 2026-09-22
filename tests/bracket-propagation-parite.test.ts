import { describe, expect, it } from "vitest";
import { generateBracket, type BracketEntry } from "../src/bracket-generator";
import { classementOfficiel } from "../src/podium-officiel";
import {
  deepestDivision,
  findFeederFight,
  findNextSlot,
  fromGenerated,
  isSlotImpossible,
  planByeCascade,
  planFinish,
  planForfeit,
  planUndoForfeit,
  structuralKey,
  type Plan,
  type PropagationFight,
} from "../src/bracket-propagation";

function entrees(n: number, clubs = 1): BracketEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    registrationId: `r${i + 1}`,
    clubId: `c${(i % clubs) + 1}`,
  }));
}

function bracket(n: number, mode: "pool3" | "shared_bronze" = "pool3"): PropagationFight[] {
  const res = generateBracket(entrees(n), `graine-${n}`, { thirdPlaceMode: mode });
  if (res.kind !== "bracket") throw new Error(`n=${n} ne produit pas de tableau`);
  return fromGenerated(res.fights);
}

describe("PREUVE 1 — le générateur et la propagation s'accordent sur les byes", () => {
  it("planByeCascade est un no-op sur une sortie fraîche du générateur, pour n = 2..64", () => {
    for (let n = 2; n <= 64; n++) {
      expect(planByeCascade(bracket(n)), `n=${n}`).toEqual([]);
    }
  });

  it("n'ordonne JAMAIS par identifiant : un ordre lexicographique inverse ne change rien", () => {
    const res = generateBracket(entrees(8), "graine", { thirdPlaceMode: "pool3" });
    if (res.kind !== "bracket") throw new Error("attendu un tableau");

    const naturel = fromGenerated(res.fights);
    const inverse = fromGenerated(
      res.fights,
      (f) => `z${99 - f.division}${99 - f.indexInDivision}`,
    );

    for (const f of naturel) {
      const jumeau = inverse.find(
        (x) =>
          x.division === f.division && x.indexInDivision === f.indexInDivision && x.type === f.type,
      )!;
      const a = findNextSlot(naturel, f);
      const b = findNextSlot(inverse, jumeau);
      expect(b?.slot, structuralKey(f)).toBe(a?.slot);
    }
  });
});

function appliquerNavigateur(fights: PropagationFight[], plan: Plan): PropagationFight[] {
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

function appliquerServeur(fights: PropagationFight[], plan: Plan): PropagationFight[] {
  const transmis: Plan = JSON.parse(JSON.stringify(plan));
  const out = fights.map((f) => ({ ...f }));
  for (const p of transmis.patches) {
    const i = out.findIndex((f) => f.id === p.fightId);
    if (i < 0) continue;
    const { fightId: _id, ...reste } = p;
    out[i] = { ...out[i]!, ...reste, version: out[i]!.version + 1 };
  }
  for (const w of transmis.propagation) {
    const i = out.findIndex((f) => f.id === w.fightId);
    if (i < 0) continue;
    out[i] = {
      ...out[i]!,
      ...(w.slot === "A" ? { slotA: w.registrationId } : { slotB: w.registrationId }),
      version: out[i]!.version + 1,
    };
  }
  return out;
}

function jouerTournoi(
  depart: PropagationFight[],
  appliquer: (f: PropagationFight[], p: Plan) => PropagationFight[],
): PropagationFight[] {
  let etat = depart;
  let garde = 200;
  while (garde-- > 0) {
    const prochain = etat.find(
      (f) =>
        f.state === "scheduled" && f.slotA !== null && f.slotB !== null && f.type === "BraketFight",
    );
    const pool3 = etat.find(
      (f) => f.type === "BraketFightPool3" && f.state === "scheduled" && f.slotA && f.slotB,
    );
    const cible = prochain ?? pool3;
    if (!cible) break;
    etat = appliquer(etat, planFinish(etat, cible.id, cible.slotA!, "points"));
  }
  return etat;
}

describe("PREUVE 2 — un tournoi complet joué deux fois donne le même état", () => {
  for (const n of [2, 3, 4, 5, 7, 8, 11, 16, 23, 32]) {
    it(`n=${n} : navigateur et serveur convergent, versions comprises`, () => {
      const depart = bracket(n);
      expect(jouerTournoi(depart, appliquerNavigateur)).toEqual(
        jouerTournoi(depart, appliquerServeur),
      );
    });
  }
});

describe("PREUVE 3 — la cascade de forfaits converge des deux côtés", () => {
  for (const n of [4, 5, 8, 11, 16]) {
    for (const combien of [1, 2, 3]) {
      it(`n=${n}, ${combien} éliminé(s) : navigateur == serveur`, () => {
        const depart = bracket(n);
        const elimines = new Set(Array.from({ length: combien }, (_, i) => `r${i + 1}`));
        const plan = planForfeit(depart, elimines);
        expect(appliquerNavigateur(depart, plan)).toEqual(appliquerServeur(depart, plan));
      });
    }
  }

  it("propage en POINT FIXE : un vainqueur qui arrive face à un éliminé tombe aussi", () => {
    const depart = bracket(8);
    const demiFinale = depart.find((f) => f.division === 2 && f.indexInDivision === 0)!;
    expect(demiFinale.slotA === null || demiFinale.slotB === null).toBe(true);

    const premierTour = depart.filter((f) => f.division === 3 && !f.isBye);
    const futurQualifie = premierTour[0]!.slotA!;
    const plan = planForfeit(depart, new Set([futurQualifie]));
    const apres = appliquerNavigateur(depart, plan);

    const sien = apres.find((f) => f.id === premierTour[0]!.id)!;
    expect(sien.state).toBe("finished");
    expect(sien.winMethod).toBe("wo");
    expect(sien.winner).toBe(premierTour[0]!.slotB);
  });

  it("un double forfait ne désigne AUCUN vainqueur et demande un arbitrage", () => {
    const depart = bracket(8);
    const premier = depart.find((f) => f.division === 3 && !f.isBye && f.slotA && f.slotB)!;
    const plan = planForfeit(depart, new Set([premier.slotA!, premier.slotB!]));
    const apres = appliquerNavigateur(depart, plan);

    const sien = apres.find((f) => f.id === premier.id)!;
    expect(sien.state).toBe("finished");
    expect(sien.winMethod).toBe("double_wo");
    expect(sien.winner).toBeNull();

    const aval = findNextSlot(depart, premier)!;
    const cible = apres.find((f) => f.id === aval.fightId)!;
    expect(aval.slot === "A" ? cible.slotA : cible.slotB).toBeNull();
    expect(cible.needsArbitration).toBe(true);
  });

  it("ne touche JAMAIS un combat déjà terminé", () => {
    const depart = bracket(8);
    const premier = depart.find((f) => f.division === 3 && !f.isBye && f.slotA && f.slotB)!;
    const gagnant = premier.slotA!;
    const apresVictoire = appliquerNavigateur(
      depart,
      planFinish(depart, premier.id, gagnant, "submission"),
    );

    const plan = planForfeit(apresVictoire, new Set([gagnant]));
    const touche = plan.patches.map((p) => p.fightId);
    expect(touche).not.toContain(premier.id);

    const apres = appliquerNavigateur(apresVictoire, plan);
    const inchange = apres.find((f) => f.id === premier.id)!;
    expect(inchange.winner).toBe(gagnant);
    expect(inchange.winMethod).toBe("submission");
  });

  it("n'envoie PAS un éliminé au combat de 3e place", () => {
    const depart = bracket(8);
    const demie = depart.find((f) => f.division === 2 && f.indexInDivision === 0)!;
    let etat = depart;
    for (const f of depart.filter((x) => x.division === 3 && !x.isBye && x.slotA && x.slotB)) {
      etat = appliquerNavigateur(etat, planFinish(etat, f.id, f.slotA!, "points"));
    }
    const remplie = etat.find((f) => f.id === demie.id)!;
    const futurPerdant = remplie.slotB!;
    const plan = planFinish(etat, remplie.id, remplie.slotA!, "points", new Set([futurPerdant]));
    const apres = appliquerNavigateur(etat, plan);

    const p3 = apres.find((f) => f.type === "BraketFightPool3")!;
    expect([p3.slotA, p3.slotB]).not.toContain(futurPerdant);
  });
});

describe("PREUVE 4 — « refaire le combat » n'annule QUE ce combat", () => {
  it("retire le vainqueur propagé et rend le combat programmé", () => {
    const depart = bracket(8);
    const premier = depart.find((f) => f.division === 3 && !f.isBye && f.slotA && f.slotB)!;
    const apresVictoire = appliquerNavigateur(
      depart,
      planFinish(depart, premier.id, premier.slotA!, "points"),
    );
    const aval = findNextSlot(depart, premier)!;

    const apres = appliquerNavigateur(apresVictoire, planUndoForfeit(apresVictoire, premier.id));
    const rendu = apres.find((f) => f.id === premier.id)!;
    expect(rendu.state).toBe("scheduled");
    expect(rendu.winner).toBeNull();
    expect(rendu.winMethod).toBeNull();

    const cible = apres.find((f) => f.id === aval.fightId)!;
    expect(aval.slot === "A" ? cible.slotA : cible.slotB).toBeNull();
  });

  it("ne restaure PAS les autres forfaits de la même élimination", () => {
    const depart = bracket(16);
    const premiers = depart.filter((f) => f.division === 4 && !f.isBye && f.slotA && f.slotB);
    const elimines = new Set([premiers[0]!.slotA!, premiers[1]!.slotA!]);
    const apresForfaits = appliquerNavigateur(depart, planForfeit(depart, elimines));

    const apres = appliquerNavigateur(
      apresForfaits,
      planUndoForfeit(apresForfaits, premiers[0]!.id),
    );
    expect(apres.find((f) => f.id === premiers[1]!.id)!.state).toBe("finished");
    expect(apres.find((f) => f.id === premiers[0]!.id)!.state).toBe("scheduled");
  });
});

describe("PREUVE 5 — le plan porte ce que l'appelant croyait vrai", () => {
  it("l'attendu décrit l'état AVANT, pas après", () => {
    const depart = bracket(8);
    const premier = depart.find((f) => f.division === 3 && !f.isBye && f.slotA && f.slotB)!;
    const plan = planFinish(depart, premier.id, premier.slotA!, "points");
    const attendu = plan.expected.find((e) => e.fightId === premier.id)!;
    expect(attendu.state).toBe("scheduled");
    expect(attendu.version).toBe(0);
  });

  it("l'attendu couvre AUSSI les cibles de propagation", () => {
    const depart = bracket(8);
    const premier = depart.find((f) => f.division === 3 && !f.isBye && f.slotA && f.slotB)!;
    const aval = findNextSlot(depart, premier)!;
    const plan = planFinish(depart, premier.id, premier.slotA!, "points");
    expect(plan.expected.map((e) => e.fightId)).toContain(aval.fightId);
  });
});

describe("PREUVE 6 — le podium (release B : le classement officiel)", () => {
  const pourvues = (c: ReturnType<typeof classementOfficiel>, rang: 1 | 2 | 3) =>
    c.places.filter((p) => p.rang === rang && p.registrationId !== null);

  it("un tournoi joué en entier donne un podium complet", () => {
    const final = jouerTournoi(bracket(8), appliquerNavigateur);
    const c = classementOfficiel({ fights: final, thirdPlaceMode: "pool3" });
    expect(c.etat).toBe("complet");
    expect(pourvues(c, 1)).toHaveLength(1);
    expect(pourvues(c, 2)).toHaveLength(1);
    expect(pourvues(c, 3)).toHaveLength(1);
  });

  it("un combat de 3e place PRÉVU mais non joué ne retombe pas sur deux bronzes", () => {
    let etat = bracket(8);
    for (const f of etat.filter((x) => x.division === 3 && !x.isBye && x.slotA && x.slotB)) {
      etat = appliquerNavigateur(etat, planFinish(etat, f.id, f.slotA!, "points"));
    }
    for (const f of etat.filter((x) => x.division === 2 && x.type === "BraketFight")) {
      const vivant = etat.find((y) => y.id === f.id)!;
      etat = appliquerNavigateur(etat, planFinish(etat, vivant.id, vivant.slotA!, "points"));
    }
    const finale = etat.find((f) => f.division === 1)!;
    etat = appliquerNavigateur(etat, planFinish(etat, finale.id, finale.slotA!, "points"));

    const c = classementOfficiel({ fights: etat, thirdPlaceMode: "pool3" });
    expect(c.etat).toBe("en_cours");
    expect(c.places).toEqual([]);
    expect(c.manquant).toContain("Combat pour la 3e place non terminé");
  });

  it("en double bronze, les deux perdants de demie sont ex æquo", () => {
    const final = jouerTournoi(bracket(8, "shared_bronze"), appliquerNavigateur);
    const c = classementOfficiel({ fights: final, thirdPlaceMode: "shared_bronze" });
    expect(pourvues(c, 3)).toHaveLength(2);
    expect(c.etat).toBe("complet");
  });

  it("un seul inscrit : l'or n'est dû qu'au check-in validé (PO3, IBJJF 4.4), jamais d'office", () => {
    const sans = classementOfficiel({ fights: [], thirdPlaceMode: "pool3", seulInscrit: "r1" });
    expect(sans.etat).toBe("en_cours");
    expect(sans.places).toEqual([]);
    const valide = classementOfficiel({
      fights: [],
      thirdPlaceMode: "pool3",
      seulInscrit: "r1",
      eligibilite: [
        {
          registrationId: "r1",
          elimination: null,
          aCombattu: false,
          checkInValide: true,
          disciplinaire: "aucune",
        },
      ],
    });
    expect(valide.etat).toBe("complet");
    expect(valide.places).toEqual([
      { rang: 1, ordre: 1, registrationId: "r1", motifVacance: null },
    ]);
  });

  it("un combat de POULE non joué n'est pas annoncé comme un combat d'arbitrage", () => {
    // La copie manuscrite de la règle « hors grille » testait `f.division <= 2 &&
    // (… || f.indexInDivision >= 2)` : le 3e combat d'une poule (division 0,
    // index 2) y tombait, et le Responsable lisait « Combats d'arbitrage non
    // terminés » sur une catégorie qui n'a jamais eu d'arbitrage.
    const poule: PropagationFight[] = [0, 1, 2].map((i) => ({
      id: `p${i}`,
      division: 0,
      indexInDivision: i,
      type: "BraketFight",
      slotA: "r1",
      slotB: "r2",
      isBye: false,
      state: "scheduled",
      winner: null,
      winMethod: null,
      dqReason: null,
      dqReasonA: null,
      dqReasonB: null,
      doubleBlessure: false,
      arbitrage: null,
      needsArbitration: false,
      version: 0,
    }));
    const c = classementOfficiel({ fights: poule, thirdPlaceMode: "shared_bronze" });
    expect(c.manquant).toContain("Combats non terminés");
    expect(c.manquant).not.toContain("Combats d'arbitrage non terminés");
  });

  it("aucun combat : le motif est écrit, pas laissé muet", () => {
    const c = classementOfficiel({ fights: [], thirdPlaceMode: "pool3" });
    expect(c.etat).toBe("en_cours");
    expect(c.manquant).toContain("Aucun combat dans cette catégorie");
  });
});

function braket(
  fights: readonly PropagationFight[],
  division: number,
  index: number,
): PropagationFight {
  const f = fights.find(
    (x) => x.type === "BraketFight" && x.division === division && x.indexInDivision === index,
  );
  if (!f) throw new Error(`pas de combat (${division}, ${index})`);
  return f;
}

describe("PREUVE 7 — la cascade v2 dénoue les WO fantômes", () => {
  it("SÉQUENTIEL : un WO de cascade dont le vainqueur est ensuite éliminé est révoqué", () => {
    const depart = bracket(8);
    const quart = depart.find(
      (f) => f.division === 3 && !f.isBye && f.slotA !== null && f.slotB !== null,
    )!;
    const rx = quart.slotA!;
    const ry = quart.slotB!;
    const suivant = findNextSlot(depart, quart)!;

    const etat1 = appliquerNavigateur(depart, planForfeit(depart, new Set([rx])));
    const q1 = etat1.find((f) => f.id === quart.id)!;
    expect(q1.state).toBe("finished");
    expect(q1.winMethod).toBe("wo");
    expect(q1.winner).toBe(ry);
    expect(q1.cascadeForfeit).toBe(true);
    const semi1 = etat1.find((f) => f.id === suivant.fightId)!;
    expect(suivant.slot === "A" ? semi1.slotA : semi1.slotB).toBe(ry);

    const etat2 = appliquerNavigateur(etat1, planForfeit(etat1, new Set([rx, ry])));
    const q2 = etat2.find((f) => f.id === quart.id)!;
    expect(q2.state).toBe("finished");
    expect(q2.winMethod).toBe("double_wo");
    expect(q2.winner).toBeNull();
    const semi2 = etat2.find((f) => f.id === suivant.fightId)!;
    expect(suivant.slot === "A" ? semi2.slotA : semi2.slotB).toBeNull();
    expect(semi2.needsArbitration).toBe(true);
  });

  it("ADVERSAIRE IMPOSSIBLE : le bronze se décerne par WO quand la demie fut un WO", () => {
    const depart = bracket(4);
    const semi0 = braket(depart, 2, 0);
    const semi1 = braket(depart, 2, 1);
    const perdantBronze = semi0.slotB!;

    let etat = appliquerNavigateur(depart, planFinish(depart, semi0.id, semi0.slotA!, "points"));
    etat = appliquerNavigateur(etat, planForfeit(etat, new Set([semi1.slotB!])));

    const p3 = etat.find((f) => f.type === "BraketFightPool3")!;
    expect(p3.state).toBe("finished");
    expect(p3.winMethod).toBe("wo");
    expect(p3.winner).toBe(perdantBronze);
    expect(p3.cascadeForfeit).toBe(true);
  });

  it("I1 : une victoire DISPUTÉE (submission) n'est jamais révoquée, même vainqueur éliminé", () => {
    const depart = bracket(8);
    const quart = depart.find(
      (f) => f.division === 3 && !f.isBye && f.slotA !== null && f.slotB !== null,
    )!;
    const etat = appliquerNavigateur(
      depart,
      planFinish(depart, quart.id, quart.slotA!, "submission"),
    );
    const plan = planForfeit(etat, new Set([quart.slotA!]));
    expect(plan.patches.map((p) => p.fightId)).not.toContain(quart.id);
    const apres = appliquerNavigateur(etat, plan);
    const q = apres.find((f) => f.id === quart.id)!;
    expect(q.winMethod).toBe("submission");
    expect(q.winner).toBe(quart.slotA);
  });

  it("I2 : un WO d'ARBITRE (non marqué cascade) survit à l'élimination de son vainqueur", () => {
    const depart = bracket(8);
    const quart = depart.find(
      (f) => f.division === 3 && !f.isBye && f.slotA !== null && f.slotB !== null,
    )!;
    const etat = appliquerNavigateur(depart, planFinish(depart, quart.id, quart.slotA!, "wo"));
    expect(etat.find((f) => f.id === quart.id)!.cascadeForfeit).toBeFalsy();

    const plan = planForfeit(etat, new Set([quart.slotA!]));
    expect(plan.patches.map((p) => p.fightId)).not.toContain(quart.id);
    const apres = appliquerNavigateur(etat, plan);
    const q = apres.find((f) => f.id === quart.id)!;
    expect(q.winMethod).toBe("wo");
    expect(q.winner).toBe(quart.slotA);
  });

  it("les helpers d'impossibilité miroir du SQL : nourricier wo/double_wo/cancelled", () => {
    const depart = bracket(4);
    const semi1 = braket(depart, 2, 1);
    const pool3 = depart.find((f) => f.type === "BraketFightPool3")!;
    expect(isSlotImpossible(depart, pool3, "B")).toBe(false);
    const etat = appliquerNavigateur(depart, planForfeit(depart, new Set([semi1.slotB!])));
    expect(isSlotImpossible(etat, pool3, "B")).toBe(true);
    const premierTour = depart.filter((f) => f.division === deepestDivision(depart));
    expect(findFeederFight(depart, premierTour[0]!, "A")).toBeNull();
  });
});

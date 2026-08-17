import { describe, expect, it } from "vitest";
import { generateBracket, type BracketEntry } from "../src/bracket-generator";
import {
  computePodium,
  findNextSlot,
  fromGenerated,
  planByeCascade,
  planFinish,
  planForfeit,
  planUndoForfeit,
  structuralKey,
  type Plan,
  type PropagationFight,
} from "../src/bracket-propagation";

/**
 * LA SUITE DE PARITÉ — la raison d'être de ce package.
 *
 * Le jour J vit dans un autre dépôt, et sa propagation doit tourner à
 * l'IDENTIQUE dans le navigateur (hors ligne) et sur le serveur. C'est ici — et
 * seulement ici — que cette identité peut être PROUVÉE : les deux exécutions
 * sont deux simulations d'un même test pur, sans base et sans navigateur.
 *
 * Sans ces preuves, la garantie reposerait sur la relecture de deux
 * implémentations par un humain. Les brackets sont exactement le domaine où une
 * divergence ne se voit pas : le tableau reste plausible, seul le mauvais
 * combattant avance.
 */

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

// ------------------------------------------------------------------
// PREUVE 1 — parité générateur ↔ propagation
// ------------------------------------------------------------------

describe("PREUVE 1 — le générateur et la propagation s'accordent sur les byes", () => {
  it("planByeCascade est un no-op sur une sortie fraîche du générateur, pour n = 2..64", () => {
    // Le générateur PRÉ-PLACE déjà les vainqueurs de bye, parce que la
    // propagation de l'application de référence trie par identifiant et ne
    // remonterait pas un bye. Si cette cascade trouve quelque chose à faire, les
    // deux modules ont divergé sur la forme de l'arbre.
    //
    // Trois lignes, et c'est l'outil anti-divergence le plus économique du projet.
    for (let n = 2; n <= 64; n++) {
      expect(planByeCascade(bracket(n)), `n=${n}`).toEqual([]);
    }
  });

  it("n'ordonne JAMAIS par identifiant : un ordre lexicographique inverse ne change rien", () => {
    // LE PIÈGE. L'application de référence trie les frères par identifiant
    // ENTIER. Ici les identifiants sont des UUID : les trier n'a aucun sens.
    // On fabrique donc des identifiants dont l'ordre lexicographique est
    // l'INVERSE de l'ordre structurel, et on exige le même résultat.
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

// ------------------------------------------------------------------
// PREUVE 2 — navigateur == serveur
// ------------------------------------------------------------------

/** « Le navigateur » : un réducteur en mémoire qui applique un plan sur place. */
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

/**
 * « Le serveur » : le plan SÉRIALISÉ puis appliqué, comme le ferait une fonction
 * SQL qui reçoit du jsonb — patches d'abord, propagation ensuite, versions
 * incrémentées à chaque ligne touchée.
 */
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
    // Vainqueur DÉTERMINISTE : l'emplacement A. Le but n'est pas de simuler un
    // sport mais de comparer deux exécutions.
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

// ------------------------------------------------------------------
// PREUVE 3 — cascade de forfaits, des deux côtés
// ------------------------------------------------------------------

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
    // Le cas que l'application de référence rate. Elle ne balaie qu'au moment du
    // forfait : un combat dont l'adversaire est encore inconnu reste programmé,
    // et quand l'amont se résout, personne ne revient vérifier.
    const depart = bracket(8);
    const demiFinale = depart.find((f) => f.division === 2 && f.indexInDivision === 0)!;
    // On élimine quelqu'un qui n'entre en piste qu'au 2e tour, dont
    // l'emplacement est encore vide au moment du forfait.
    expect(demiFinale.slotA === null || demiFinale.slotB === null).toBe(true);

    const premierTour = depart.filter((f) => f.division === 3 && !f.isBye);
    const futurQualifie = premierTour[0]!.slotA!;
    const plan = planForfeit(depart, new Set([futurQualifie]));
    const apres = appliquerNavigateur(depart, plan);

    // Son combat du 1er tour est forfaité, et son adversaire avance.
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

    // Le combat aval se retrouve avec un emplacement vide : on ne fait avancer
    // personne d'office, on demande un arbitrage.
    const aval = findNextSlot(depart, premier)!;
    const cible = apres.find((f) => f.id === aval.fightId)!;
    expect(aval.slot === "A" ? cible.slotA : cible.slotB).toBeNull();
    expect(cible.needsArbitration).toBe(true);
  });

  it("ne touche JAMAIS un combat déjà terminé", () => {
    // Un compétiteur qui a gagné avant de se peser garde sa victoire : seuls ses
    // combats à venir tombent.
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
    // Écart assumé avec l'application de référence, qui l'y place en comptant sur
    // le staff pour l'en retirer. Placer un athlète éliminé dans un combat de
    // médaille est faux.
    const depart = bracket(8);
    const demie = depart.find((f) => f.division === 2 && f.indexInDivision === 0)!;
    // On remplit la demie puis on élimine celui qui va la perdre.
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

// ------------------------------------------------------------------
// PREUVE 4 — annulation
// ------------------------------------------------------------------

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
    // Le second forfait reste terminé : annuler un pointage ne ressuscite pas
    // une journée.
    expect(apres.find((f) => f.id === premiers[1]!.id)!.state).toBe("finished");
    expect(apres.find((f) => f.id === premiers[0]!.id)!.state).toBe("scheduled");
  });
});

// ------------------------------------------------------------------
// PREUVE 5 — idempotence et attendu
// ------------------------------------------------------------------

describe("PREUVE 5 — le plan porte ce que l'appelant croyait vrai", () => {
  it("l'attendu décrit l'état AVANT, pas après", () => {
    const depart = bracket(8);
    const premier = depart.find((f) => f.division === 3 && !f.isBye && f.slotA && f.slotB)!;
    const plan = planFinish(depart, premier.id, premier.slotA!, "points");
    const attendu = plan.expected.find((e) => e.fightId === premier.id)!;
    // C'est ce que le serveur comparera : si un autre appareil est passé avant,
    // `state` ou `version` diffèrent et le plan est refusé.
    expect(attendu.state).toBe("scheduled");
    expect(attendu.version).toBe(0);
  });

  it("l'attendu couvre AUSSI les cibles de propagation", () => {
    const depart = bracket(8);
    const premier = depart.find((f) => f.division === 3 && !f.isBye && f.slotA && f.slotB)!;
    const aval = findNextSlot(depart, premier)!;
    const plan = planFinish(depart, premier.id, premier.slotA!, "points");
    // Sans cela, deux combats pourraient écrire le même emplacement aval sans
    // que le second s'en aperçoive.
    expect(plan.expected.map((e) => e.fightId)).toContain(aval.fightId);
  });
});

// ------------------------------------------------------------------
// PREUVE 6 — podium
// ------------------------------------------------------------------

describe("PREUVE 6 — le podium", () => {
  it("un tournoi joué en entier donne un podium complet", () => {
    const final = jouerTournoi(bracket(8), appliquerNavigateur);
    const podium = computePodium(final, { thirdPlaceMode: "pool3" });
    expect(podium.complete).toBe(true);
    expect(podium.gold).not.toBeNull();
    expect(podium.silver).not.toBeNull();
    expect(podium.bronze).toHaveLength(1);
  });

  it("un combat de 3e place PRÉVU mais non joué ne retombe pas sur deux bronzes", () => {
    // Le défaut de l'application de référence : elle décernait deux bronzes ex
    // æquo alors qu'un seul est en jeu.
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

    const podium = computePodium(etat, { thirdPlaceMode: "pool3" });
    expect(podium.bronze).toEqual([]);
    expect(podium.complete).toBe(false);
    expect(podium.missing).toContain("Petite finale prévue mais non terminée");
  });

  it("en double bronze, les deux perdants de demie sont ex æquo", () => {
    const final = jouerTournoi(bracket(8, "shared_bronze"), appliquerNavigateur);
    const podium = computePodium(final, { thirdPlaceMode: "shared_bronze" });
    expect(podium.bronze).toHaveLength(2);
    expect(podium.complete).toBe(true);
  });

  it("un seul inscrit : or automatique, et ce n'est pas un podium incomplet", () => {
    const podium = computePodium([], { thirdPlaceMode: "pool3", singleCompetitor: "r1" });
    expect(podium.gold).toBe("r1");
    expect(podium.complete).toBe(true);
    expect(podium.missing).toEqual([]);
  });

  it("aucun combat : le motif est écrit, pas laissé muet", () => {
    const podium = computePodium([], { thirdPlaceMode: "pool3" });
    expect(podium.complete).toBe(false);
    expect(podium.missing).toContain("Aucun combat dans cette catégorie");
  });
});

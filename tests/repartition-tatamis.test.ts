import { describe, expect, it } from "vitest";
import { tapisDuCombatAbsolut, TAPIS_ADMIS_ABSOLUT } from "../src/absolut-regles";
import {
  affecterLesTatamis,
  estNombreDeTatamisAdmis,
  libelleDePartie,
  libelleDesTatamis,
  NOMBRES_DE_TATAMIS_ADMIS,
  partiesDuCombat,
  plafondDeRepartition,
  proposerLaRepartition,
  repartirLesCombats,
  tatamisApresArbitrage,
  tatamisSelonLEffectif,
  valeursAdmisesDeRepartition,
} from "../src/repartition-tatamis";
import { tableau, tatamis } from "./aides-planning";

const identifier = (fights: ReturnType<typeof tableau>) =>
  fights.map((f) => ({ ...f, id: `${f.division}:${f.indexInDivision}:${f.type}` }));

describe("le nombre de tatamis admis", () => {
  it("admet tout nombre de 1 à 8, 3, 5, 6 et 7 compris (REP.1 A)", () => {
    expect([...NOMBRES_DE_TATAMIS_ADMIS]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (const admis of [1, 2, 3, 4, 5, 6, 7, 8]) expect(estNombreDeTatamisAdmis(admis)).toBe(true);
    for (const refuse of [0, 9, 16, 2.5, -1, Number.NaN]) {
      expect(estNombreDeTatamisAdmis(refuse)).toBe(false);
    }
  });

  it("ne suit plus les absoluts du jour J, qui restent sur 1, 2, 4 ou 8 tapis", () => {
    expect([...TAPIS_ADMIS_ABSOLUT]).toEqual([1, 2, 4, 8]);
    expect(NOMBRES_DE_TATAMIS_ADMIS).not.toBe(TAPIS_ADMIS_ABSOLUT);
  });

  it("plafonne au nombre de tatamis de la compétition, huit au plus", () => {
    expect(plafondDeRepartition(1)).toBe(1);
    expect(plafondDeRepartition(3)).toBe(3);
    expect(plafondDeRepartition(6)).toBe(6);
    expect(plafondDeRepartition(7)).toBe(7);
    expect(plafondDeRepartition(8)).toBe(8);
    expect(plafondDeRepartition(12)).toBe(8);
    expect(plafondDeRepartition(0)).toBe(1);
    expect(plafondDeRepartition(Number.NaN)).toBe(1);
  });

  it("offre les trois tatamis d'une compétition qui en compte trois", () => {
    expect(valeursAdmisesDeRepartition(3)).toEqual([1, 2, 3]);
    expect(valeursAdmisesDeRepartition(6)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(valeursAdmisesDeRepartition(8)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(valeursAdmisesDeRepartition(12)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe("la proposition de répartition", () => {
  it("suit les seuils du client : 16 / 32 / 64 / au-delà", () => {
    expect(tatamisSelonLEffectif(16)).toBe(1);
    expect(tatamisSelonLEffectif(17)).toBe(2);
    expect(tatamisSelonLEffectif(32)).toBe(2);
    expect(tatamisSelonLEffectif(33)).toBe(4);
    expect(tatamisSelonLEffectif(64)).toBe(4);
    expect(tatamisSelonLEffectif(65)).toBe(8);
    expect(tatamisSelonLEffectif(200)).toBe(8);
  });

  it("propose 8 tatamis pour la Blanche Adulte Homme Pena de Charléty (128 inscrits, 8 tatamis)", () => {
    const proposition = proposerLaRepartition({ inscrits: 128, tatamisDeLaCompetition: 8 });
    expect(proposition.proposition).toBe(8);
    expect(proposition.motif).toBe("effectif");
    expect(proposition.alternativeSuggeree).toBeNull();
  });

  it("propose 2 tatamis pour une catégorie de 20", () => {
    const proposition = proposerLaRepartition({ inscrits: 20, tatamisDeLaCompetition: 8 });
    expect(proposition.proposition).toBe(2);
    expect(proposition.alternativeSuggeree).toBe(4);
  });

  it("propose 3 tatamis pour une catégorie de 40 dans une compétition à 3 tatamis", () => {
    const proposition = proposerLaRepartition({ inscrits: 40, tatamisDeLaCompetition: 3 });
    expect(proposition.proposition).toBe(3);
    expect(proposition.motif).toBe("plafonne_par_la_competition");
    expect(proposition.valeursAdmises).toEqual([1, 2, 3]);
    expect(proposition.alternativeSuggeree).toBeNull();
  });

  it("garde les seuils sur 6 tatamis et ne plafonne qu'au-delà de 64 inscrits", () => {
    expect(proposerLaRepartition({ inscrits: 40, tatamisDeLaCompetition: 6 })).toMatchObject({
      proposition: 4,
      motif: "effectif",
    });
    expect(proposerLaRepartition({ inscrits: 70, tatamisDeLaCompetition: 6 })).toMatchObject({
      proposition: 6,
      motif: "plafonne_par_la_competition",
    });
    expect(proposerLaRepartition({ inscrits: 20, tatamisDeLaCompetition: 3 })).toMatchObject({
      proposition: 2,
      alternativeSuggeree: 3,
      motif: "effectif",
    });
  });

  it("offre 2 tatamis en alternative jusqu'à 16 inscrits, 4 de 17 à 32, aucune au-delà", () => {
    expect(proposerLaRepartition({ inscrits: 16, tatamisDeLaCompetition: 8 })).toMatchObject({
      proposition: 1,
      alternativeSuggeree: 2,
    });
    expect(proposerLaRepartition({ inscrits: 32, tatamisDeLaCompetition: 8 })).toMatchObject({
      proposition: 2,
      alternativeSuggeree: 4,
    });
    expect(
      proposerLaRepartition({ inscrits: 33, tatamisDeLaCompetition: 8 }).alternativeSuggeree,
    ).toBeNull();
  });

  it("ne répartit jamais une poule, un tableau de trois ni une catégorie à deux inscrits", () => {
    expect(
      proposerLaRepartition({ inscrits: 90, tatamisDeLaCompetition: 8, format: "pools" }),
    ).toMatchObject({ proposition: 1, motif: "format_non_reparti" });
    expect(proposerLaRepartition({ inscrits: 3, tatamisDeLaCompetition: 8 })).toMatchObject({
      proposition: 1,
      motif: "format_non_reparti",
    });
    expect(proposerLaRepartition({ inscrits: 2, tatamisDeLaCompetition: 8 })).toMatchObject({
      proposition: 1,
      motif: "format_non_reparti",
    });
  });

  it("plafonne à 8 tatamis au-delà du plafond réglementaire de 128 inscrits", () => {
    expect(proposerLaRepartition({ inscrits: 174, tatamisDeLaCompetition: 12 }).proposition).toBe(
      8,
    );
  });

  it("accepte, modifie ou refuse la proposition", () => {
    const proposition = proposerLaRepartition({ inscrits: 128, tatamisDeLaCompetition: 8 });
    expect(tatamisApresArbitrage(proposition, { etat: "proposee" })).toBe(8);
    expect(tatamisApresArbitrage(proposition, { etat: "acceptee" })).toBe(8);
    expect(tatamisApresArbitrage(proposition, { etat: "refusee" })).toBe(1);
    expect(tatamisApresArbitrage(proposition, { etat: "modifiee", valeurChoisie: 4 })).toBe(4);
  });

  it("accepte 3, 5, 6 ou 7 tatamis choisis par le responsable", () => {
    const proposition = proposerLaRepartition({ inscrits: 128, tatamisDeLaCompetition: 8 });
    for (const choisie of [3, 5, 6, 7]) {
      expect(tatamisApresArbitrage(proposition, { etat: "modifiee", valeurChoisie: choisie })).toBe(
        choisie,
      );
    }
  });

  it("refuse une valeur modifiée hors des nombres admis ou au-delà des tatamis de la compétition", () => {
    const proposition = proposerLaRepartition({ inscrits: 128, tatamisDeLaCompetition: 8 });
    for (const refusee of [0, 9, undefined]) {
      expect(() =>
        tatamisApresArbitrage(proposition, { etat: "modifiee", valeurChoisie: refusee }),
      ).toThrow(RangeError);
    }
    const surTrois = proposerLaRepartition({ inscrits: 40, tatamisDeLaCompetition: 3 });
    expect(() => tatamisApresArbitrage(surTrois, { etat: "modifiee", valeurChoisie: 4 })).toThrow(
      RangeError,
    );
  });
});

describe("le découpage par parties du tableau", () => {
  it("refuse un nombre de parties non admis", () => {
    for (const refuse of [0, 9, 2.5]) {
      expect(() =>
        partiesDuCombat({ division: 3, indexInDivision: 0, type: "BraketFight" }, refuse),
      ).toThrow(RangeError);
    }
  });

  it("à une seule partie, tout se joue sur le tatami de la catégorie", () => {
    const decoupe = partiesDuCombat({ division: 5, indexInDivision: 9, type: "BraketFight" }, 1);
    expect(decoupe).toEqual({ partie: 0, partiesReunies: [0], convergence: false });
  });

  it("répartit les 64 combats du premier tour d'un tableau de 128 à 8 par partie", () => {
    const compte = new Map<number, number>();
    for (let index = 0; index < 64; index += 1) {
      const decoupe = partiesDuCombat(
        { division: 7, indexInDivision: index, type: "BraketFight" },
        8,
      );
      expect(decoupe.convergence).toBe(false);
      compte.set(decoupe.partie, (compte.get(decoupe.partie) ?? 0) + 1);
    }
    expect([...compte.entries()].sort((a, b) => a[0] - b[0])).toEqual([
      [0, 8],
      [1, 8],
      [2, 8],
      [3, 8],
      [4, 8],
      [5, 8],
      [6, 8],
      [7, 8],
    ]);
  });

  it("garde chaque athlète sur son tatami jusqu'aux quarts", () => {
    for (const division of [7, 6, 5, 4]) {
      const combats = 2 ** (division - 1);
      for (let index = 0; index < combats; index += 1) {
        const decoupe = partiesDuCombat(
          { division, indexInDivision: index, type: "BraketFight" },
          8,
        );
        expect(decoupe.convergence).toBe(false);
        expect(decoupe.partiesReunies).toHaveLength(1);
      }
    }
  });

  it("converge progressivement à 8 parties : quarts sur 4, demi-finales sur 2, finale sur 1", () => {
    const distinctes = (division: number) => {
      const combats = Math.max(1, 2 ** (division - 1));
      const parties = new Set<number>();
      for (let index = 0; index < combats; index += 1) {
        parties.add(
          partiesDuCombat({ division, indexInDivision: index, type: "BraketFight" }, 8).partie,
        );
      }
      return parties.size;
    };
    expect(distinctes(4)).toBe(8);
    expect(distinctes(3)).toBe(4);
    expect(distinctes(2)).toBe(2);
    expect(distinctes(1)).toBe(1);
  });

  it("réunit les parties deux à deux à chaque tour de convergence", () => {
    expect(partiesDuCombat({ division: 3, indexInDivision: 0, type: "BraketFight" }, 8)).toEqual({
      partie: 0,
      partiesReunies: [0, 1],
      convergence: true,
    });
    expect(partiesDuCombat({ division: 3, indexInDivision: 3, type: "BraketFight" }, 8)).toEqual({
      partie: 6,
      partiesReunies: [6, 7],
      convergence: true,
    });
    expect(
      partiesDuCombat({ division: 2, indexInDivision: 1, type: "BraketFight" }, 8).partiesReunies,
    ).toEqual([4, 5, 6, 7]);
    expect(
      partiesDuCombat({ division: 1, indexInDivision: 0, type: "BraketFight" }, 8).partiesReunies,
    ).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("à 4 parties, seules les demi-finales et la finale convergent", () => {
    expect(
      partiesDuCombat({ division: 3, indexInDivision: 2, type: "BraketFight" }, 4),
    ).toMatchObject({ partie: 2, convergence: false });
    expect(
      partiesDuCombat({ division: 2, indexInDivision: 0, type: "BraketFight" }, 4).partiesReunies,
    ).toEqual([0, 1]);
    expect(
      partiesDuCombat({ division: 1, indexInDivision: 0, type: "BraketFight" }, 4).partiesReunies,
    ).toEqual([0, 1, 2, 3]);
  });

  it("à 2 parties, seule la finale est regroupée", () => {
    expect(
      partiesDuCombat({ division: 2, indexInDivision: 1, type: "BraketFight" }, 2),
    ).toMatchObject({ partie: 1, convergence: false });
    expect(
      partiesDuCombat({ division: 1, indexInDivision: 0, type: "BraketFight" }, 2).partiesReunies,
    ).toEqual([0, 1]);
  });

  it("regroupe le combat pour la 3e place et le tableau de trois comme une finale", () => {
    expect(
      partiesDuCombat({ division: 2, indexInDivision: 2, type: "BraketFightPool3" }, 4),
    ).toMatchObject({ convergence: true, partiesReunies: [0, 1, 2, 3] });
    expect(
      partiesDuCombat({ division: 2, indexInDivision: 1, type: "BraketFightRepechage3" }, 2),
    ).toMatchObject({ convergence: true, partiesReunies: [0, 1] });
  });
});

function ancienDecoupage(
  combat: { division: number; indexInDivision: number; type: string },
  parties: number,
) {
  const toutes = Array.from({ length: parties }, (_, index) => index);
  if (parties === 1) return { partie: 0, partiesReunies: toutes, convergence: false };
  if (combat.type !== "BraketFight" || combat.division <= 1) {
    return { partie: 0, partiesReunies: toutes, convergence: true };
  }
  const combatsDuTour = 2 ** (combat.division - 1);
  if (combatsDuTour >= parties) {
    const brut = Math.floor((combat.indexInDivision * parties) / combatsDuTour);
    const partie = Math.min(parties - 1, Math.max(0, brut));
    return { partie, partiesReunies: [partie], convergence: false };
  }
  const largeur = parties / combatsDuTour;
  const debut = Math.min(parties - largeur, Math.max(0, combat.indexInDivision * largeur));
  return {
    partie: debut,
    partiesReunies: Array.from({ length: largeur }, (_, index) => debut + index),
    convergence: true,
  };
}

const premierTour = (parties: number, division: number) => {
  const compte = Array.from({ length: parties }, () => 0);
  for (let index = 0; index < 2 ** (division - 1); index += 1) {
    const decoupe = partiesDuCombat(
      { division, indexInDivision: index, type: "BraketFight" },
      parties,
    );
    expect(decoupe.convergence).toBe(false);
    compte[decoupe.partie] = (compte[decoupe.partie] ?? 0) + 1;
  }
  return compte;
};

const reunies = (parties: number, division: number) =>
  Array.from({ length: 2 ** (division - 1) }, (_, index) =>
    partiesDuCombat({ division, indexInDivision: index, type: "BraketFight" }, parties),
  ).map((d) => (d.convergence ? d.partiesReunies : d.partie));

describe("le découpage par morceaux entiers du tableau (REP.4 A)", () => {
  it("à 1, 2, 4 et 8 parties, découpe chaque combat exactement comme avant", () => {
    let compares = 0;
    for (const parties of [1, 2, 4, 8]) {
      for (let division = 0; division <= 8; division += 1) {
        const combats = Math.max(1, 2 ** Math.max(0, division - 1));
        for (let index = 0; index < combats + 2; index += 1) {
          for (const type of [
            "BraketFight",
            "BraketFightPool3",
            "BraketFightRepechage3",
          ] as const) {
            const combat = { division, indexInDivision: index, type };
            expect(
              partiesDuCombat(combat, parties),
              `${parties} ${division}:${index} ${type}`,
            ).toEqual(ancienDecoupage(combat, parties));
            compares += 1;
          }
        }
      }
    }
    expect(compares).toBeGreaterThan(1000);
  });

  it("à 3 parties : un quart, un quart et une moitié", () => {
    expect(premierTour(3, 6)).toEqual([8, 8, 16]);
    expect(reunies(3, 3)).toEqual([0, 1, 2, 2]);
    expect(reunies(3, 2)).toEqual([[0, 1], 2]);
    expect(partiesDuCombat({ division: 1, indexInDivision: 0, type: "BraketFight" }, 3)).toEqual({
      partie: 0,
      partiesReunies: [0, 1, 2],
      convergence: true,
    });
  });

  it("à 5 parties : deux huitièmes et trois quarts", () => {
    expect(premierTour(5, 6)).toEqual([4, 4, 8, 8, 8]);
    expect(reunies(5, 4)).toEqual([0, 1, 2, 2, 3, 3, 4, 4]);
    expect(reunies(5, 3)).toEqual([[0, 1], 2, 3, 4]);
    expect(reunies(5, 2)).toEqual([
      [0, 1, 2],
      [3, 4],
    ]);
  });

  it("à 6 parties : quatre huitièmes et deux quarts", () => {
    expect(premierTour(6, 6)).toEqual([4, 4, 4, 4, 8, 8]);
    expect(reunies(6, 3)).toEqual([[0, 1], [2, 3], 4, 5]);
    expect(reunies(6, 2)).toEqual([
      [0, 1, 2, 3],
      [4, 5],
    ]);
  });

  it("à 7 parties : six huitièmes et un quart", () => {
    expect(premierTour(7, 6)).toEqual([4, 4, 4, 4, 4, 4, 8]);
    expect(reunies(7, 3)).toEqual([[0, 1], [2, 3], [4, 5], 6]);
    expect(reunies(7, 2)).toEqual([
      [0, 1, 2, 3],
      [4, 5, 6],
    ]);
  });

  it("garde chaque branche intacte jusqu'à son regroupement, de 1 à 8 parties", () => {
    for (let parties = 1; parties <= 8; parties += 1) {
      for (let division = 1; division <= 7; division += 1) {
        for (let index = 0; index < 2 ** (division - 1); index += 1) {
          const combat = partiesDuCombat(
            { division, indexInDivision: index, type: "BraketFight" },
            parties,
          );
          const enfants = [2 * index, 2 * index + 1].map((indexEnfant) =>
            partiesDuCombat(
              { division: division + 1, indexInDivision: indexEnfant, type: "BraketFight" },
              parties,
            ),
          );
          const union = [...new Set(enfants.flatMap((e) => e.partiesReunies))].sort(
            (a, b) => a - b,
          );
          const cle = `${parties} parties, ${division}:${index}`;
          expect(combat.partiesReunies, cle).toEqual(union);
          if (!combat.convergence) {
            for (const enfant of enfants) {
              expect(enfant.convergence, cle).toBe(false);
              expect(enfant.partie, cle).toBe(combat.partie);
            }
          }
          expect(combat.partie, cle).toBe(combat.partiesReunies[0]);
        }
      }
    }
  });

  it("donne au tatami de la moitié deux fois plus de combats, sans en faire changer un athlète", () => {
    const fights = identifier(tableau(32, "moitie"));
    const places = repartirLesCombats({ tatamis: tatamis(3), combats: fights });
    const parTatami = new Map<string, number>();
    for (const fight of fights) {
      const place = places.get(fight.id);
      if (fight.isBye || place === undefined || place.convergence) continue;
      parTatami.set(place.tatamiId, (parTatami.get(place.tatamiId) ?? 0) + 1);
    }
    expect(Object.fromEntries(parTatami)).toEqual({ t1: 7, t2: 7, t3: 15 });
    expect(places.get("2:1:BraketFight")).toMatchObject({
      tatamiId: "t3",
      convergence: false,
      libelleDePartie: "Partie 3/3",
    });
    expect(places.get("2:0:BraketFight")?.partiesReunies).toEqual([0, 1]);
    expect(places.get("1:0:BraketFight")?.partiesReunies).toEqual([0, 1, 2]);
  });

  it("place chaque combat sur un tatami de ses parties réunies, de 3 à 7 tatamis", () => {
    for (const nombre of [3, 5, 6, 7]) {
      const fights = identifier(tableau(64, `m${nombre}`));
      const liste = tatamis(nombre);
      const places = repartirLesCombats({ tatamis: liste, combats: fights });
      expect(places.size).toBe(fights.length);
      for (const fight of fights) {
        const place = places.get(fight.id);
        const admis = (place?.partiesReunies ?? []).map((partie) => liste[partie]?.id);
        expect(admis, `${nombre} tatamis, ${fight.id}`).toContain(place?.tatamiId);
        if (place?.convergence === false) {
          expect(place.libelleDePartie).toBe(`Partie ${place.partie + 1}/${nombre}`);
        }
      }
      const utilises = new Set([...places.values()].map((place) => place.tatamiId));
      expect(utilises.size, `${nombre} tatamis`).toBe(nombre);
    }
  });
});

describe("l'affectation d'un combat à son tatami", () => {
  it("sans charge connue, rend le même tapis que la console absolut", () => {
    for (const nTapis of [1, 2, 4, 8]) {
      const fights = identifier(tableau(32, `abs${nTapis}`));
      const places = repartirLesCombats({ tatamis: tatamis(nTapis), combats: fights });
      for (const fight of fights) {
        const attendu = tapisDuCombatAbsolut(fight, nTapis, false);
        expect(places.get(fight.id)?.tatamiId).toBe(`t${attendu + 1}`);
      }
    }
  });

  it("place un combat de convergence sur celui des tatamis réunis qui finit le plus tard", () => {
    const fights = identifier(tableau(8));
    const places = repartirLesCombats({
      tatamis: tatamis(4),
      combats: fights,
      chargeParTatami: { t1: 10, t2: 99, t3: 10, t4: 50 },
    });
    expect(places.get("2:0:BraketFight")?.tatamiId).toBe("t2");
    expect(places.get("2:1:BraketFight")?.tatamiId).toBe("t4");
    expect(places.get("1:0:BraketFight")?.tatamiId).toBe("t2");
  });

  it("à charge égale, retient le plus petit numéro", () => {
    const fights = identifier(tableau(8));
    const places = repartirLesCombats({
      tatamis: [
        { id: "haut", numero: 7 },
        { id: "bas", numero: 3 },
      ],
      combats: fights,
      chargeParTatami: { haut: 42, bas: 42 },
    });
    expect(places.get("1:0:BraketFight")?.tatamiId).toBe("bas");
  });

  it("accepte un tatami de finale imposé parmi les parties réunies", () => {
    const fights = identifier(tableau(8));
    const places = repartirLesCombats({
      tatamis: tatamis(4),
      combats: fights,
      tatamiParCombat: { "1:0:BraketFight": "t3" },
    });
    expect(places.get("1:0:BraketFight")?.tatamiId).toBe("t3");
  });

  it("refuse un tatami imposé hors des parties réunies par le combat", () => {
    const fights = identifier(tableau(8));
    expect(() =>
      repartirLesCombats({
        tatamis: tatamis(4),
        combats: fights,
        tatamiParCombat: { "2:0:BraketFight": "t4" },
      }),
    ).toThrow(RangeError);
  });

  it("nomme les parties, et laisse les combats de convergence au nom de leur tour", () => {
    const fights = identifier(tableau(8));
    const places = repartirLesCombats({ tatamis: tatamis(4), combats: fights });
    expect(places.get("3:0:BraketFight")?.libelleDePartie).toBe("Partie 1/4");
    expect(places.get("3:3:BraketFight")?.libelleDePartie).toBe("Partie 4/4");
    expect(places.get("1:0:BraketFight")?.libelleDePartie).toBeNull();
  });

  it("ne nomme aucune partie pour une catégorie sur un seul tatami", () => {
    expect(libelleDePartie(0, 1)).toBeNull();
    expect(libelleDePartie(2, 8)).toBe("Partie 3/8");
  });
});

describe("le libellé des tatamis d'une catégorie", () => {
  it("nomme un tatami unique", () => {
    expect(libelleDesTatamis([3])).toBe("Tatami 3");
  });

  it("écrit « et » pour deux tatamis consécutifs, plutôt que « 1 à 2 »", () => {
    expect(libelleDesTatamis([1, 2])).toBe("Tatamis 1 et 2");
    expect(libelleDesTatamis([5, 6])).toBe("Tatamis 5 et 6");
  });

  it("abrège trois tatamis consécutifs et plus", () => {
    expect(libelleDesTatamis([1, 2, 3, 4])).toBe("Tatamis 1 à 4");
    expect(libelleDesTatamis([2, 3, 4])).toBe("Tatamis 2 à 4");
  });

  it("liste les tatamis non consécutifs", () => {
    expect(libelleDesTatamis([1, 3, 5, 7])).toBe("Tatamis 1, 3, 5 et 7");
    expect(libelleDesTatamis([4, 1])).toBe("Tatamis 1 et 4");
  });

  it("ignore les doublons et l'ordre d'entrée", () => {
    expect(libelleDesTatamis([4, 2, 3, 2])).toBe("Tatamis 2 à 4");
    expect(libelleDesTatamis([])).toBe("");
  });
});

describe("l'affectation des catégories aux tatamis", () => {
  it("donne à une catégorie répartie autant de tatamis distincts que de parties", () => {
    const affectations = affecterLesTatamis(
      [
        { id: "grande", chargeSecondes: 8 * 3600, parties: 8, rangDePlanning: 0 },
        { id: "petite", chargeSecondes: 600, parties: 1, rangDePlanning: 1 },
      ],
      tatamis(8),
    );
    const grande = affectations.get("grande");
    expect(grande?.tatamis).toHaveLength(8);
    expect(new Set(grande?.tatamis.map((t) => t.id)).size).toBe(8);
    expect(affectations.get("petite")?.tatamis).toHaveLength(1);
  });

  it("rend les tatamis d'une partie dans l'ordre des numéros", () => {
    const affectations = affecterLesTatamis(
      [{ id: "c", chargeSecondes: 3600, parties: 4, rangDePlanning: 0 }],
      tatamis(4),
    );
    expect(affectations.get("c")?.tatamis.map((t) => t.numero)).toEqual([1, 2, 3, 4]);
  });

  it("équilibre les charges entre les tatamis", () => {
    const categories = Array.from({ length: 16 }, (_, index) => ({
      id: `c${index}`,
      chargeSecondes: (index + 1) * 600,
      parties: 1,
      rangDePlanning: index,
    }));
    const affectations = affecterLesTatamis(categories, tatamis(4));
    const charges = new Map<string, number>();
    for (const categorie of categories) {
      const cible = affectations.get(categorie.id)?.tatamis[0]?.id ?? "";
      charges.set(cible, (charges.get(cible) ?? 0) + categorie.chargeSecondes);
    }
    const valeurs = [...charges.values()];
    expect(valeurs).toHaveLength(4);
    expect(Math.max(...valeurs) - Math.min(...valeurs)).toBeLessThanOrEqual(600);
  });

  it("plafonne le nombre de parties au nombre de tatamis de la compétition", () => {
    const affectations = affecterLesTatamis(
      [{ id: "c", chargeSecondes: 3600, parties: 8, rangDePlanning: 0 }],
      tatamis(3),
    );
    expect(affectations.get("c")?.parties).toBe(3);
    expect(affectations.get("c")?.tatamis.map((t) => t.numero)).toEqual([1, 2, 3]);
  });

  it("refuse une compétition sans tatami", () => {
    expect(() => affecterLesTatamis([], [])).toThrow();
  });
});

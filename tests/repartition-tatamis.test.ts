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
  it("n'admet que 1, 2, 4 ou 8, jamais 3", () => {
    expect([...NOMBRES_DE_TATAMIS_ADMIS]).toEqual([1, 2, 4, 8]);
    for (const admis of [1, 2, 4, 8]) expect(estNombreDeTatamisAdmis(admis)).toBe(true);
    for (const refuse of [0, 3, 5, 6, 7, 9]) expect(estNombreDeTatamisAdmis(refuse)).toBe(false);
  });

  it("partage sa liste avec les absoluts du jour J", () => {
    expect([...NOMBRES_DE_TATAMIS_ADMIS]).toEqual([...TAPIS_ADMIS_ABSOLUT]);
  });

  it("plafonne au plus grand admis qui tient dans la compétition", () => {
    expect(plafondDeRepartition(1)).toBe(1);
    expect(plafondDeRepartition(3)).toBe(2);
    expect(plafondDeRepartition(7)).toBe(4);
    expect(plafondDeRepartition(8)).toBe(8);
    expect(plafondDeRepartition(12)).toBe(8);
  });

  it("laisse le troisième tatami libre quand la compétition en compte trois", () => {
    expect(valeursAdmisesDeRepartition(3)).toEqual([1, 2]);
    expect(valeursAdmisesDeRepartition(8)).toEqual([1, 2, 4, 8]);
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

  it("propose 2 tatamis pour une catégorie de 40 dans une compétition à 3 tatamis", () => {
    const proposition = proposerLaRepartition({ inscrits: 40, tatamisDeLaCompetition: 3 });
    expect(proposition.proposition).toBe(2);
    expect(proposition.motif).toBe("plafonne_par_la_competition");
    expect(proposition.valeursAdmises).toEqual([1, 2]);
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

  it("refuse une valeur modifiée hors des nombres admis", () => {
    const proposition = proposerLaRepartition({ inscrits: 128, tatamisDeLaCompetition: 8 });
    expect(() =>
      tatamisApresArbitrage(proposition, { etat: "modifiee", valeurChoisie: 3 }),
    ).toThrow(RangeError);
    expect(() =>
      tatamisApresArbitrage(proposition, { etat: "modifiee", valeurChoisie: undefined }),
    ).toThrow(RangeError);
  });
});

describe("le découpage par parties du tableau", () => {
  it("refuse un nombre de parties non admis", () => {
    expect(() =>
      partiesDuCombat({ division: 3, indexInDivision: 0, type: "BraketFight" }, 3),
    ).toThrow(RangeError);
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
    expect(affectations.get("c")?.parties).toBe(2);
  });

  it("refuse une compétition sans tatami", () => {
    expect(() => affecterLesTatamis([], [])).toThrow();
  });
});

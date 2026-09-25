import { describe, expect, it } from "vitest";
import {
  planifierCombats,
  type EntreeDePlanification,
  type PlacementDeCombat,
} from "../src/ordonnanceur-planning";
import { heure, hhmm, monter, tableau, tatamis } from "./aides-planning";

const UNE_MINUTE = 60;
const NEUF_HEURES = heure("09:00");

const parRang = (resultat: Map<string, PlacementDeCombat>, categorieId: string) =>
  [...resultat.values()]
    .filter((p) => p.categorieId === categorieId)
    .sort((a, b) => a.rang - b.rang)
    .map(
      (p) =>
        `${p.fightId.replace(":BraketFight", "").replace(`${categorieId}:`, "")} ${hhmm(p.debutMs)}`,
    );

describe("le repos de confort catégorie par catégorie (RPS.4 A, choisi par journée)", () => {
  const montage = () =>
    monter([
      {
        id: "a",
        fights: tableau(8, "A"),
        tatamis: tatamis(1),
        dureeSecondes: 300,
        rangDePlanning: 0,
      },
      {
        id: "b",
        fights: tableau(8, "B"),
        tatamis: tatamis(1, "u"),
        dureeSecondes: 300,
        rangDePlanning: 1,
      },
    ]);
  const entree = (confortPour: ReadonlySet<string>): EntreeDePlanification => {
    const m = montage();
    return {
      espacementSecondes: UNE_MINUTE,
      tatamis: [
        { id: "t1", numero: 1, debutParJour: { 0: NEUF_HEURES } },
        { id: "u1", numero: 2, debutParJour: { 0: NEUF_HEURES } },
      ],
      categories: m.categories.map((c) => ({ ...c, reposDeConfort: confortPour.has(c.id) })),
      combats: m.combats,
    };
  };

  it("seule la catégorie marquée reçoit deux durées de repos ; l'autre garde le repos réglementaire", () => {
    const sans = planifierCombats(entree(new Set()));
    const avec = planifierCombats(entree(new Set(["a"])));
    // Témoin : sans la marque, les deux catégories ont le repos réglementaire.
    expect(parRang(sans.combats, "a")).toEqual(parRang(sans.combats, "b"));
    expect(parRang(avec.combats, "a")).toEqual([
      "3:0 09:00",
      "3:1 09:06",
      "3:2 09:12",
      "3:3 09:18",
      "2:0 09:24",
      "2:1 09:33",
      "1:0 09:48",
    ]);
    expect(parRang(avec.combats, "b")).toEqual(parRang(sans.combats, "b"));
  });

  it("la marque de catégorie vaut le repos de confort de toute l'entrée", () => {
    const pourToutes = planifierCombats({ ...entree(new Set()), reposDeConfort: true });
    const pourChacune = planifierCombats(entree(new Set(["a", "b"])));
    const lire = (r: typeof pourToutes) =>
      [...r.combats.values()].map((p) => `${p.fightId}|${p.debutMs}`).sort();
    expect(lire(pourChacune)).toEqual(lire(pourToutes));
  });
});

describe("le début au plus tôt d'une branche sur un tatami (§9, REP.6 A)", () => {
  const entree = (plancher?: number): EntreeDePlanification => {
    const m = monter([
      {
        id: "a",
        fights: tableau(4, "A"),
        tatamis: tatamis(1),
        dureeSecondes: 300,
        rangDePlanning: 0,
      },
      {
        id: "b",
        fights: tableau(4, "B"),
        tatamis: tatamis(1),
        dureeSecondes: 300,
        rangDePlanning: 1,
      },
    ]);
    return {
      espacementSecondes: UNE_MINUTE,
      tatamis: [{ id: "t1", numero: 1, debutParJour: { 0: NEUF_HEURES } }],
      categories: m.categories.map((c) =>
        c.id === "a" && plancher !== undefined
          ? { ...c, debutAuPlusTotParTatami: { t1: plancher } }
          : c,
      ),
      combats: m.combats,
    };
  };

  it("la catégorie ne commence pas avant son heure sur ce tatami ; une autre catégorie du tatami passe en attendant", () => {
    const sans = planifierCombats(entree());
    // Témoin : sans décalage, la première catégorie du planning ouvre le tatami.
    expect(parRang(sans.combats, "a")[0]).toBe("2:0 09:00");
    const avec = planifierCombats(entree(heure("09:20")));
    expect(parRang(avec.combats, "b")[0]).toBe("2:0 09:00");
    for (const p of [...avec.combats.values()].filter((x) => x.categorieId === "a")) {
      expect(p.debutMs).toBeGreaterThanOrEqual(heure("09:20"));
    }
    expect(avec.combatsSansHoraire).toEqual([]);
  });

  it("un décalage sur un autre tatami ne change rien à celui-ci", () => {
    const m = entree();
    const ailleurs = planifierCombats({
      ...m,
      categories: m.categories.map((c) =>
        c.id === "a" ? { ...c, debutAuPlusTotParTatami: { t9: heure("12:00") } } : c,
      ),
    });
    const lire = (r: typeof ailleurs) =>
      [...r.combats.values()].map((p) => `${p.fightId}|${p.debutMs}`).sort();
    expect(lire(ailleurs)).toEqual(lire(planifierCombats(m)));
  });
});

import { describe, expect, it } from "vitest";
import {
  MAX_PAR_ENTITE,
  separationTenue,
  verifierSeparationAvantLaFinale,
  verifierSeparationDEquipe,
} from "../src/separation-equipe";
import { generateBracket, type BracketEntry, type GeneratedFight } from "../src/bracket-generator";
import { RANG_SPORTIF_SEEDING_PLAN } from "../src/placement-par-rang";

const combat = (
  indexInDivision: number,
  slotA: string | null,
  slotB: string | null,
  isBye = false,
): GeneratedFight => ({
  division: 1,
  indexInDivision,
  type: "BraketFight",
  slotA,
  slotB,
  isBye,
});

const inscrit = (
  registrationId: string,
  teamId: string | null,
  clubId: string | null = "k1",
): BracketEntry => ({
  registrationId,
  clubId,
  teamId,
});

describe("verifierSeparationDEquipe", () => {
  it("ne voit rien quand les équipes sont séparées", () => {
    const v = verifierSeparationDEquipe(
      [combat(0, "r1", "r2"), combat(1, "r3", "r4")],
      [inscrit("r1", "A"), inscrit("r2", "B"), inscrit("r3", "A"), inscrit("r4", "B")],
    );

    expect(v.rencontres).toEqual([]);
    expect(separationTenue(v)).toBe(true);
  });

  it("NOMME la rencontre interne, son combat et son entité", () => {
    const v = verifierSeparationDEquipe(
      [combat(0, "r1", "r2")],
      [inscrit("r1", "A"), inscrit("r2", "A")],
    );

    expect(v.rencontres).toEqual([
      {
        division: 1,
        indexInDivision: 0,
        entiteId: "A",
        registrationA: "r1",
        registrationB: "r2",
      },
    ]);
    expect(separationTenue(v)).toBe(false);
  });

  it("retombe sur le CLUB quand aucune sous-équipe n'est posée", () => {
    const v = verifierSeparationDEquipe(
      [combat(0, "r1", "r2")],
      [inscrit("r1", null, "k9"), inscrit("r2", null, "k9")],
    );

    expect(v.rencontres[0]?.entiteId).toBe("k9");
  });

  it("ignore les byes et les emplacements vides, sans les compter pour des rencontres", () => {
    const v = verifierSeparationDEquipe(
      [combat(0, "r1", null), combat(1, "r2", "r3", true), combat(2, null, null)],
      [inscrit("r1", "A"), inscrit("r2", "A"), inscrit("r3", "A")],
    );

    expect(v.rencontres).toEqual([]);
  });

  it("ne rattache pas un combattant SANS club ni équipe", () => {
    const v = verifierSeparationDEquipe(
      [combat(0, "r1", "r2")],
      [inscrit("r1", null, null), inscrit("r2", null, null)],
    );

    expect(v.rencontres).toEqual([]);
    expect(v.surchargees).toEqual([]);
  });

  it("DISTINGUE « le tirage a mal fait » de « la règle ne pouvait pas être tenue »", () => {
    const v = verifierSeparationDEquipe(
      [combat(0, "r1", "r4"), combat(1, "r2", "r3")],
      [inscrit("r1", "A"), inscrit("r2", "A"), inscrit("r3", "A"), inscrit("r4", "B")],
    );

    expect(v.surchargees).toEqual([{ entiteId: "A", effectif: 3 }]);
    expect(v.rencontres).toHaveLength(1);
  });

  it("ne signale pas une entité qui tient dans la borne", () => {
    const v = verifierSeparationDEquipe(
      [combat(0, "r1", "r3")],
      [inscrit("r1", "A"), inscrit("r2", "A"), inscrit("r3", "B")],
    );

    expect(MAX_PAR_ENTITE).toBe(2);
    expect(v.surchargees).toEqual([]);
  });

  it("rend un ordre STABLE : deux appels identiques rendent la même liste", () => {
    const entries = [
      inscrit("r1", "B"),
      inscrit("r2", "B"),
      inscrit("r3", "B"),
      inscrit("r4", "A"),
      inscrit("r5", "A"),
      inscrit("r6", "A"),
      inscrit("r7", "A"),
    ];
    const un = verifierSeparationDEquipe([], entries);
    const deux = verifierSeparationDEquipe([], [...entries].reverse());

    expect(un.surchargees).toEqual([
      { entiteId: "A", effectif: 4 },
      { entiteId: "B", effectif: 3 },
    ]);
    expect(deux.surchargees).toEqual(un.surchargees);
  });
});

describe("verifierSeparationAvantLaFinale (guide v1.3, §5 et §6)", () => {
  const premierTour = (feuilles: readonly (string | null)[]): GeneratedFight[] => {
    const division = Math.log2(feuilles.length);
    return Array.from({ length: feuilles.length / 2 }, (_, k) => ({
      division,
      indexInDivision: k,
      type: "BraketFight" as const,
      slotA: feuilles[2 * k] ?? null,
      slotB: feuilles[2 * k + 1] ?? null,
      isBye: (feuilles[2 * k] ?? null) === null || (feuilles[2 * k + 1] ?? null) === null,
    }));
  };
  const auRang = (n: number, equipes: Record<number, string>): BracketEntry[] =>
    Array.from({ length: n }, (_, i) => ({
      registrationId: `r${i + 1}`,
      clubId: `c${i + 1}`,
      teamId: equipes[i + 1] ?? null,
      rank: i + 1,
    }));

  it("voit deux coéquipiers dans une même moitié, que le premier tour ne voit pas", () => {
    // Le placement de v0.34.0 : #6 échangé avec #7, mais resté dans la moitié de #3.
    const entrees = auRang(8, { 3: "T", 6: "T" });
    const combats = premierTour(["r1", "r8", "r4", "r5", "r2", "r6", "r3", "r7"]);
    const verdict = verifierSeparationDEquipe(combats, entrees, { parRang: true });
    expect(verdict.rencontres).toEqual([]);
    expect(verdict.avantLaFinale).toEqual({
      paires: [{ entiteId: "T", registrationA: "r3", registrationB: "r6" }],
      inevitables: 0,
    });
  });

  it("rend un constat vide, mais présent, quand les moitiés sont tenues", () => {
    const entrees = auRang(8, { 3: "T", 6: "T" });
    const combats = premierTour(["r1", "r8", "r4", "r6", "r2", "r7", "r3", "r5"]);
    expect(verifierSeparationDEquipe(combats, entrees, { parRang: true }).avantLaFinale).toEqual({
      paires: [],
      inevitables: 0,
    });
  });

  it("au rang, classe inévitable ce que le guide ne permet pas d'éviter : #1 garde son tour blanc", () => {
    // Sept inscrits, trois paires parmi #2 à #7 : les séparer toutes mettrait quatre athlètes
    // dans la moitié de #1, qui perdrait son tour blanc. Une paire reste réunie.
    const entrees = auRang(7, { 2: "A", 3: "A", 4: "B", 5: "B", 6: "C", 7: "C" });
    const tableau = generateBracket(entrees, "s", {
      thirdPlaceMode: "shared_bronze",
      seedingPlan: RANG_SPORTIF_SEEDING_PLAN,
    });
    if (tableau.kind !== "bracket") throw new Error("tableau attendu");
    const auRangSportif = verifierSeparationAvantLaFinale(tableau.fights, entrees, {
      parRang: true,
    });
    expect(auRangSportif.paires).toHaveLength(1);
    expect(auRangSportif.inevitables).toBe(1);
    // Sans rang, rien n'oblige #1 à garder son tour blanc : la même paire serait évitable.
    expect(verifierSeparationAvantLaFinale(tableau.fights, entrees).inevitables).toBe(0);
  });

  it("à trois, voit la 1re demi-finale ; inévitable seulement si les trois sont coéquipiers", () => {
    const tableau = (equipes: Record<number, string>) => {
      const entrees = auRang(3, equipes);
      const t = generateBracket(entrees, "s", { thirdPlaceMode: "shared_bronze" });
      if (t.kind !== "bracket") throw new Error("tableau attendu");
      const demi = t.fights.find((f) => f.type === "BraketFight" && f.slotA && f.slotB);
      return { entrees, fights: t.fights, demi };
    };
    const deux = tableau({ 1: "T", 2: "T", 3: "T" });
    const verdict = verifierSeparationAvantLaFinale(deux.fights, deux.entrees, { parRang: true });
    expect(verdict.paires).toHaveLength(1);
    expect(verdict.inevitables).toBe(1);
    const evitable = verifierSeparationAvantLaFinale(
      premierTour(["r1", null, "r2", "r3"]),
      auRang(3, { 2: "T", 3: "T" }),
      { parRang: true },
    );
    expect(evitable).toEqual({
      paires: [{ entiteId: "T", registrationA: "r2", registrationB: "r3" }],
      inevitables: 0,
    });
  });

  it("trois coéquipiers dans un tableau de huit : au moins une paire dans une même moitié", () => {
    const entrees = auRang(8, { 1: "T", 2: "T", 3: "T" });
    const combats = premierTour(["r1", "r8", "r4", "r5", "r2", "r7", "r3", "r6"]);
    const verdict = verifierSeparationAvantLaFinale(combats, entrees);
    expect(verdict.paires).toEqual([{ entiteId: "T", registrationA: "r2", registrationB: "r3" }]);
    expect(verdict.inevitables).toBe(1);
  });

  it("une poule : ni moitié ni finale, rien n'est signalé", () => {
    const entrees = auRang(5, { 1: "T", 2: "T", 3: "U", 4: "U" });
    const poule: GeneratedFight[] = [
      ["r1", "r2"],
      ["r3", "r4"],
      ["r1", "r3"],
      ["r2", "r4"],
    ].map(([a, b], i) => ({
      division: 0,
      indexInDivision: i,
      type: "BraketFight" as const,
      slotA: a!,
      slotB: b!,
      isBye: false,
    }));
    expect(verifierSeparationAvantLaFinale(poule, entrees, { parRang: true })).toEqual({
      paires: [],
      inevitables: 0,
    });
  });

  it("deux inscrits : la finale directe est maintenue, rien n'est signalé", () => {
    const entrees = auRang(2, { 1: "T", 2: "T" });
    expect(verifierSeparationAvantLaFinale(premierTour(["r1", "r2"]), entrees)).toEqual({
      paires: [],
      inevitables: 0,
    });
  });
});

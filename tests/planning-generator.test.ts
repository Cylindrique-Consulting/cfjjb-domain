import { describe, expect, it } from "vitest";
import {
  assignCategoriesToDays,
  categoryRunningOrder,
  computeTatamiSchedule,
  fightTimeKey,
  planCategories,
  planCategoriesOverDays,
  type DayPlan,
  type PlanningCategory,
  type PlanningDay,
  type SchedulableCategory,
} from "../src/planning-generator";

function cat(id: string, overrides: Partial<PlanningCategory> = {}): PlanningCategory {
  return {
    id,
    discipline: "gi",
    belt: "blue",
    ageGroup: "Adulte",
    weightClass: "Pena",
    fightTimeSeconds: 360,
    realFightCount: 4,
    ...overrides,
  };
}

describe("planCategories", () => {
  it("balances load across tatamis (LPT)", () => {
    const categories = [
      cat("a", { realFightCount: 8 }),
      cat("b", { realFightCount: 7 }),
      cat("c", { realFightCount: 4 }),
      cat("d", { realFightCount: 4 }),
      cat("e", { realFightCount: 3 }),
      cat("f", { realFightCount: 2 }),
    ];
    const plans = planCategories(categories, { tatamiCount: 2, childrenFirst: false });
    expect(plans).toHaveLength(2);
    const loads = plans.map((p) => p.totalSeconds);
    const maxCategory = Math.max(...categories.map((c) => c.realFightCount * (360 + 60)));
    expect(Math.abs((loads[0] ?? 0) - (loads[1] ?? 0))).toBeLessThanOrEqual(maxCategory);
    // Every category assigned exactly once.
    const all = plans.flatMap((p) => p.categoryIds).sort();
    expect(all).toEqual(["a", "b", "c", "d", "e", "f"]);
  });

  it("children categories run before adult ones on each tatami", () => {
    const categories = [
      cat("adult-1"),
      cat("kid-1", { ageGroup: "U9", belt: "grey", fightTimeSeconds: 180 }),
      cat("adult-2", { ageGroup: "Master 1" }),
      cat("kid-2", { ageGroup: "U13", belt: "yellow", fightTimeSeconds: 240 }),
    ];
    const plans = planCategories(categories, { tatamiCount: 2 });
    for (const plan of plans) {
      const kinds = plan.categoryIds.map((id) => (id.startsWith("kid") ? 0 : 1));
      expect([...kinds].sort((a, b) => a - b)).toEqual(kinds);
    }
  });

  it("orders by age, belt, weight inside a tatami", () => {
    const categories = [
      cat("black-adulte", { belt: "black" }),
      cat("blue-adulte", { belt: "blue" }),
      cat("blue-master", { belt: "blue", ageGroup: "Master 1" }),
      cat("white-adulte", { belt: "white" }),
    ];
    const plans = planCategories(categories, { tatamiCount: 1, childrenFirst: false });
    expect(plans[0]?.categoryIds).toEqual([
      "white-adulte",
      "blue-adulte",
      "black-adulte",
      "blue-master",
    ]);
  });
});

describe("categoryRunningOrder", () => {
  it("runs deepest division first, then Pool3, then the final", () => {
    const fights = [
      { division: 1, indexInDivision: 0, type: "BraketFight" as const, isBye: false },
      { division: 2, indexInDivision: 2, type: "BraketFightPool3" as const, isBye: false },
      { division: 2, indexInDivision: 1, type: "BraketFight" as const, isBye: false },
      { division: 2, indexInDivision: 0, type: "BraketFight" as const, isBye: false },
      { division: 3, indexInDivision: 1, type: "BraketFight" as const, isBye: false },
      { division: 3, indexInDivision: 0, type: "BraketFight" as const, isBye: true },
    ];
    const order = categoryRunningOrder(fights).map(
      (f) => `${f.division}.${f.indexInDivision}${f.type === "BraketFightPool3" ? "P" : ""}`,
    );
    expect(order).toEqual(["3.0", "3.1", "2.0", "2.1", "2.2P", "1.0"]);
  });
});

describe("computeTatamiSchedule", () => {
  const start = Date.parse("2026-09-12T09:00:00.000Z");

  it("schedules real fights sequentially and skips byes", () => {
    const categories: SchedulableCategory[] = [
      {
        id: "c1",
        fightTimeSeconds: 300,
        fights: [
          { division: 2, indexInDivision: 0, type: "BraketFight", isBye: true },
          { division: 2, indexInDivision: 1, type: "BraketFight", isBye: false },
          { division: 1, indexInDivision: 0, type: "BraketFight", isBye: false },
        ],
      },
      {
        id: "c2",
        fightTimeSeconds: 600,
        fights: [{ division: 1, indexInDivision: 0, type: "BraketFight", isBye: false }],
      },
    ];
    const result = computeTatamiSchedule(categories, start, 60);

    // c1: semi at 09:00, final at 09:06 (300+60s); bye absent.
    expect(
      result.fightTimes.get(
        fightTimeKey("c1", { division: 2, indexInDivision: 1, type: "BraketFight" }),
      ),
    ).toBe(start);
    expect(
      result.fightTimes.get(
        fightTimeKey("c1", { division: 1, indexInDivision: 0, type: "BraketFight" }),
      ),
    ).toBe(start + 360_000);
    expect(
      result.fightTimes.get(
        fightTimeKey("c1", { division: 2, indexInDivision: 0, type: "BraketFight" }),
      ),
    ).toBeUndefined();

    // c2 starts after c1 (2 real fights × 6 min).
    expect(result.categoryStarts.get("c2")).toBe(start + 720_000);
    expect(result.endsAt).toBe(start + 720_000 + 660_000);

    // Strictly increasing times.
    const times = [...result.fightTimes.values()];
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it("Pool3 is scheduled before the final", () => {
    const categories: SchedulableCategory[] = [
      {
        id: "c1",
        fightTimeSeconds: 300,
        fights: [
          { division: 1, indexInDivision: 0, type: "BraketFight", isBye: false },
          { division: 2, indexInDivision: 0, type: "BraketFight", isBye: false },
          { division: 2, indexInDivision: 1, type: "BraketFight", isBye: false },
          { division: 2, indexInDivision: 2, type: "BraketFightPool3", isBye: false },
        ],
      },
    ];
    const result = computeTatamiSchedule(categories, start, 60);
    const pool3 = result.fightTimes.get(
      fightTimeKey("c1", { division: 2, indexInDivision: 2, type: "BraketFightPool3" }),
    );
    const final = result.fightTimes.get(
      fightTimeKey("c1", { division: 1, indexInDivision: 0, type: "BraketFight" }),
    );
    expect(pool3).toBeDefined();
    expect(final).toBeDefined();
    expect(pool3 as number).toBeLessThan(final as number);
  });
});

// ------------------------------------------------------------------
// Dimension JOUR
// ------------------------------------------------------------------

/**
 * Corpus de référence, calibré sur une compétition réelle (Open Île-de-France,
 * 3 octobre, 6 tatamis) : enfants et adultes, 14 catégories, 44 520 s de
 * combat tampon compris.
 *
 * L'ORDRE D'ENTRÉE EST DÉLIBÉRÉMENT MÉLANGÉ, et il n'est pas décoratif. Le LPT
 * trie par durée décroissante avec un tri STABLE : deux catégories de même
 * durée (ici `adulte-nogi-blue-pena` et `adulte-blue-pena`, 6 300 s chacune)
 * sont départagées par leur rang d'entrée. Toute réorganisation de la liste
 * sur le chemin de la répartition par jour déplacerait donc des catégories
 * d'un tatami à l'autre — c'est ce que le gel ci-dessous détecte.
 */
const CORPUS: PlanningCategory[] = [
  cat("adulte-nogi-blue-pena", { discipline: "nogi", realFightCount: 15 }),
  cat("u13-orange-pena", {
    ageGroup: "U13",
    belt: "orange",
    fightTimeSeconds: 240,
    realFightCount: 5,
  }),
  cat("master3-black-super", {
    ageGroup: "Master 3",
    belt: "black",
    fightTimeSeconds: 600,
    realFightCount: 2,
    weightClass: "Super Pesado",
  }),
  cat("adulte-white-galo", {
    belt: "white",
    fightTimeSeconds: 300,
    realFightCount: 12,
    weightClass: "Galo",
  }),
  cat("u9-grey-galo", {
    ageGroup: "U9",
    belt: "grey",
    fightTimeSeconds: 180,
    realFightCount: 7,
    weightClass: "Galo",
  }),
  cat("adulte-black-pesado", {
    belt: "black",
    fightTimeSeconds: 600,
    realFightCount: 4,
    weightClass: "Pesado",
  }),
  cat("juvenile-blue-medio", {
    ageGroup: "Juvénile",
    fightTimeSeconds: 300,
    realFightCount: 6,
    weightClass: "Medio",
  }),
  cat("master1-blue-pena", { ageGroup: "Master 1", realFightCount: 9 }),
  cat("u15-green-leve", {
    ageGroup: "U15",
    belt: "green",
    fightTimeSeconds: 240,
    realFightCount: 9,
    weightClass: "Leve",
  }),
  cat("adulte-blue-pena", { realFightCount: 15 }),
  cat("u11-yellow-pluma", {
    ageGroup: "U11",
    belt: "yellow",
    fightTimeSeconds: 240,
    realFightCount: 11,
    weightClass: "Pluma",
  }),
  cat("adulte-purple-leve", {
    belt: "purple",
    fightTimeSeconds: 420,
    realFightCount: 8,
    weightClass: "Leve",
  }),
  cat("master2-purple-medio", {
    ageGroup: "Master 2",
    belt: "purple",
    fightTimeSeconds: 420,
    realFightCount: 3,
    weightClass: "Medio",
  }),
  cat("adulte-brown-pesado", {
    belt: "brown",
    fightTimeSeconds: 480,
    realFightCount: 6,
    weightClass: "Pesado",
  }),
];

/**
 * Planning du CORPUS sur 6 tatamis, GELÉ tel que le générateur le produisait
 * AVANT la dimension jour. C'est la contrainte du lot : à un seul jour, la
 * sortie doit être identique au bit. Ce littéral n'est pas recalculé par le
 * code testé — sinon il ne prouverait plus rien.
 */
const PLANNING_UN_JOUR_6_TATAMIS = [
  { tatamiIndex: 0, categoryIds: ["u11-yellow-pluma", "adulte-brown-pesado"], totalSeconds: 6540 },
  { tatamiIndex: 1, categoryIds: ["u15-green-leve", "master1-blue-pena"], totalSeconds: 6480 },
  {
    tatamiIndex: 2,
    categoryIds: ["u9-grey-galo", "adulte-purple-leve", "adulte-black-pesado"],
    totalSeconds: 8160,
  },
  {
    tatamiIndex: 3,
    categoryIds: ["u13-orange-pena", "juvenile-blue-medio", "adulte-white-galo"],
    totalSeconds: 7980,
  },
  {
    tatamiIndex: 4,
    categoryIds: ["adulte-nogi-blue-pena", "master2-purple-medio"],
    totalSeconds: 7740,
  },
  { tatamiIndex: 5, categoryIds: ["adulte-blue-pena", "master3-black-super"], totalSeconds: 7620 },
];

/** Ordre canonique de la compétition (enfants, puis âge, ceinture, poids, discipline). */
const ORDRE_CANONIQUE = [
  "u9-grey-galo",
  "u11-yellow-pluma",
  "u13-orange-pena",
  "u15-green-leve",
  "juvenile-blue-medio",
  "adulte-white-galo",
  "adulte-blue-pena",
  "adulte-nogi-blue-pena",
  "adulte-purple-leve",
  "adulte-brown-pesado",
  "adulte-black-pesado",
  "master1-blue-pena",
  "master2-purple-medio",
  "master3-black-super",
];

const JOUR_1 = Date.parse("2026-10-03T09:00:00.000Z");
const JOUR_2 = Date.parse("2026-10-04T09:00:00.000Z");

function jour(startAtMs: number, heures: number): PlanningDay {
  return { startAtMs, endAtMs: startAtMs + heures * 3_600_000 };
}

/** Catégories d'un jour, tatamis confondus, dans l'ordre des tatamis. */
function idsDuJour(day: DayPlan | undefined): string[] {
  return (day?.tatamis ?? []).flatMap((t) => t.categoryIds);
}

function chargeDuJour(day: DayPlan | undefined): number {
  return (day?.tatamis ?? []).reduce((s, t) => s + t.totalSeconds, 0);
}

describe("planCategoriesOverDays", () => {
  it("à un seul jour, rend au bit le planning d'avant la dimension jour", () => {
    const jours = planCategoriesOverDays(CORPUS, { tatamiCount: 6, days: [jour(JOUR_1, 9)] });

    expect(jours, "un seul jour demandé, un seul jour rendu").toHaveLength(1);
    expect(jours[0]?.tatamis, "planning du jour unique = planning gelé d'avant le lot").toEqual(
      PLANNING_UN_JOUR_6_TATAMIS,
    );
    expect(
      JSON.stringify(jours[0]?.tatamis),
      "identité littérale avec planCategories, ordre des clés compris",
    ).toBe(JSON.stringify(planCategories(CORPUS, { tatamiCount: 6 })));
    expect(jours[0]?.overrunSeconds, "9 h sur 6 tatamis : aucun dépassement").toBe(0);
  });

  it("répartit les catégories entre les deux jours quand le jour 1 est trop court", () => {
    const jours = planCategoriesOverDays(CORPUS, {
      tatamiCount: 1,
      days: [jour(JOUR_1, 6), jour(JOUR_2, 9)],
    });

    expect(jours, "deux jours demandés, deux jours rendus").toHaveLength(2);
    // Un seul tatami : l'ordre du tatami EST l'ordre canonique de la journée.
    expect(idsDuJour(jours[0]), "le jour 1 prend le début de l'ordre canonique").toEqual([
      "u9-grey-galo",
      "u11-yellow-pluma",
      "u13-orange-pena",
      "u15-green-leve",
      "juvenile-blue-medio",
      "adulte-white-galo",
    ]);
    expect(idsDuJour(jours[1]), "le jour 2 prend la suite, sans en perdre").toEqual([
      "adulte-blue-pena",
      "adulte-nogi-blue-pena",
      "adulte-purple-leve",
      "adulte-brown-pesado",
      "adulte-black-pesado",
      "master1-blue-pena",
      "master2-purple-medio",
      "master3-black-super",
    ]);
    expect(chargeDuJour(jours[0]), "charge du jour 1, tampon compris").toBe(15_660);
    expect(chargeDuJour(jours[1]), "charge du jour 2, tampon compris").toBe(28_860);
    expect(
      [...idsDuJour(jours[0]), ...idsDuJour(jours[1])],
      "les deux jours bout à bout redonnent l'ordre canonique : le jour 1 en est un préfixe",
    ).toEqual(ORDRE_CANONIQUE);
  });

  it("aucune catégorie ne se déroule sur les deux jours", () => {
    const jours = planCategoriesOverDays(CORPUS, {
      tatamiCount: 2,
      days: [jour(JOUR_1, 3), jour(JOUR_2, 9)],
    });

    const jour1 = idsDuJour(jours[0]);
    const jour2 = idsDuJour(jours[1]);
    const communes = jour1.filter((id) => jour2.includes(id));
    expect(
      communes,
      "une catégorie sur les deux jours convoquerait ses combattants deux fois",
    ).toEqual([]);
    expect(
      [...jour1, ...jour2].sort(),
      "chaque catégorie du corpus est planifiée une fois et une seule",
    ).toEqual(CORPUS.map((c) => c.id).sort());
  });

  it("respecte l'heure de fin de chaque jour et le signale sinon", () => {
    const jours = planCategoriesOverDays(CORPUS, {
      tatamiCount: 1,
      days: [jour(JOUR_1, 6), jour(JOUR_2, 9)],
    });

    // Un seul tatami : la charge du jour EST la fin de journée, sans marge LPT.
    expect(chargeDuJour(jours[0]), "le jour 1 tient dans ses 6 h (21 600 s)").toBeLessThanOrEqual(
      21_600,
    );
    expect(chargeDuJour(jours[1]), "le jour 2 tient dans ses 9 h (32 400 s)").toBeLessThanOrEqual(
      32_400,
    );
    expect(jours[0]?.overrunSeconds, "aucun dépassement annoncé pour le jour 1").toBe(0);
    expect(jours[1]?.overrunSeconds, "aucun dépassement annoncé pour le jour 2").toBe(0);
  });

  it("n'ouvre pas une catégorie plus longue que la journée, même si l'aire du jour suffit", () => {
    const corpus = [
      CORPUS.find((c) => c.id === "u9-grey-galo") as PlanningCategory, // 1 680 s
      CORPUS.find((c) => c.id === "u11-yellow-pluma") as PlanningCategory, // 3 300 s
      CORPUS.find((c) => c.id === "adulte-blue-pena") as PlanningCategory, // 6 300 s
    ];
    // Jour 1 : 1 h sur 4 tatamis. L'aire disponible (14 400 s) accepterait la
    // grosse catégorie ; un seul tatami ne le peut pas, elle dure 6 300 s.
    const jours = planCategoriesOverDays(corpus, {
      tatamiCount: 4,
      days: [jour(JOUR_1, 1), jour(JOUR_2, 9)],
    });

    expect(
      1_680 + 3_300 + 6_300,
      "montage : l'aire du jour 1 accepterait les trois catégories, seule la durée de la journée l'interdit",
    ).toBeLessThanOrEqual(4 * 3_600);
    expect(idsDuJour(jours[0]).sort(), "le jour 1 ne garde que ce qui tient en 1 h").toEqual([
      "u11-yellow-pluma",
      "u9-grey-galo",
    ]);
    expect(idsDuJour(jours[1]), "la catégorie de 6 300 s bascule au jour 2").toEqual([
      "adulte-blue-pena",
    ]);
  });

  it("le dernier jour absorbe ce qui ne tient nulle part, et le dépassement est rendu", () => {
    const trop_longue = CORPUS.find((c) => c.id === "adulte-blue-pena") as PlanningCategory;
    const jours = planCategoriesOverDays([trop_longue], {
      tatamiCount: 1,
      days: [jour(JOUR_1, 1), jour(JOUR_2, 1)],
    });

    expect(idsDuJour(jours[0]), "le jour 1 ne peut pas la tenir").toEqual([]);
    expect(idsDuJour(jours[1]), "le dernier jour l'absorbe plutôt que de la perdre").toEqual([
      "adulte-blue-pena",
    ]);
    expect(jours[1]?.overrunSeconds, "6 300 s dans une journée de 3 600 s = 2 700 s de trop").toBe(
      2_700,
    );
    expect(jours[0]?.overrunSeconds, "le jour 1 vide ne dépasse rien").toBe(0);
  });

  it("compte le tampon entre combats dans la capacité d'un jour", () => {
    const params = { tatamiCount: 1, days: [jour(JOUR_1, 6), jour(JOUR_2, 9)] };

    const avecTampon = planCategoriesOverDays(CORPUS, params);
    const sansTampon = planCategoriesOverDays(CORPUS, { ...params, bufferSeconds: 0 });

    expect(
      idsDuJour(avecTampon[0]),
      "tampon de 60 s : adulte-blue-pena ne tient plus dans le jour 1",
    ).not.toContain("adulte-blue-pena");
    expect(
      idsDuJour(sansTampon[0]),
      "sans tampon, la même catégorie tient dans le jour 1",
    ).toContain("adulte-blue-pena");
  });

  it("cas dégénéré : tout tient dans le jour 1, le jour 2 reste vide", () => {
    const jours = planCategoriesOverDays(CORPUS, {
      tatamiCount: 6,
      days: [jour(JOUR_1, 9), jour(JOUR_2, 9)],
    });

    expect(
      jours[0]?.tatamis,
      "tout tenant dans le jour 1, ce jour est au bit le planning d'un jour",
    ).toEqual(PLANNING_UN_JOUR_6_TATAMIS);
    expect(idsDuJour(jours[1]), "aucune catégorie au jour 2").toEqual([]);
    expect(
      jours[1]?.tatamis.map((t) => t.totalSeconds),
      "les 6 tatamis du jour 2 existent, tous à vide",
    ).toEqual([0, 0, 0, 0, 0, 0]);
    expect(jours[1]?.overrunSeconds, "un jour vide ne dépasse rien").toBe(0);
  });

  it("une journée sans heure de fin connue est sans borne", () => {
    // `competitions.end_time` est NULLABLE : le consommateur ne sait pas
    // toujours quand la journée finit. On ne devine pas une fin.
    const jours = planCategoriesOverDays(CORPUS, {
      tatamiCount: 1,
      days: [{ startAtMs: JOUR_1, endAtMs: JOUR_1 }, jour(JOUR_2, 9)],
    });

    expect(idsDuJour(jours[0]), "sans fin connue, le jour 1 absorbe tout").toEqual(ORDRE_CANONIQUE);
    expect(jours[0]?.overrunSeconds, "aucune fin, donc aucun dépassement mesurable").toBe(0);
  });

  it("refuse une compétition sans aucun jour plutôt que de rendre un planning vide", () => {
    expect(
      () => planCategoriesOverDays(CORPUS, { tatamiCount: 6, days: [] }),
      "sans jour, un planning vide serait muet : 14 catégories nulle part",
    ).toThrow(/au moins un jour/);
  });
});

describe("assignCategoriesToDays", () => {
  it("rend les catégories de chaque jour dans l'ordre d'entrée, pas dans l'ordre canonique", () => {
    const parJour = assignCategoriesToDays(CORPUS, {
      tatamiCount: 1,
      days: [jour(JOUR_1, 6), jour(JOUR_2, 9)],
    });

    // C'est cet ordre-là qui rend l'identité au bit possible : `planCategories`
    // doit recevoir la liste telle qu'elle est entrée (son tri est stable).
    expect(
      parJour[0]?.map((c) => c.id),
      "ordre d'entrée du corpus conservé, pas l'ordre canonique",
    ).toEqual([
      "u13-orange-pena",
      "adulte-white-galo",
      "u9-grey-galo",
      "juvenile-blue-medio",
      "u15-green-leve",
      "u11-yellow-pluma",
    ]);
  });

  it("à un seul jour, rend la liste d'origine telle quelle", () => {
    const parJour = assignCategoriesToDays(CORPUS, {
      tatamiCount: 6,
      days: [jour(JOUR_1, 9)],
    });

    expect(parJour, "un seul jour, un seul groupe").toHaveLength(1);
    expect(parJour[0], "aucune catégorie retirée, aucun réordonnancement").toEqual(CORPUS);
  });
});

import { describe, expect, it } from "vitest";
import {
  categoryRunningOrder,
  computeTatamiSchedule,
  fightTimeKey,
  planCategories,
  type PlanningCategory,
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

import { AGE_GROUPS, type AgeGroup } from "./referential";

export type DrawFormat = "single_elim" | "pools";

export type BracketModeDb = "single_elim_no_third" | "single_elim_with_third" | "pools";

export function drawFormatFromBracketMode(stored: string | null | undefined): DrawFormat | null {
  switch (stored) {
    case "single_elim_no_third":
    case "single_elim_with_third":
      return "single_elim";
    case "pools":
      return "pools";
    default:
      return null;
  }
}

export type FormatByAgeGroup = Readonly<Record<AgeGroup, DrawFormat>>;

export const DEFAULT_FORMAT_BY_AGE_GROUP: FormatByAgeGroup = {
  U7: "single_elim",
  U9: "single_elim",
  U11: "single_elim",
  U13: "single_elim",
  U15: "single_elim",
  Juvénile: "single_elim",
  Adulte: "single_elim",
  "Master 1": "single_elim",
  "Master 2": "single_elim",
  "Master 3": "single_elim",
  "Master 4": "single_elim",
  "Master 5+": "single_elim",
};

export function formatForAgeGroup(
  ageGroup: AgeGroup,
  table: Partial<FormatByAgeGroup> = DEFAULT_FORMAT_BY_AGE_GROUP,
): DrawFormat {
  return table[ageGroup] ?? "single_elim";
}

export function ageGroupsInPools(
  table: Partial<FormatByAgeGroup> = DEFAULT_FORMAT_BY_AGE_GROUP,
): AgeGroup[] {
  return AGE_GROUPS.filter((group) => formatForAgeGroup(group, table) === "pools");
}

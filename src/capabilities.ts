export const STAFF_ROLES = [
  "day_commissioner",
  "tatami_commissioner",
  "checkin_desk",
  "weighin",
  "medido",
  "table_operator",
  "podium",
  "tshirt_stand",
] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];

export type MutationKind =
  | "fight.start"
  | "fight.score"
  | "fight.finish"
  | "fight.reopen"
  | "fight.move"
  | "presence.check_in"
  | "weighin.record"
  | "medido.record"
  | "podium.confirm"
  | "absolut.enter"
  | "absolut.cancel"
  | "absolut.close"
  | "absolut.generate"
  | "absolut.close_early"
  | "absolut.reopen"
  | "absolut.ungenerate"
  | "absolut.deadline_set"
  | "tshirt.give"
  | "paper.entry"
  | "fight.arbitrate"
  | "category.ranking_enter"
  | "arbitration.fights_create";

export type Capability = {
  readonly roles: readonly StaffRole[];
  readonly tatamiBound: boolean;
};

export const CAPABILITIES: Record<MutationKind, Capability> = {
  "fight.start": {
    roles: ["table_operator", "tatami_commissioner", "day_commissioner"],
    tatamiBound: true,
  },
  "fight.score": {
    roles: ["table_operator", "tatami_commissioner", "day_commissioner"],
    tatamiBound: true,
  },
  "fight.finish": {
    roles: ["table_operator", "tatami_commissioner", "day_commissioner"],
    tatamiBound: true,
  },
  "fight.reopen": {
    roles: ["tatami_commissioner", "day_commissioner"],
    tatamiBound: true,
  },
  "fight.move": { roles: ["day_commissioner"], tatamiBound: false },

  "presence.check_in": { roles: ["checkin_desk", "day_commissioner"], tatamiBound: false },
  "weighin.record": { roles: ["weighin", "day_commissioner"], tatamiBound: false },
  "medido.record": { roles: ["medido", "day_commissioner"], tatamiBound: false },
  "podium.confirm": { roles: ["podium", "day_commissioner"], tatamiBound: false },

  "absolut.enter": { roles: ["podium", "day_commissioner"], tatamiBound: false },

  "absolut.cancel": { roles: ["podium", "day_commissioner"], tatamiBound: false },

  "absolut.close": { roles: ["day_commissioner"], tatamiBound: false },

  "absolut.close_early": { roles: ["day_commissioner"], tatamiBound: false },

  "absolut.generate": { roles: ["day_commissioner"], tatamiBound: false },

  "absolut.reopen": { roles: ["day_commissioner"], tatamiBound: false },

  "absolut.ungenerate": { roles: ["day_commissioner"], tatamiBound: false },

  "absolut.deadline_set": { roles: ["day_commissioner"], tatamiBound: false },

  "tshirt.give": { roles: ["tshirt_stand", "day_commissioner"], tatamiBound: false },

  "paper.entry": { roles: ["day_commissioner"], tatamiBound: false },

  "fight.arbitrate": { roles: ["day_commissioner"], tatamiBound: false },
  "category.ranking_enter": { roles: ["day_commissioner"], tatamiBound: false },
  "arbitration.fights_create": { roles: ["day_commissioner"], tatamiBound: false },
};

export type Assignment = {
  readonly role: StaffRole;
  readonly tatamiScope: "none" | "all" | "listed";
  readonly tatamiIds: readonly string[];
};

export function canPerform(
  kind: MutationKind,
  assignments: readonly Assignment[],
  tatamiId: string | null,
): boolean {
  const cap = CAPABILITIES[kind];
  return assignments.some((a) => {
    if (!cap.roles.includes(a.role)) return false;
    if (!cap.tatamiBound) return true;
    if (tatamiId === null) return false;
    if (a.tatamiScope === "all") return true;
    if (a.tatamiScope === "listed") return a.tatamiIds.includes(tatamiId);
    return false;
  });
}

export function allowedKinds(assignments: readonly Assignment[]): MutationKind[] {
  const roles = new Set(assignments.map((a) => a.role));
  return (Object.keys(CAPABILITIES) as MutationKind[]).filter((k) =>
    CAPABILITIES[k].roles.some((r) => roles.has(r)),
  );
}

export function operableTatamis(assignments: readonly Assignment[]): "all" | string[] {
  if (assignments.some((a) => a.tatamiScope === "all")) return "all";
  const out = new Set<string>();
  for (const a of assignments) {
    if (a.tatamiScope === "listed") for (const t of a.tatamiIds) out.add(t);
  }
  return [...out].sort();
}

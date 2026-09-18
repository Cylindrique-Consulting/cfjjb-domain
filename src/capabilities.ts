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
  | "arbitration.fights_create"
  | "sanction.validate"
  | "sanction.refuse"
  | "sanction.pronounce"
  | "sanction.cancel";

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

  // ┌─ LES QUATRE GESTES DE LA SANCTION DISCIPLINAIRE (lot L7, DQ2) ────────────┐
  // │ `tatamiBound: false` pour les quatre, et ce n'est pas un oubli : la        │
  // │ sanction porte sur l'ATHLÈTE, pas sur le tapis. Une faute commise sur le   │
  // │ tatami 3 exclut aussi de la compétition No-Gi du même événement (IBJJF     │
  // │ Rules Book 7.1) : la borner à un tapis rendrait le bandeau invisible au    │
  // │ Responsable dès qu'il regarde un autre écran.                              │
  // │                                                                            │
  // │ UNE DISTINCTION QUE CETTE MATRICE NE SAIT PAS DIRE, et le serveur si :     │
  // │ prononcer hors combat et annuler sont réservés aux responsables DÉSIGNÉS,  │
  // │ avec un compte personnel — pas à un identifiant de poste partagé (T21.1,   │
  // │ décision prise faute de réponse client, notre proposition B). La matrice   │
  // │ raisonne en RÔLES, pas en provenance du poste : la garde vit donc dans     │
  // │ `jour_j_sanction_exiger_responsable` (CF403), et ces deux entrées disent    │
  // │ seulement quels boutons ont un sens à l'écran.                             │
  // └───────────────────────────────────────────────────────────────────────────┘
  "sanction.validate": { roles: ["day_commissioner"], tatamiBound: false },
  "sanction.refuse": { roles: ["day_commissioner"], tatamiBound: false },
  "sanction.pronounce": { roles: ["day_commissioner"], tatamiBound: false },
  "sanction.cancel": { roles: ["day_commissioner"], tatamiBound: false },
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

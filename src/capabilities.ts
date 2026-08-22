/**
 * QUI PEUT ÉCRIRE QUOI, LE JOUR D'UNE COMPÉTITION.
 *
 * Une matrice PURE : `(verbe × postes tenus × tapis autorisés) → autorisé ?`.
 * Elle n'ouvre aucune porte — elle décide ce que l'INTERFACE propose. La
 * frontière réelle est en base : chaque fonction d'écriture du jour J est
 * `security definer` et vérifie elle-même l'autorisation avec `auth.uid()`, dans
 * la transaction qui pose le verrou.
 *
 * ┌─ POURQUOI LES DEUX, ET DANS CET ORDRE ────────────────────────────────────┐
 * │ Masquer un bouton n'est pas une frontière : un bouton caché se rappelle    │
 * │ par une requête. C'est pourquoi le serveur refuse, toujours.               │
 * │                                                                            │
 * │ Mais un serveur qui refuse sans que l'interface l'ait anticipé produit une  │
 * │ autre panne, plus insidieuse : un bénévole appuie, rien ne se passe, il     │
 * │ appuie encore. Au bord d'un tapis, avec un combat qui attend, c'est un      │
 * │ écran qu'on abandonne.                                                     │
 * │                                                                            │
 * │ La matrice sert donc à NE PAS PROPOSER. Le refus serveur reste la vérité,   │
 * │ et un refus doit s'afficher comme une information, pas comme une erreur.    │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * ELLE VIT DANS LE PACKAGE PARTAGÉ parce qu'elle est pure et qu'elle a deux
 * lecteurs : l'application des postes, et la supervision fédération. Deux copies
 * divergeraient exactement là où ça compte — sur qui a le droit de réécrire un
 * score.
 *
 * ⚠ CE QUE CE MODULE NE PROUVE PAS. Les listes de postes ci-dessous doivent
 * correspondre à celles écrites en dur dans les fonctions SQL
 * (`20261005000001_jour_j_rpc_ecriture.sql`, `20261005000002_jour_j_rpc_postes.sql`).
 * Rien ici ne peut le vérifier : le SQL vit dans un autre dépôt. La comparaison
 * doit être portée par un test de `cfjjb-platform`, qui possède à la fois la
 * migration et ce package. Tant qu'il n'existe pas, une divergence se traduirait
 * par une interface qui propose un geste que le serveur refuse — visible, mais
 * seulement au premier essai.
 */

/**
 * Les postes du jour J.
 *
 * Recopiés ici en toute connaissance : le `check` de `competition_staff.role` est
 * la source, et cette liste doit lui rester fidèle. On ne peut pas l'importer —
 * le schéma est dans un autre dépôt — mais on peut au moins ne l'écrire qu'une
 * fois de ce côté-ci.
 */
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

/**
 * Les verbes d'écriture du jour J.
 *
 * L'union est FERMÉE et `CAPABILITIES` doit la couvrir entièrement — le type
 * `Record<MutationKind, …>` y suffit : ajouter un verbe sans lui donner de règle
 * ne compile pas. C'est le seul endroit du système où « j'ai oublié une règle »
 * peut être attrapé par le compilateur plutôt que par un bénévole.
 */
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
  | "tshirt.give"
  | "paper.entry";

/** Ce qu'un verbe exige. */
export type Capability = {
  /** Les postes qui l'autorisent. Un seul suffit. */
  readonly roles: readonly StaffRole[];
  /**
   * Le verbe porte-t-il sur un TAPIS ?
   *
   * Si oui, tenir le poste ne suffit pas : il faut aussi le tapis dans son
   * périmètre. Sinon (la balance, la jauge, le stand t-shirts) le périmètre tapis
   * n'a pas de sens et n'est pas consulté.
   */
  readonly tatamiBound: boolean;
};

export const CAPABILITIES: Record<MutationKind, Capability> = {
  // La table de marque, sur SON tapis. Le commissaire de tapis et celui de
  // journée passent partout où leur périmètre les porte.
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
  // RÉOUVRIR N'EST PAS UNE CORRECTION DE SAISIE. C'est dépropager l'aval d'un
  // tableau : la table de marque en est exclue, et c'est le POSTE qui l'interdit,
  // pas une fenêtre de confirmation.
  "fight.reopen": {
    roles: ["tatami_commissioner", "day_commissioner"],
    tatamiBound: true,
  },
  // Déplacer un combat d'un tapis à un autre concerne DEUX tapis : seul un poste
  // qui les voit tous les deux peut le décider. C'est aussi la seule opération où
  // deux appareils hors ligne prendraient des décisions inconciliables — elle
  // reste délibérément en ligne.
  "fight.move": { roles: ["day_commissioner"], tatamiBound: false },

  "presence.check_in": { roles: ["checkin_desk", "day_commissioner"], tatamiBound: false },
  "weighin.record": { roles: ["weighin", "day_commissioner"], tatamiBound: false },
  "medido.record": { roles: ["medido", "day_commissioner"], tatamiBound: false },
  "podium.confirm": { roles: ["podium", "day_commissioner"], tatamiBound: false },
  "tshirt.give": { roles: ["tshirt_stand", "day_commissioner"], tatamiBound: false },

  // La saisie a posteriori d'une feuille papier réécrit un résultat déjà tenu
  // pour acquis : commissaire de journée seulement.
  "paper.entry": { roles: ["day_commissioner"], tatamiBound: false },
};

/** Une affectation, telle que l'application la charge depuis la base. */
export type Assignment = {
  readonly role: StaffRole;
  /** `all` = tous les tapis, `listed` = ceux de `tatamiIds`, `none` = aucun. */
  readonly tatamiScope: "none" | "all" | "listed";
  readonly tatamiIds: readonly string[];
};

/**
 * L'affectation autorise-t-elle ce verbe sur ce tapis ?
 *
 * `tatamiId` peut être `null` pour un verbe non lié à un tapis. Pour un verbe qui
 * l'est, un `tatamiId` absent rend FAUX : on ne devine pas le tapis, et ne pas le
 * connaître n'est pas une raison de laisser passer.
 */
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
    // `none` : un poste sans tapis n'écrit aucun score. Le défaut en base est
    // `none`, et il est fail-closed à dessein.
    return false;
  });
}

/** Les verbes qu'un ensemble d'affectations autorise, tous tapis confondus. */
export function allowedKinds(assignments: readonly Assignment[]): MutationKind[] {
  const roles = new Set(assignments.map((a) => a.role));
  return (Object.keys(CAPABILITIES) as MutationKind[]).filter((k) =>
    CAPABILITIES[k].roles.some((r) => roles.has(r)),
  );
}

/** Les tapis qu'un ensemble d'affectations permet d'opérer, ou `"all"`. */
export function operableTatamis(assignments: readonly Assignment[]): "all" | string[] {
  if (assignments.some((a) => a.tatamiScope === "all")) return "all";
  const out = new Set<string>();
  for (const a of assignments) {
    if (a.tatamiScope === "listed") for (const t of a.tatamiIds) out.add(t);
  }
  return [...out].sort();
}

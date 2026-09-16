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
  | "absolut.enter"
  | "absolut.cancel"
  | "absolut.close"
  | "absolut.generate"
  | "absolut.close_early"
  | "absolut.reopen"
  | "absolut.ungenerate"
  | "absolut.void"
  | "absolut.deadline_set"
  | "tshirt.give"
  | "paper.entry"
  | "fight.arbitrate"
  | "category.ranking_enter"
  | "arbitration.fights_create";

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

  // ┌─ L'ABSOLUT : UNE CATÉGORIE, JAMAIS UN TAPIS ──────────────────────────────┐
  // │ Un absolut porte sur une CATÉGORIE — ceinture × tranche d'âge × genre ×   │
  // │ discipline, plus le groupe Leve / Pesado d'un juvénile — et jamais sur un │
  // │ tapis. `tatamiBound` reste donc faux pour tous ses verbes, exactement     │
  // │ comme pour la balance ou la jauge : le périmètre tapis n'y est pas VIDE,  │
  // │ il est SANS OBJET.                                                        │
  // │                                                                          │
  // │ DEUX QUESTIONS DIFFÉRENTES. Inscrire et désister se prennent au micro,    │
  // │ devant le combattant : le poste podium en est. Tout le reste — clore,     │
  // │ rouvrir, générer, annuler un tableau, annuler l'absolut, déplacer l'heure │
  // │ limite — engage le programme d'un ou plusieurs tapis que le poste podium  │
  // │ ne voit pas : c'est le Responsable de compétition, et lui seul (AB2.3).   │
  // │ Le serveur ajoute `jour_j_appelant_responsable` aux gestes de retour.     │
  // │                                                                          │
  // │ L'ANNULATION FORCÉE D'UN TABLEAU DÉJÀ COMMENCÉ N'EST PAS UN VERBE ICI.    │
  // │ Elle est réservée aux responsables désignés sur la fiche de la            │
  // │ compétition, connectés avec leur compte personnel (AB2.4, T21.1) : ce     │
  // │ n'est pas un poste, et aucune affectation ne doit pouvoir l'accorder.     │
  // └──────────────────────────────────────────────────────────────────────────┘

  // L'inscription se prend AU MICRO, à la console podium, après la confirmation
  // du podium source : c'est le seul endroit où le combattant se présente.
  "absolut.enter": { roles: ["podium", "day_commissioner"], tatamiBound: false },

  // Le désistement est l'INVERSE EXACT de l'inscription : même personne, même
  // console, même minute, et RÉPARABLE — une ligne passée en `cancelled` se
  // reprend en en créant une nouvelle.
  "absolut.cancel": { roles: ["podium", "day_commissioner"], tatamiBound: false },

  // Clore les inscriptions. Les absoluts qualifiés par une médaille se ferment
  // seuls 20 minutes après leur dernière source terminée, la noire Adulte à son
  // heure limite : clore à la main n'est plus la fin normale d'un absolut, c'est
  // une décision du Responsable. Verbe conservé pour les postes qui l'emploient.
  "absolut.close": { roles: ["day_commissioner"], tatamiBound: false },

  // Clore AVANT l'échéance, par exception : motif obligatoire, toutes les sources
  // terminées, trace au journal (T5.3, T21.2).
  "absolut.close_early": { roles: ["day_commissioner"], tatamiBound: false },

  // Générer le tableau : il est INSÉRÉ dans le programme des tapis choisis et
  // décale des combats déjà annoncés.
  "absolut.generate": { roles: ["day_commissioner"], tatamiBound: false },

  // Rouvrir des inscriptions closes (AB2.1). Un absolut rouvert ne se referme
  // plus seul (AB2.6).
  "absolut.reopen": { roles: ["day_commissioner"], tatamiBound: false },

  // Annuler un tableau généré dont aucun combat n'est réellement disputé
  // (AB2.2) : ses combats disparaissent des files et des écrans.
  "absolut.ungenerate": { roles: ["day_commissioner"], tatamiBound: false },

  // Annuler définitivement un absolut (état « Annulé », sans podium, T4.3).
  "absolut.void": { roles: ["day_commissioner"], tatamiBound: false },

  // Déplacer l'heure limite de la noire Adulte tant que ses inscriptions ne sont
  // pas closes (T5.1).
  "absolut.deadline_set": { roles: ["day_commissioner"], tatamiBound: false },

  "tshirt.give": { roles: ["tshirt_stand", "day_commissioner"], tatamiBound: false },

  // La saisie a posteriori d'une feuille papier réécrit un résultat déjà tenu
  // pour acquis : commissaire de journée seulement.
  "paper.entry": { roles: ["day_commissioner"], tatamiBound: false },

  // ┌─ L'ARBITRAGE D'UNE FIN SANS VAINQUEUR : LE RESPONSABLE SEUL (DQ1.3) ─────┐
  // │ Enregistrer un tirage au sort, saisir un classement retenu, créer des    │
  // │ combats supplémentaires : trois décisions qui changent une médaille et   │
  // │ que le règlement confie au Responsable de compétition. Aucune n'est      │
  // │ liée à un tapis — un combat supplémentaire se place sur le tapis que     │
  // │ l'écran guidé propose, et le Responsable les voit tous. Le serveur       │
  // │ ajoute `jour_j_appelant_responsable` (responsable désigné OU commissaire │
  // │ de journée) : le poste seul ne suffit pas à l'interface non plus.        │
  // └──────────────────────────────────────────────────────────────────────────┘
  "fight.arbitrate": { roles: ["day_commissioner"], tatamiBound: false },
  "category.ranking_enter": { roles: ["day_commissioner"], tatamiBound: false },
  "arbitration.fights_create": { roles: ["day_commissioner"], tatamiBound: false },
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

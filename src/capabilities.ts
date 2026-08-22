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

  // ┌─ L'ABSOLUT : TROIS VERBES, ET ILS NE POSENT PAS LA MÊME QUESTION ─────────┐
  // │ Un absolut porte sur une CATÉGORIE — le quadruplet ceinture × tranche      │
  // │ d'âge × genre × discipline — et jamais sur un tapis. `tatamiBound` reste   │
  // │ donc faux pour les trois, exactement comme pour la balance ou la jauge :   │
  // │ le périmètre tapis n'y est pas VIDE, il est SANS OBJET. Il n'y a pas de    │
  // │ troisième portée à inventer ; « lié à un tapis » et « pas lié à un tapis » │
  // │ suffisent à dire ce qu'un absolut est.                                     │
  // │                                                                            │
  // │ ⚠ AUCUNE FONCTION `day_absolut_*` N'EXISTE ENCORE. Les tables du lot 2f    │
  // │ sont écrites, rien ne les écrit : ces trois règles ne recopient donc aucun │
  // │ SQL, elles énoncent les droits EN PREMIER. C'est l'inverse du reste de la  │
  // │ matrice, et ça se retourne : le jour où les fonctions arrivent, ce sont    │
  // │ elles qui doivent s'aligner sur ces listes.                                │
  // └───────────────────────────────────────────────────────────────────────────┘

  // L'inscription se prend AU MICRO, à la console podium, dans la minute qui suit
  // la remise des médailles : c'est le seul endroit où le combattant se présente,
  // et le seul moment où il est éligible (l'inscription à l'avance n'existe pas).
  // Placer ce verbe ailleurs qu'au poste `podium` reviendrait à demander à
  // quelqu'un qui n'est pas devant les médaillés de saisir ce qu'ils disent.
  "absolut.enter": { roles: ["podium", "day_commissioner"], tatamiBound: false },

  // Le désistement est l'INVERSE EXACT de l'inscription : même personne, même
  // console, même minute, et surtout RÉPARABLE — une ligne passée en `cancelled`
  // se reprend en en créant une nouvelle. La question qu'il pose est donc bien
  // celle de `absolut.enter`, et les droits suivent pour cette raison-là, pas par
  // ressemblance.
  "absolut.cancel": { roles: ["podium", "day_commissioner"], tatamiBound: false },

  // CLORE N'EST PAS « INSCRIRE À L'ENVERS », et c'est pourquoi les droits
  // divergent de leurs voisins immédiats.
  //
  // La clôture n'est prononcée à la main que pour les CEINTURES NOIRES — les
  // couleurs se ferment seules quand toutes leurs catégories sources ont médaillé.
  // Elle est SANS RETOUR : plus aucune inscription, plus aucun désistement, et
  // aucun verbe de cette union ne la défait (il n'y a pas d'`absolut.reopen`).
  // Elle engage ensuite le format de la fin de journée : le tableau est généré et
  // INSÉRÉ dans le programme d'un tapis, ce qui décale des combats déjà annoncés.
  //
  // La matrice traite déjà les deux moitiés de cette question, et dans le même
  // sens :
  //  - `fight.reopen` retire le geste au poste qui EXÉCUTE (la table de marque)
  //    et le laisse aux commissaires, parce qu'il dépropage l'aval ;
  //  - `fight.move` n'appartient qu'au commissaire de journée, parce qu'il porte
  //    sur des tapis que le poste demandeur ne voit pas.
  // Clore un absolut cumule exactement ces deux traits. Le poste `podium` est ici
  // le poste qui exécute, et il n'a aucun tapis dans son périmètre : la
  // conséquence de son geste tomberait entièrement hors de sa vue.
  //
  // ⚠ DIVERGENCE ASSUMÉE AVEC LA SPÉCIFICATION. `docs/spec/patch-absolut`
  // (RG-A07 et sa matrice d'habilitations § 3.1) donne la clôture manuelle au
  // commissaire de podium AUTANT qu'au commissaire de journée. On la lui retire
  // ici, et le choix est fail-closed : une interface trop stricte se voit et se
  // corrige en une ligne, une clôture prise trop tôt par un bénévole ne se
  // rattrape pas. Le SQL du lot 2f dit d'ailleurs « leur clôture est prononcée à
  // la main par le commissaire » sans nommer le poste ; dans ce vocabulaire à
  // huit postes, `tatami_commissioner` est borné à un tapis et un absolut n'en
  // est pas un, ce qui ne laisse que le commissaire de journée.
  "absolut.close": { roles: ["day_commissioner"], tatamiBound: false },

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

/**
 * LE CONTRÔLE DU GABARIT DE KIMONO — la jauge IBJJF, en quatre points.
 *
 * Le « medido » est le troisième contrôle du jour, distinct du pointage et de la
 * pesée : un commissaire mesure le kimono à la jauge officielle. Quatre points, et
 * quatre seulement, décidés par la fédération le 17/08/2026.
 *
 * ┌─ POURQUOI UNE ÉNUMÉRATION ET NON UN DICTIONNAIRE LIBRE ───────────────────┐
 * │ La colonne qui reçoit ces mesures est un `jsonb` sans contrainte. Écrite    │
 * │ librement, elle aurait autant de vocabulaires que de versions de l'écran —   │
 * │ `manche`, `sleeve`, `manche_gauche` — et AUCUNE requête ne pourrait le       │
 * │ constater, puisqu'un jsonb accepte tout.                                    │
 * │                                                                            │
 * │ Pire : ni `checks` ni `notes` ne sont accordés en lecture à quiconque hors   │
 * │ du staff de la compétition. Une divergence de vocabulaire ne serait donc     │
 * │ même pas visible depuis un écran d'administration.                          │
 * │                                                                            │
 * │ L'énumération vit ici, dans le noyau pur, parce qu'elle a deux lecteurs :    │
 * │ l'écran qui saisit et la fonction serveur qui refuse une clé inconnue.       │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * CE QUE CE MODULE NE FAIT PAS. Il ne porte aucun SEUIL en centimètres. Les cotes
 * de la jauge IBJJF sont un document fédéral, elles changent sans que ce dépôt
 * en soit informé, et un seuil recopié ici deviendrait faux en silence. Le
 * commissaire mesure et tranche ; le système enregistre CE QU'IL A TRANCHÉ, point
 * par point. C'est la répartition juste : la jauge est un objet physique, pas une
 * règle de calcul.
 */

/** Les quatre points de la jauge, dans l'ordre où le commissaire les contrôle. */
export const MEDIDO_ITEMS = ["manche", "col", "pantalon", "ecussons"] as const;

export type MedidoItem = (typeof MEDIDO_ITEMS)[number];

/** Ce que le commissaire lit sur l'écran, à côté de chaque point. */
export const MEDIDO_ITEM_LABEL: Record<MedidoItem, string> = {
  manche: "Manche",
  col: "Col",
  pantalon: "Pantalon",
  ecussons: "Écussons",
};

/**
 * Ce qu'il faut vérifier, dit dans les mots du terrain.
 *
 * Un bénévole qui prend la jauge pour la première fois ne sait pas ce que
 * « pantalon » désigne. L'écran doit le dire, sinon c'est le commissaire voisin
 * qui l'explique — et deux commissaires expliqueront deux choses.
 */
export const MEDIDO_ITEM_HINT: Record<MedidoItem, string> = {
  manche: "Longueur de manche et écart au poignet, bras tendu.",
  col: "Épaisseur et largeur du col.",
  pantalon: "Longueur de jambe et écart à la cheville.",
  ecussons: "Emplacement et taille des écussons.",
};

/**
 * Le verdict d'UN point.
 *
 * `non_mesure` existe et compte : un kimono refusé sur la manche n'a pas besoin
 * d'être mesuré au pantalon, et enregistrer `conforme` sur un point qu'on n'a pas
 * regardé serait un faux. C'est la différence entre « vérifié et bon » et « pas
 * vérifié », que la plupart des formulaires effacent.
 */
export type MedidoVerdict = "conforme" | "non_conforme" | "non_mesure";

export const MEDIDO_VERDICTS = ["conforme", "non_conforme", "non_mesure"] as const;

/** Les mesures d'un contrôle, telles qu'elles partent vers la base. */
export type MedidoChecks = Partial<Record<MedidoItem, MedidoVerdict>>;

export function isMedidoItem(v: unknown): v is MedidoItem {
  return typeof v === "string" && (MEDIDO_ITEMS as readonly string[]).includes(v);
}

export function isMedidoVerdict(v: unknown): v is MedidoVerdict {
  return typeof v === "string" && (MEDIDO_VERDICTS as readonly string[]).includes(v);
}

/**
 * Valide un dictionnaire de mesures reçu de l'extérieur.
 *
 * Rend la liste des problèmes, vide si tout va bien. On ne « nettoie » pas en
 * silence : une clé inconnue est une divergence de vocabulaire, et la laisser
 * passer en la supprimant ferait perdre la mesure sans que personne ne le sache.
 */
export function validateMedidoChecks(input: unknown): string[] {
  if (input === null || input === undefined) return [];
  if (typeof input !== "object" || Array.isArray(input)) {
    return ["les mesures doivent être un objet"];
  }
  const problemes: string[] = [];
  for (const [cle, valeur] of Object.entries(input as Record<string, unknown>)) {
    if (!isMedidoItem(cle)) {
      problemes.push(`point de contrôle inconnu : « ${cle} »`);
      continue;
    }
    if (!isMedidoVerdict(valeur)) {
      problemes.push(`verdict invalide pour « ${cle} » : ${JSON.stringify(valeur)}`);
    }
  }
  return problemes;
}

/**
 * Le verdict d'ENSEMBLE, dérivé des points.
 *
 * Un seul point non conforme suffit à refuser le kimono — il n'y a pas de moyenne,
 * pas de compensation. En revanche l'absence de mesure n'est PAS une conformité :
 * un contrôle sans aucun point renseigné rend `null`, ce qui oblige l'appelant à
 * décider au lieu d'hériter d'un « conforme » par défaut.
 */
export function medidoOverall(checks: MedidoChecks): "conforme" | "non_conforme" | null {
  const valeurs = MEDIDO_ITEMS.map((i) => checks[i]).filter(
    (v): v is MedidoVerdict => v !== undefined,
  );
  if (valeurs.length === 0) return null;
  if (valeurs.some((v) => v === "non_conforme")) return "non_conforme";
  // Tous les points regardés sont conformes. Ceux marqués `non_mesure` ne
  // s'opposent pas : un kimono conforme sur la manche, le col et le pantalon n'a
  // pas à attendre les écussons pour monter sur le tapis.
  return valeurs.every((v) => v === "non_mesure") ? null : "conforme";
}

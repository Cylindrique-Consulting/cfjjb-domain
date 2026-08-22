/**
 * « CE COMBATTANT PEUT-IL COMBATTRE ? » — la jointure des trois postes.
 *
 * Le jour J compte TROIS contrôles indépendants, et non un :
 *
 *   - le POINTAGE de présence (table d'accueil, ou self-service) ;
 *   - la PESÉE, qui relève un poids et le compare à la limite de la catégorie ;
 *   - le MEDIDO, contrôle du gabarit de kimono à la jauge IBJJF — longueur de
 *     manche, épaisseur de col, longueur de pantalon, écussons.
 *
 * Trois postes, trois opérateurs, trois verdicts. La question « peut-il
 * combattre ? » n'est donc pas un booléen mais une DÉRIVATION, et c'est cette
 * fonction — elle seule — qui la calcule. Sans elle, les trois postes sont trois
 * silos et c'est la table de marque qui improvise.
 *
 * Elle tourne à l'identique dans le navigateur d'un opérateur et sur le serveur :
 * l'écran désactive le bouton « Démarrer » et le serveur refuse la mutation, mais
 * les deux disent la MÊME chose. Masquer un bouton n'est pas une frontière.
 */

export type PresenceStatus = "expected" | "present" | "absent" | "withdrawn_onsite";
export type WeighInStatus = "pending" | "passed" | "failed" | "waived" | "absent";
export type MedidoStatus = "pending" | "conforme" | "non_conforme" | "non_presente";

export type ControlRequirements = {
  /** La compétition tient-elle un poste de pointage ? */
  presence: boolean;
  /** Tient-elle un poste de pesée ? */
  weighIn: boolean;
  /**
   * Tient-elle un poste de medido ?
   *
   * Toutes ne le font pas, et le No-Gi a de toute façon ses propres règles de
   * tenue (rashguard, short) : le contrôle est TYPÉ, pas figé sur « gi ».
   */
  medido: boolean;
};

export type ControlInput = {
  discipline: "gi" | "nogi";
  requirements: ControlRequirements;
  presence: PresenceStatus;
  weighIn: WeighInStatus;
  medido: MedidoStatus;
  /** Forfait prononcé par le commissaire, quelle qu'en soit la raison. */
  forfeited?: boolean;
};

export type ControlState =
  /** Éliminé : hors-poids, absent, désistement sur site, ou forfait prononcé. DOMINE tout. */
  | "elimine"
  /** Bloqué par un gabarit non conforme — réparable, contrairement au poids. */
  | "bloque_gi"
  | "attente_pointage"
  | "attente_pesee"
  | "attente_medido"
  | "ok";

/**
 * L'état de contrôle, dans un ordre de priorité qui n'est pas arbitraire.
 *
 * `elimine` passe AVANT tout le reste : un combattant hors-poids qui n'a pas
 * encore fait son medido est éliminé, pas « en attente de medido ». Traiter les
 * attentes d'abord ferait afficher un poste à faire pour quelqu'un qui ne
 * combattra pas.
 *
 * ASYMÉTRIE ASSUMÉE ENTRE LE POIDS ET LE KIMONO : un hors-poids élimine, un
 * gabarit non conforme BLOQUE sans éliminer. Le poids est définitif, le kimono
 * est réparable — l'athlète en change et repasse au contrôle. Si personne ne
 * revient, c'est le commissaire qui prononce le forfait, explicitement. La
 * station rapporte un fait ; elle ne prend pas la décision irréversible.
 */
export function controlStateOf(input: ControlInput): ControlState {
  const { requirements: req } = input;

  if (input.forfeited) return "elimine";
  if (input.presence === "absent" || input.presence === "withdrawn_onsite") return "elimine";
  if (req.weighIn && (input.weighIn === "failed" || input.weighIn === "absent")) return "elimine";

  // Le medido ne concerne que le Gi : le No-Gi n'a pas de kimono à mesurer.
  const medidoApplicable = req.medido && input.discipline === "gi";
  if (medidoApplicable && input.medido === "non_conforme") return "bloque_gi";

  if (req.presence && input.presence !== "present") return "attente_pointage";
  // `waived` = pesée explicitement dispensée par le commissaire : c'est une
  // décision prise, pas une attente. Seul `pending` fait attendre.
  if (req.weighIn && input.weighIn === "pending") return "attente_pesee";
  if (medidoApplicable && (input.medido === "pending" || input.medido === "non_presente"))
    return "attente_medido";

  return "ok";
}

/** Un combat ne peut démarrer que si les DEUX combattants sont en état `ok`. */
export function canStartFight(a: ControlState, b: ControlState): boolean {
  return a === "ok" && b === "ok";
}

/** Le motif de refus, en français, tel qu'il doit s'afficher sur la table de marque. */
export function controlStateReason(state: ControlState): string | null {
  switch (state) {
    case "ok":
      return null;
    case "elimine":
      return "Éliminé (hors-poids, absent ou forfait)";
    case "bloque_gi":
      return "Gi non conforme — contrôle du gabarit à repasser";
    case "attente_pointage":
      return "Pas encore pointé";
    case "attente_pesee":
      return "Pas encore pesé";
    case "attente_medido":
      return "Gabarit de kimono pas encore contrôlé";
  }
}

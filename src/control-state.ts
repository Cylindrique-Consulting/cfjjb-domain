export type PresenceStatus = "expected" | "present" | "absent" | "withdrawn_onsite";
export type WeighInStatus = "pending" | "passed" | "failed" | "waived" | "absent";
export type MedidoStatus = "pending" | "conforme" | "non_conforme" | "non_presente";

export type ControlRequirements = {
  presence: boolean;
  weighIn: boolean;
  medido: boolean;
};

export type ControlInput = {
  discipline: "gi" | "nogi";
  requirements: ControlRequirements;
  presence: PresenceStatus;
  weighIn: WeighInStatus;
  medido: MedidoStatus;
  forfeited?: boolean;
  recheckPending?: boolean;
};

export type ControlState =
  | "elimine"
  | "bloque_gi"
  | "attente_pointage"
  | "attente_pesee"
  | "attente_medido"
  | "attente_recontrole"
  | "ok";

export function controlStateOf(input: ControlInput): ControlState {
  const { requirements: req } = input;

  if (input.forfeited) return "elimine";
  if (input.presence === "absent" || input.presence === "withdrawn_onsite") return "elimine";
  if (req.weighIn && (input.weighIn === "failed" || input.weighIn === "absent")) return "elimine";

  const medidoApplicable = req.medido && input.discipline === "gi";
  if (medidoApplicable && input.medido === "non_conforme") return "bloque_gi";

  if (req.presence && input.presence !== "present") return "attente_pointage";
  if (req.weighIn && input.weighIn === "pending") return "attente_pesee";
  if (medidoApplicable && (input.medido === "pending" || input.medido === "non_presente"))
    return "attente_medido";

  if (input.recheckPending) return "attente_recontrole";

  return "ok";
}

export function canStartFight(a: ControlState, b: ControlState): boolean {
  return a === "ok" && b === "ok";
}

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
    case "attente_recontrole":
      return "A combattu : re-contrôle au guichet requis";
  }
}

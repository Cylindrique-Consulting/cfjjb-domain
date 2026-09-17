export const MEDIDO_ITEMS = ["manche", "col", "pantalon", "ecussons"] as const;

export type MedidoItem = (typeof MEDIDO_ITEMS)[number];

export const MEDIDO_ITEM_LABEL: Record<MedidoItem, string> = {
  manche: "Manche",
  col: "Col",
  pantalon: "Pantalon",
  ecussons: "Écussons",
};

export const MEDIDO_ITEM_HINT: Record<MedidoItem, string> = {
  manche: "Longueur de manche et écart au poignet, bras tendu.",
  col: "Épaisseur et largeur du col.",
  pantalon: "Longueur de jambe et écart à la cheville.",
  ecussons: "Emplacement et taille des écussons.",
};

export type MedidoVerdict = "conforme" | "non_conforme" | "non_mesure";

export const MEDIDO_VERDICTS = ["conforme", "non_conforme", "non_mesure"] as const;

export type MedidoChecks = Partial<Record<MedidoItem, MedidoVerdict>>;

export function isMedidoItem(v: unknown): v is MedidoItem {
  return typeof v === "string" && (MEDIDO_ITEMS as readonly string[]).includes(v);
}

export function isMedidoVerdict(v: unknown): v is MedidoVerdict {
  return typeof v === "string" && (MEDIDO_VERDICTS as readonly string[]).includes(v);
}

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

export function medidoOverall(checks: MedidoChecks): "conforme" | "non_conforme" | null {
  const valeurs = MEDIDO_ITEMS.map((i) => checks[i]).filter(
    (v): v is MedidoVerdict => v !== undefined,
  );
  if (valeurs.length === 0) return null;
  if (valeurs.some((v) => v === "non_conforme")) return "non_conforme";
  return valeurs.every((v) => v === "non_mesure") ? null : "conforme";
}

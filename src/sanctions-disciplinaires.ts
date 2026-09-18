import type { StatutDisciplinaire } from "./podium-officiel";

/**
 * LE VOCABULAIRE DE LA SANCTION DISCIPLINAIRE (lot L7, DQ2).
 *
 * ┌─ POURQUOI ICI, ET PAS DANS CHAQUE DÉPÔT ──────────────────────────────────┐
 * │ Trois écrits doivent dire la même chose de la même sanction : la contrainte │
 * │ CHECK de `competition_disciplinary_sanctions` (cfjjb-platform), les         │
 * │ boutons de la table de marque et le bandeau du Responsable (module). Les    │
 * │ trois listes recopiées à la main divergent au premier ajout — et une        │
 * │ divergence se voit alors en CF422 au bord d'un tapis, un samedi matin.      │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ CE QUE CE MODULE NE PORTE PAS, ET IL FAUT LE SAVOIR ─────────────────────┐
 * │ Le LIBELLÉ de chaque article du règlement IBJJF. Le client a nommé la       │
 * │ « liste des articles 6.1.1 à 6.1.6 » (DQ2.6, DQ2.10) sans en donner le      │
 * │ texte, et aucune de nos sources ne le porte. Inventer six phrases et les    │
 * │ présenter comme le règlement serait pire qu'un code nu : l'arbitre les      │
 * │ lirait comme officielles. `libelleCodeSanction` rend donc « Article 6.1.4 » │
 * │ tant que la fédération ne nous a pas transmis les six intitulés, et         │
 * │ `LIBELLES_ARTICLES_A_FOURNIR` dit explicitement qu'ils manquent.            │
 * └───────────────────────────────────────────────────────────────────────────┘
 */

/** Les six motifs de disqualification disciplinaire (IBJJF Rules Book 6.1). */
export const CODES_SANCTION = ["6.1.1", "6.1.2", "6.1.3", "6.1.4", "6.1.5", "6.1.6"] as const;

export type CodeSanction = (typeof CODES_SANCTION)[number];

/**
 * VRAI : la fédération ne nous a pas transmis le texte des six articles. Lu par
 * l'écran pour afficher un rappel au staff plutôt que six libellés inventés.
 * Passe à faux le jour où `LIBELLES_ARTICLES` est renseigné.
 */
export const LIBELLES_ARTICLES_A_FOURNIR = true;

export function estCodeSanction(valeur: string | null | undefined): valeur is CodeSanction {
  return (
    valeur !== null &&
    valeur !== undefined &&
    (CODES_SANCTION as readonly string[]).includes(valeur)
  );
}

export function libelleCodeSanction(code: CodeSanction): string {
  return `Article ${code}`;
}

/**
 * LE MOMENT DE LA FAUTE (DQ2.10), et il décide de la règle appliquée :
 *   * `pendant` — le combat est perdu sur le coup (IBJJF GCG 2.4.2) ;
 *   * `apres`   — l'athlète est retiré et ses adversaires battus remontent d'une
 *                 place (IBJJF GCG 2.4.3) ;
 *   * `avant`   — pour qui a déjà combattu dans la catégorie, on applique 2.4.3
 *                 depuis son combat précédent ; pour qui n'a jamais combattu,
 *                 aucune médaille et la place revient à l'athlète battu plus tôt,
 *                 sinon elle reste vacante (T2.3).
 */
export const MOMENTS_DE_FAUTE = ["avant", "pendant", "apres"] as const;
export type MomentDeFaute = (typeof MOMENTS_DE_FAUTE)[number];

export const LIBELLES_MOMENT: Record<MomentDeFaute, string> = {
  avant: "avant le combat",
  pendant: "pendant le combat",
  apres: "après le combat",
};

/** D'où vient la sanction : de la table à la fin d'un combat, ou du Responsable. */
export const ORIGINES_SANCTION = ["table", "hors_combat"] as const;
export type OrigineSanction = (typeof ORIGINES_SANCTION)[number];

/** Le cycle de vie d'une sanction (DQ2.6, DQ2.8, DQ2.13). */
export const STATUTS_SANCTION = ["en_attente", "validee", "refusee", "annulee"] as const;
export type StatutSanction = (typeof STATUTS_SANCTION)[number];

/**
 * LES DEUX ISSUES D'UN REFUS (DQ2.8) :
 *   * `requalification` — la faute devient technique, le résultat et la place sont
 *     conservés ;
 *   * `reouverture`     — le résultat est annulé et le combat repart, comme
 *     « Corriger le résultat », et seulement si l'art. 1.1.4 le permet (tableau
 *     non avancé, médailles non remises).
 */
export const ISSUES_DE_REFUS = ["requalification", "reouverture"] as const;
export type IssueDeRefus = (typeof ISSUES_DE_REFUS)[number];

/**
 * LE PONT VERS LE MOTEUR DE CLASSEMENT.
 *
 * `classementOfficiel` raisonne sur trois valeurs — « aucune », « en_attente »,
 * « validee » — et rend l'état `disciplinaire_en_attente` quand une décision
 * manque. Cette fonction est le SEUL endroit qui traduit le statut d'une ligne de
 * sanction dans ce vocabulaire : un refus et une annulation valent « aucune »,
 * parce qu'ils rendent à l'athlète sa place (DQ2.8, DQ2.13).
 */
export function statutDisciplinaireDeLaSanction(
  statut: StatutSanction | null | undefined,
): StatutDisciplinaire {
  if (statut === "validee") return "validee";
  if (statut === "en_attente") return "en_attente";
  return "aucune";
}

/**
 * CE QUE LA SALLE LIT, ET RIEN DE PLUS (DQ2.11, T13.2 A).
 *
 * « Écran externe et vues publiques : "Disqualification" seule. La faute précise
 * n'est visible que du staff. » Une fonction et non une constante : l'appelant
 * public n'a alors aucun moyen de faire fuir le motif, même en lui passant le
 * code par habitude.
 */
export function libellePublicDeSanction(): string {
  return "Disqualification";
}

/** Ce que le staff lit, au pointage, dans les arbres et au podium (DQ2.11). */
export function libelleStaffDeSanction(statut: StatutSanction): string {
  if (statut === "en_attente") return "Disqualification disciplinaire en attente de validation";
  if (statut === "validee") return "Disqualifié (disciplinaire)";
  if (statut === "refusee") return "Disqualification disciplinaire refusée";
  return "Disqualification disciplinaire annulée";
}

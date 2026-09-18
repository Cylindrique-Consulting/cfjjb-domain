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
 * ┌─ LE TEXTE DES ARTICLES, ET D'OÙ IL VIENT ─────────────────────────────────┐
 * │ Le client a répondu A à DQ2.10 : « Liste reprenant l'article 6.1 +        │
 * │ commentaire libre facultatif ». Les six articles sont ceux du règlement   │
 * │ officiel CFJJB 2024, page 23, « 6.1 Fautes disciplinaires », numérotés    │
 * │ comme dans le règlement IBJJF 2024. `TEXTES_ARTICLES_SANCTION` les        │
 * │ recopie mot pour mot, apostrophes typographiques mises à part ;           │
 * │ `LIBELLES_COURTS_SANCTION` en donne un libellé par bouton, arrêté le      │
 * │ 18/09/2026. Le libellé court résume : c'est le texte complet qui fait     │
 * │ foi.                                                                      │
 * └───────────────────────────────────────────────────────────────────────────┘
 */

/** Les six motifs de disqualification disciplinaire (article 6.1, règlement CFJJB 2024). */
export const CODES_SANCTION = ["6.1.1", "6.1.2", "6.1.3", "6.1.4", "6.1.5", "6.1.6"] as const;

export type CodeSanction = (typeof CODES_SANCTION)[number];

export const LIBELLES_COURTS_SANCTION: Record<CodeSanction, string> = {
  "6.1.1": "Insultes ou gestes obscènes",
  "6.1.2": "Comportement hostile",
  "6.1.3": "Morsure, cheveux tirés, coup volontaire",
  "6.1.4": "Comportement offensant ou irrespectueux",
  "6.1.5": "Manque de sérieux ou simulation",
  "6.1.6": "Conduite incompatible avec la compétition",
};

export const TEXTES_ARTICLES_SANCTION: Record<CodeSanction, string> = {
  "6.1.1":
    "Quand un athlète insulte ou fait des gestes obscènes à l’adversaire, l’arbitre, la table centrale, le staff ou le public, avant, pendant ou après un combat.",
  "6.1.2":
    "Quand un athlète a un comportement hostile envers l’adversaire, l’arbitre, un membre de l’organisation ou le public, avant, pendant ou après un combat.",
  "6.1.3":
    "Quand un athlète mord, tire les cheveux, frappe ou écrase les organes génitaux ou les yeux, ou utilise intentionnellement un coup traumatisant de n’importe quelle sorte (coup de poing, de genou, de pied, etc.).",
  "6.1.4":
    "Quand un athlète a un comportement offensant ou irrespectueux envers un adversaire ou le public, par des mots ou des gestes, pendant un combat ou dans la célébration de la victoire.",
  "6.1.5":
    "Quand un ou les deux athlètes ne respectent pas le sérieux de la compétition ou réalisent un faux combat.",
  "6.1.6":
    "Quand un athlète se comporte d’une manière incompatible avec l’environnement de la compétition, ou commet tout autre délit, même si cela se produit avant ou après le combat.",
};

export function estCodeSanction(valeur: string | null | undefined): valeur is CodeSanction {
  return (
    valeur !== null &&
    valeur !== undefined &&
    (CODES_SANCTION as readonly string[]).includes(valeur)
  );
}

export function libelleCodeSanction(code: CodeSanction): string {
  return `Article ${code} : ${LIBELLES_COURTS_SANCTION[code]}`;
}

export function texteArticleSanction(code: CodeSanction): string {
  return TEXTES_ARTICLES_SANCTION[code];
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

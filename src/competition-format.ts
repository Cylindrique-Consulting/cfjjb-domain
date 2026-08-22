/**
 * LE FORMAT D'UNE CATÉGORIE, et la table qui le décide.
 *
 * ┌─ CE QUE CE MODULE RÉPARE ─────────────────────────────────────────────────┐
 * │ `competitions.bracket_mode` accepte trois valeurs depuis juin 2026         │
 * │ (`single_elim_no_third`, `single_elim_with_third`, `pools`), et AUCUN code │
 * │ ne lisait cette colonne. Une compétition enregistrée « Poules » produisait │
 * │ donc une élimination directe, en silence — pas d'erreur, pas de journal,   │
 * │ juste un tableau qui n'est pas celui qu'on a demandé.                      │
 * │                                                                            │
 * │ Deux choses manquaient, et ce module les nomme : le VOCABULAIRE (la        │
 * │ colonne mélange le format et le mode de 3e place, il faut les démêler) et  │
 * │ la TABLE qui dit, tranche d'âge par tranche d'âge, quel format s'applique. │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠ DÉCISION PRODUIT DU 21/08/2026, GELÉE PAR UN TEST.
 *
 * Le moteur de poules est livré et testé, mais AUCUN format par défaut ne
 * l'active : `DEFAULT_FORMAT_BY_AGE_GROUP` rend `single_elim` pour les douze
 * tranches d'âge, sans exception. La fédération activera catégorie par
 * catégorie, quand elle le décidera.
 *
 * La table est donc une TABLE, et non une constante : elle existe, elle se
 * lit, elle se remplace par l'appelant — mais son défaut ne change rien à la
 * production. `tests/competition-format.test.ts` gèle ce défaut, de sorte
 * qu'une bascule involontaire d'une seule tranche casse la CI plutôt que de
 * changer le format de vraies compétitions sans décision.
 *
 * Module pur : aucune IO, aucune lecture de base.
 */

import { AGE_GROUPS, type AgeGroup } from "./referential";

/**
 * Le format d'une catégorie, dans le vocabulaire du référentiel.
 *
 * - `single_elim` : élimination directe, l'arbre de `bracket-generator.ts` ;
 * - `pools` : poule unique en round-robin, la table de `pool-generator.ts`.
 *
 * Le mode de 3e place (`ThirdPlaceMode`) est une dimension SÉPARÉE, et il est
 * sans objet en poule — voir `computeMedalNeed`.
 */
export type DrawFormat = "single_elim" | "pools";

/**
 * Les trois valeurs réellement portées par `competitions.bracket_mode`.
 *
 * PAS un enum Postgres : c'est un `text` sous contrainte `check`, posée par
 * `20260619000002_competitions_extended.sql`. Même statut que `ThirdPlaceMode`
 * (cf. `enums.ts`), et même conséquence : le test d'assignabilité de la
 * plateforme ne peut pas la couvrir, il n'existe aucun type généré en face.
 *
 * Il est déclaré ICI et non dans `enums.ts` parce qu'il ne se lit jamais seul :
 * il n'a de sens qu'accompagné de la conversion ci-dessous, qui décide ce qu'on
 * en retient. Un type de vocabulaire séparé de sa conversion invite à lire la
 * colonne à la main, c'est-à-dire à recréer le mélange qu'on vient de démêler.
 *
 * ⚠ LA COLONNE MÉLANGE DEUX DIMENSIONS. `single_elim_no_third` et
 * `single_elim_with_third` désignent le même FORMAT et deux modes de 3e place
 * différents — alors qu'une colonne `third_place_mode` existe déjà, à côté, et
 * que c'est ELLE que le générateur lit. Ce module ne lit donc de
 * `bracket_mode` que ce dont il répond : le format. Traduire aussi le mode de
 * 3e place ferait de cette fonction un deuxième vocabulaire concurrent de la
 * colonne dédiée, et deux sources finissent toujours par diverger.
 */
export type BracketModeDb = "single_elim_no_third" | "single_elim_with_third" | "pools";

/**
 * Le FORMAT porté par une valeur de `competitions.bracket_mode`.
 *
 * `null` signifie « je ne sais pas », et c'est une réponse : une valeur hors
 * contrainte (ligne reprise, contrainte relâchée un jour) ne doit pas être
 * approximée en élimination directe, elle doit remonter à l'appelant. Le
 * précédent est documenté dans `db-vocabulary.ts` : c'est le repli silencieux
 * qui coûte, jamais le refus.
 */
export function drawFormatFromBracketMode(stored: string | null | undefined): DrawFormat | null {
  switch (stored) {
    case "single_elim_no_third":
    case "single_elim_with_third":
      return "single_elim";
    case "pools":
      return "pools";
    default:
      return null;
  }
}

/** Le format applicable, tranche d'âge par tranche d'âge. */
export type FormatByAgeGroup = Readonly<Record<AgeGroup, DrawFormat>>;

/**
 * LA TABLE PAR DÉFAUT : élimination directe partout, sans exception.
 *
 * Elle est écrite tranche par tranche, et non générée par une boucle, PRÉCISÉMENT
 * pour qu'allumer une tranche soit un diff d'une ligne, lisible en revue par
 * quelqu'un qui ne lit pas de TypeScript.
 */
export const DEFAULT_FORMAT_BY_AGE_GROUP: FormatByAgeGroup = {
  U7: "single_elim",
  U9: "single_elim",
  U11: "single_elim",
  U13: "single_elim",
  U15: "single_elim",
  Juvénile: "single_elim",
  Adulte: "single_elim",
  "Master 1": "single_elim",
  "Master 2": "single_elim",
  "Master 3": "single_elim",
  "Master 4": "single_elim",
  "Master 5+": "single_elim",
};

/**
 * Le format d'une tranche d'âge, selon la table fournie (défaut : la table
 * gelée ci-dessus).
 *
 * Une tranche absente de la table rend `single_elim` : le défaut de sécurité
 * est le format d'aujourd'hui, jamais le format neuf. Une table incomplète ne
 * doit pas basculer une catégorie en poule par omission.
 */
export function formatForAgeGroup(
  ageGroup: AgeGroup,
  table: Partial<FormatByAgeGroup> = DEFAULT_FORMAT_BY_AGE_GROUP,
): DrawFormat {
  return table[ageGroup] ?? "single_elim";
}

/** Les tranches d'âge que la table bascule en poule. Vide par défaut, et c'est la décision produit. */
export function ageGroupsInPools(
  table: Partial<FormatByAgeGroup> = DEFAULT_FORMAT_BY_AGE_GROUP,
): AgeGroup[] {
  return AGE_GROUPS.filter((group) => formatForAgeGroup(group, table) === "pools");
}

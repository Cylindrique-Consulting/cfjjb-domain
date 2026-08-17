/**
 * CONTRATS ÉTROITS DU VOCABULAIRE MÉTIER — écrits à la main, jamais générés.
 *
 * Ce package est PUBLIC. Les types Supabase générés n'y entrent pas : ils
 * publieraient la carte complète du schéma d'une base qui porte les données de
 * 90 000 personnes, dont des mineurs. La RLS reste la frontière de sécurité,
 * mais on n'offre pas la carte.
 *
 * On déclare donc ici les seules unions dont les algorithmes ont besoin, à la
 * main. Le risque évident est la dérive : ces littéraux pourraient s'éloigner
 * des enums Postgres sans que rien ne le dise.
 *
 * LE GARDE-FOU VIT DANS `cfjjb-platform`, et c'est le seul endroit possible :
 * c'est le seul dépôt où COEXISTENT ces contrats et `types/database.generated.ts`.
 * Un test y vérifie l'identité structurelle dans les deux sens — une valeur
 * ajoutée à l'enum Postgres comme une valeur retirée d'ici casse la CI de la
 * plateforme. Ne jamais éditer un type de ce fichier sans faire tourner ce test.
 *
 * Source (relevée le 17/08/2026 sur `Database["public"]["Enums"]`).
 */

/** Enum Postgres `belt`. Ordre = progression, et il compte : le planning et le tri des catégories s'appuient dessus. */
export type BeltDb =
  | "white"
  | "grey"
  | "yellow"
  | "orange"
  | "green"
  | "blue"
  | "purple"
  | "brown"
  | "black"
  | "coral"
  | "red";

/** Enum Postgres `gender`. */
export type GenderDb = "male" | "female";

/** Enum Postgres `discipline`. Gi = avec kimono, No-Gi = sans. */
export type DisciplineDb = "gi" | "nogi";

/**
 * Mode d'attribution de la 3e place.
 *
 * PAS un enum Postgres : la colonne `competitions.third_place_mode` est un
 * `text` sous contrainte `check`. Le test d'assignabilité de la plateforme ne
 * peut donc pas la couvrir — il n'existe aucun type généré en face. C'est aussi
 * la raison pour laquelle cette union était DUPLIQUÉE avant l'extraction : une
 * fois dans `bracket-generator.ts`, une fois dans `types/supabase.ts`. Elle
 * n'est plus déclarée qu'ici.
 *
 * - `pool3` : un vrai combat de 3e place (`BraketFightPool3`).
 * - `shared_bronze` : double bronze IBJJF, aucun combat supplémentaire.
 */
export type ThirdPlaceMode = "pool3" | "shared_bronze";

/** Alias historique, conservé parce que la plateforme l'importe sous ce nom. */
export type ThirdPlaceModeDb = ThirdPlaceMode;

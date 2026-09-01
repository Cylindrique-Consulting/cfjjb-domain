import {
  AGE_GROUPS,
  isChildAgeGroup,
  listWeightClasses,
  WEIGHT_CLASSES,
  weightClassLabel,
  type AgeGroup,
  type Discipline,
  type WeightClassName,
} from "./referential";
import type { GenderDb } from "./enums";

/**
 * DEUX VOCABULAIRES DANS LA MÊME COLONNE, ET LE RÉFÉRENTIEL N'EN CONNAÎT QU'UN.
 *
 * `competition_registrations.age_group` et `.weight_class` portent, selon
 * l'origine de la ligne, deux langues différentes :
 *
 *   - les 131 215 lignes reprises par l'ETL parlent en CODES (`adult`,
 *     `master_1_2`, `u11`) et en INDICES (`"0"` à `"8"`, plus des aberrations) ;
 *   - le chemin d'écriture de la plateforme valide par `z.enum(AGE_GROUPS)` et
 *     `z.enum(WEIGHT_CLASSES)` : il écrit donc des LIBELLÉS (`Adulte`) et des NOMS
 *     (`Leve`).
 *
 * La colonne portera les deux simultanément dès la première inscription réelle.
 * Une conversion appliquée aveuglément aux deux corromprait les nouvelles lignes ;
 * ce module reconnaît donc les deux et n'en traduit qu'une.
 *
 * ┌─ POURQUOI CE MODULE EXISTE, ET CE QU'IL ÉVITE ────────────────────────────┐
 * │ Le mode de défaillance n'est PAS une exception. Il est MUET, et il porte    │
 * │ sur des enfants.                                                           │
 * │                                                                            │
 * │ `isChildAgeGroup` se réduit à `ageGroup.startsWith("U")`, sensible à la     │
 * │ casse. Le code `u11` rend donc FAUX, part dans les tables ADULTES, et       │
 * │ `getMaxWeightKg` rend la limite d'un homme adulte. Mesuré : `u11` + `Pena`  │
 * │ → 70,0 kg au lieu de 36,2 kg. Aucune exception, aucun journal : une pesée   │
 * │ validée à tort, et un enfant qui combat hors de sa catégorie.               │
 * │                                                                            │
 * │ `getFightDurationSeconds` ne lève pas non plus : il rend `null` pour tout   │
 * │ code, et un `?? 300` en aval le transforme en une durée d'apparence         │
 * │ normale.                                                                   │
 * │                                                                            │
 * │ Compter sur « ça lèvera si le code est mauvais » est donc faux dans les     │
 * │ deux cas. La seule protection est une conversion TOTALE et EXPLICITE en     │
 * │ amont, qui rend `null` plutôt que d'approximer.                            │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠ NE PAS UTILISER `ageGroupLabel` POUR CELA. Son nom le suggère et sa place
 * dans `referential.ts` l'encourage, mais elle produit des libellés
 * d'ATTESTATION : `master_1_2` y devient « Master 1-2 », qui n'appartient pas à
 * `AGE_GROUPS`. Sur les 18 codes de production, 8 rendent une chaîne hors
 * vocabulaire — 43 697 inscriptions actives sur 128 825.
 */

/**
 * Les codes d'âge de la base, vers le vocabulaire du référentiel.
 *
 * `null` signifie « je ne sais pas », et c'est une réponse. Une limite de poids
 * fausse à la balance élimine un combattant à tort, et c'est irréversible dans la
 * journée : mieux vaut refuser de répondre et laisser l'opérateur lire le libellé
 * de l'organisateur.
 *
 * REGROUPEMENTS SANS PERTE. Les tables de poids ne distinguent que quatre
 * colonnes (juvénile/adulte × homme/femme, les masters retombant sur adulte) et
 * les tables de durée regroupent Master 1 avec Master 2, puis Master 3 avec
 * Master 4 et Master 5+. Traduire `master_1_2` par « Master 1 » et `master_3_4`
 * par « Master 3 » est donc exact pour les DEUX calculs.
 *
 * EN REVANCHE une conversion GROSSIÈRE — tous les masters vers « Adulte » — serait
 * indétectable sur le poids et FAUSSE sur les durées : une ceinture noire master
 * combattrait 600 s au lieu de 360, soit le double.
 */
const CODE_VERS_AGE_GROUP: Readonly<Record<string, AgeGroup>> = {
  // Les dix codes vivants, présents jusqu'aux dernières compétitions renseignées.
  adult: "Adulte",
  juvenil: "Juvénile",
  u7: "U7",
  u9: "U9",
  u11: "U11",
  u13: "U13",
  u15: "U15",
  master_1_2: "Master 1",
  master_3_4: "Master 3",
  master_5_plus: "Master 5+",
};

/**
 * Les codes qu'on refuse SCIEMMENT de traduire.
 *
 * Ils sont tous éteints — le plus récent (`master`) n'apparaît plus depuis 2023,
 * les autres depuis 2022 — et aucun ne désigne une tranche unique : `master` ne
 * dit pas lequel, et `mirim`, `premirim`, `infantil`, `infantiljuvenil`, `child`
 * sont d'anciennes tranches enfants dont le découpage ne recouvre pas les U7–U15.
 * Leur inventer une correspondance ajouterait du risque sur des enfants, pour une
 * donnée que l'outil du jour J ne rencontrera jamais.
 */
export const CODES_AGE_NON_TRADUISIBLES = [
  "master",
  // `master1` et `master2` FURENT d'abord traduits, par déduction depuis leur NOM.
  // La mesure les réfute : `master2` porte 1 149 lignes de 41 à 66 ans, alors que
  // « Master 2 » désigne 36-40 au référentiel — la durée aurait été surévaluée de
  // 60 s (+20 %) en violette, marron et noire. `master1` (30 lignes, 31-38 ans)
  // tiendrait, lui, dans la bonne classe d'équivalence — mais c'est une coïncidence
  // de population et non une règle, et son jumeau prouve que cette paire numérote
  // autrement que le référentiel. Zéro ligne sur une compétition à venir : le refus
  // ne coûte rien et l'approximation aurait coûté une durée fausse.
  "master1",
  "master2",
  "child",
  "mirim",
  "premirim",
  "infantil",
  "infantiljuvenil",
] as const;

/**
 * Un `age_group` lu en base → `AgeGroup`, ou `null`.
 *
 * Accepte les deux vocabulaires : un libellé déjà valide est rendu tel quel, un
 * code connu est traduit, tout le reste rend `null`.
 */
export function resolveAgeGroup(stored: string | null | undefined): AgeGroup | null {
  if (!stored) return null;
  const brut = stored.trim();
  // Vocabulaire NEUF : la valeur est déjà un libellé du référentiel.
  const direct = (AGE_GROUPS as readonly string[]).find((g) => g === brut);
  if (direct) return direct as AgeGroup;
  // Vocabulaire ETL : un code. La casse est normalisée parce que la colonne n'a
  // aucune contrainte et qu'un `Adult` majuscule y serait passé sans bruit.
  return CODE_VERS_AGE_GROUP[brut.toLowerCase()] ?? null;
}

/**
 * Un `weight_class` lu en base → `WeightClassName`, ou `null`.
 *
 * `weightClassLabel` (CYL-435) fait déjà la traduction de l'indice et rejette les
 * aberrations mesurées de la colonne (`"9"`, `"36"`, `"500"`, `"-30"`). On ne la
 * réécrit pas : on ajoute seulement la reconnaissance du vocabulaire neuf.
 */
export function resolveWeightClass(stored: string | null | undefined): WeightClassName | null {
  if (!stored) return null;
  const brut = stored.trim();
  const direct = (WEIGHT_CLASSES as readonly string[]).find((w) => w === brut);
  if (direct) return direct as WeightClassName;
  return weightClassLabel(brut) as WeightClassName | null;
}

/** Pourquoi une limite n'a pas pu être établie. Destiné à être AFFICHÉ. */
export type LimiteRefus =
  | "age_inconnu"
  | "classe_inconnue"
  | "genre_manquant"
  /** La classe existe au référentiel, mais pas pour cette bande et ce genre. */
  | "classe_absente_pour_ce_groupe"
  | "combinaison_absente";

export type LimiteResultat =
  | { ok: true; ageGroup: AgeGroup; weightClass: WeightClassName; maxKg: number | null }
  | { ok: false; raison: LimiteRefus };

/**
 * LA LIMITE DE POIDS D'UNE INSCRIPTION — le seul point d'entrée pour une balance.
 *
 * Elle prend les valeurs BRUTES de la base et rend soit une limite établie, soit
 * un refus motivé. Jamais une approximation.
 *
 * `maxKg: null` avec `ok: true` n'est PAS un échec : les catégories les plus
 * lourdes n'ont pas de plafond. La distinction compte — « sans limite » se dit à
 * l'écran, « je ne sais pas » se dit autrement.
 *
 * LE GENRE VIENT DU LICENCIÉ, jamais de l'inscription :
 * `competition_registrations.gender` est NULL sur les 131 215 lignes mesurées, et
 * `licensees.gender` l'a sur 87 546 sur 87 546. L'appelant doit donc joindre.
 */
export function resolveWeightLimit(input: {
  discipline: Discipline;
  storedAgeGroup: string | null | undefined;
  gender: GenderDb | null | undefined;
  storedWeightClass: string | null | undefined;
}): LimiteResultat {
  const ageGroup = resolveAgeGroup(input.storedAgeGroup);
  if (!ageGroup) return { ok: false, raison: "age_inconnu" };

  const weightClass = resolveWeightClass(input.storedWeightClass);
  if (!weightClass) return { ok: false, raison: "classe_inconnue" };

  // LE GENRE N'EST REQUIS QUE HORS BANDES ENFANTS. Les tables U7–U15 n'ont aucune
  // dimension de genre (`ChildWeightRow` ne la porte pas), donc la limite d'un
  // enfant est entièrement déterminée sans lui. Exiger le genre avant cette
  // distinction refusait 14 358 inscriptions enfants — dont le genre est NULL sur
  // 14 358 en base — c'est-à-dire précisément la population que ce module existe
  // pour protéger.
  const enfant = isChildAgeGroup(ageGroup);
  if (!enfant && !input.gender) return { ok: false, raison: "genre_manquant" };
  // Valeur indifférente pour une bande enfant : la table l'ignore. On la fournit
  // parce que la signature du référentiel l'exige, pas parce qu'elle compte.
  const genre: GenderDb = input.gender ?? "male";

  // `getMaxWeightKg` LÈVE sur une classe hors vocabulaire (`table[nom]` est alors
  // `undefined`). Les deux résolutions ci-dessus l'excluent, mais on garde la
  // garde : ce module est la frontière, et une frontière qui suppose ses entrées
  // valides n'en est pas une.
  // DEUX SITUATIONS OPPOSÉES QUE `getMaxWeightKg` REND TOUTES DEUX `null` :
  //   - Pesadissimo, classe OUVERTE : « sans limite » est la bonne réponse ;
  //   - Super Pesado féminin, classe QUI N'EXISTE PAS pour ce groupe.
  //
  // Les confondre ferait afficher « sans limite » à 503 femmes inscrites en Super
  // Pesado (mesuré) — et à la balance, « sans limite » laisse passer n'importe quel
  // poids. `listWeightClasses` sait déjà les séparer : elle écarte les cases nulles
  // et garde Pesadissimo à `maxKg: null`.
  let offertes: ReturnType<typeof listWeightClasses>;
  try {
    offertes = listWeightClasses(input.discipline, ageGroup, genre);
  } catch {
    return { ok: false, raison: "combinaison_absente" };
  }
  const trouvee = offertes.find((o) => o.name === weightClass);
  if (!trouvee) return { ok: false, raison: "classe_absente_pour_ce_groupe" };
  return { ok: true, ageGroup, weightClass, maxKg: trouvee.maxKg };
}

/** Le motif de refus, tel qu'il doit s'afficher à la balance. */
export function limiteRefusMessage(raison: LimiteRefus): string {
  switch (raison) {
    case "age_inconnu":
      return "Catégorie d'âge non reconnue : pesez selon la feuille de l'organisateur.";
    case "classe_inconnue":
      return "Classe de poids non reconnue : pesez selon la feuille de l'organisateur.";
    case "genre_manquant":
      return "Genre du licencié inconnu : impossible d'établir la limite.";
    case "classe_absente_pour_ce_groupe":
      // NE JAMAIS dire « sans limite » ici : à la balance, cela laisse passer
      // n'importe quel poids.
      return "Cette classe de poids n'existe pas pour cette catégorie : voyez le commissaire.";
    case "combinaison_absente":
      return "Cette catégorie n'existe pas au référentiel : voyez le commissaire.";
  }
}

/**
 * Garde-fou de cohérence, exporté pour être testé.
 *
 * Tout `AgeGroup` rendu par `resolveAgeGroup` doit être classé du BON côté par
 * `isChildAgeGroup`. C'est la vérification qui attrape le défaut d'origine : le
 * code `u11` passait pour un adulte parce que `startsWith("U")` est sensible à la
 * casse, et la limite rendue était celle d'un homme adulte.
 */
export function estCoherentEnfant(code: string, resolu: AgeGroup): boolean {
  const codeEnfant = /^u\d+$/i.test(code.trim());
  return codeEnfant === isChildAgeGroup(resolu);
}

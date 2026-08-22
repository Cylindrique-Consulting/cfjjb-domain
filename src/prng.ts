/**
 * Le générateur pseudo-aléatoire PARTAGÉ du noyau métier.
 *
 * POURQUOI IL VIT DANS SON PROPRE MODULE. Un tirage de tableau est
 * contestable : un club qui trouve son licencié mal placé demande à
 * comprendre. La seule réponse acceptable est « voici la graine, rejouez ».
 * Cela n'est vrai que si TOUT le tirage passe par ici :
 *
 * - `Math.random()` est proscrit — un tableau tiré avec lui n'est pas
 *   rejouable, donc pas explicable, donc indéfendable ;
 * - une copie locale de `mulberry32` est pire encore : elle rejoue, mais
 *   pas la même chose que le voisin, et la divergence est muette.
 *
 * `fnv1a` transforme la graine textuelle (identifiant de catégorie, de
 * compétition…) en amorce 32 bits ; `mulberry32` en fait une suite ; `shuffle`
 * est le seul mélange autorisé (Fisher-Yates descendant).
 */

/** Hachage FNV-1a 32 bits d'une graine textuelle. */
export function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Suite pseudo-aléatoire déterministe dans [0, 1[ à partir d'une amorce. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates descendant, sur une copie. L'ordre de consommation du tirage fait partie du contrat. */
export function shuffle<T>(arr: readonly T[], rng: () => number): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

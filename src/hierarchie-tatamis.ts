/**
 * LA HIÉRARCHIE DES TATAMIS PAR DÉFAUT (ORD.2 A, réponse du client du 25/09/2026).
 *
 * Les tatamis vont par paires, du meilleur au moins bon : aux deux bouts de la
 * salle les meilleurs, au centre les moins bons. Sur 8 tatamis, 1 et 8 ont le
 * rang 1, 2 et 7 le rang 2, 3 et 6 le rang 3, 4 et 5 le rang 4. Les deux
 * tatamis d'une paire se valent ; avec un nombre impair, le tatami central est
 * seul au dernier rang. Le rang 1 est le meilleur.
 */
export function rangsDeQualiteParDefaut(numeros: readonly number[]): Map<number, number> {
  const tries = [...new Set(numeros)]
    .filter((numero) => Number.isFinite(numero))
    .sort((a, b) => a - b);
  const nombre = tries.length;
  const rangs = new Map<number, number>();
  tries.forEach((numero, index) => {
    const position = index + 1;
    rangs.set(numero, Math.min(position, nombre + 1 - position));
  });
  return rangs;
}

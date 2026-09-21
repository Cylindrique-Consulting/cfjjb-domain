/**
 * LA CONVENTION D'AFFICHAGE DES NOMS DE PERSONNES.
 *
 * Le nom de famille s'écrit tout en capitales ; le prénom prend une capitale
 * initiale et le reste en minuscules, sur chaque membre d'un prénom composé :
 * « jean-pierre » et « JEAN-PIERRE » s'affichent « Jean-Pierre », « d'artagnan »
 * s'affiche « D'Artagnan ». Les accents sont conservés (« ÉMILE » → « Émile »,
 * « Bénichou » → « BÉNICHOU »).
 *
 * C'est une règle d'AFFICHAGE, jamais d'écriture : la fiche garde la saisie
 * d'origine, et chaque écran, export ou lecture publique applique la règle au
 * moment de nommer quelqu'un. La plateforme et le module du jour J la lisent
 * ici ; les fonctions SQL qui composent un nom appliquent la même règle
 * (`prenom_affiche`, `nom_de_famille_affiche`), et leur parité avec ce module
 * est vérifiée sur `EXEMPLES_DE_NOMS`.
 */

const LOCALE = "fr-FR";

/** Ce qui sépare les membres d'un prénom composé : tiret, blanc, apostrophe droite ou typographique. */
const SEPARATEUR_DE_PRENOM = /([-\s'’])/;

function capitaliserUnMembre(membre: string): string {
  if (!membre) return membre;
  const minuscules = membre.toLocaleLowerCase(LOCALE);
  return minuscules.charAt(0).toLocaleUpperCase(LOCALE) + minuscules.slice(1);
}

/** Le nom de famille, tout en capitales. */
export function formatLastName(value: string | null | undefined): string {
  if (!value) return value ?? "";
  return value.toLocaleUpperCase(LOCALE);
}

/** Le prénom : une capitale initiale sur chaque membre, le reste en minuscules. */
export function formatFirstName(value: string | null | undefined): string {
  if (!value) return value ?? "";
  return value
    .split(SEPARATEUR_DE_PRENOM)
    .map((membre) => (SEPARATEUR_DE_PRENOM.test(membre) ? membre : capitaliserUnMembre(membre)))
    .join("");
}

export type PersonNameOrder = "first-last" | "last-first";

/** « Prénom NOM » par défaut, « NOM Prénom » pour une liste triée par nom ; une partie vide est omise. */
export function formatPersonName(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
  order: PersonNameOrder = "first-last",
): string {
  const first = formatFirstName(firstName).trim();
  const last = formatLastName(lastName).trim();
  const parts = order === "last-first" ? [last, first] : [first, last];
  return parts.filter(Boolean).join(" ");
}

/**
 * Un nom complet stocké d'un seul tenant (`profiles.full_name`) : le premier mot
 * est lu comme le prénom, le reste comme le nom de famille. À n'utiliser que
 * faute de prénom et de nom séparés.
 */
export function formatStoredFullName(value: string | null | undefined): string {
  if (!value) return value ?? "";
  const tokens = value.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return "";
  if (tokens.length === 1) return formatFirstName(tokens[0]);
  return formatPersonName(tokens[0], tokens.slice(1).join(" "));
}

/**
 * Des saisies réelles et leur affichage attendu : minuscules, capitales, casse
 * mêlée, prénoms composés, particules, accents, apostrophes. C'est sur cette
 * liste que la plateforme vérifie que ses fonctions SQL composent les noms
 * comme ce module.
 */
export const EXEMPLES_DE_NOMS: ReadonlyArray<{
  prenom: string;
  nom: string;
  prenomAffiche: string;
  nomAffiche: string;
}> = [
  { prenom: "jean", nom: "dupont", prenomAffiche: "Jean", nomAffiche: "DUPONT" },
  { prenom: "JEAN", nom: "DUPONT", prenomAffiche: "Jean", nomAffiche: "DUPONT" },
  { prenom: "Marie", nom: "Martin", prenomAffiche: "Marie", nomAffiche: "MARTIN" },
  { prenom: "jEAN-pIERRE", nom: "le Goff", prenomAffiche: "Jean-Pierre", nomAffiche: "LE GOFF" },
  {
    prenom: "marie claire",
    nom: "de la Fontaine",
    prenomAffiche: "Marie Claire",
    nomAffiche: "DE LA FONTAINE",
  },
  { prenom: "ÉMILE", nom: "bénichou", prenomAffiche: "Émile", nomAffiche: "BÉNICHOU" },
  { prenom: "éloïse", nom: "N'Diaye", prenomAffiche: "Éloïse", nomAffiche: "N'DIAYE" },
  { prenom: "d'artagnan", nom: "o’neil", prenomAffiche: "D'Artagnan", nomAffiche: "O’NEIL" },
  { prenom: "n’golo", nom: "kanté", prenomAffiche: "N’Golo", nomAffiche: "KANTÉ" },
  { prenom: "MARIE-JOSÉ", nom: "lê", prenomAffiche: "Marie-José", nomAffiche: "LÊ" },
  { prenom: "chloé", nom: "Çelik", prenomAffiche: "Chloé", nomAffiche: "ÇELIK" },
];

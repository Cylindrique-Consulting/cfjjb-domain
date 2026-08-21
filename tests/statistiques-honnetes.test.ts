import { describe, expect, it } from "vitest";
import { SUBMISSION_TYPES } from "../src/fight-stats";

/**
 * VERROU STRUCTUREL : ON N'ÉTIQUETTE PAS UN POINT PAR UNE TECHNIQUE.
 *
 * Le journal de scoring enregistre des VALEURS, pas des gestes. `+3` est un
 * passage de garde, et c'est sûr. Mais `+2` est un renversement OU une amenée au
 * sol OU un genou-ventre : trois gestes différents, une seule valeur.
 *
 * Une statistique intitulée « balayages » construite sur les `+2` est donc fausse
 * pour une part INCONNUE de ses lignes, et personne ne peut dire laquelle. C'est
 * le pire type d'erreur que ce projet puisse produire : un chiffre plausible,
 * affiché avec autorité, qu'aucune relecture ne peut infirmer sans remonter à
 * chaque combat.
 *
 * ┌─ POURQUOI CE VERROU EST ICI ALORS QUE LA PLATEFORME EN A DÉJÀ UN ──────────┐
 * │ `cfjjb-platform/tests/unit/statistiques-honnetes.test.ts` balaie `app`,     │
 * │ `lib` et `components`. Ce package est consommé depuis `node_modules`        │
 * │ (`github:…#tag`) : il ne se trouve dans AUCUN des trois. Le verrou de la    │
 * │ plateforme ne l'a donc jamais lu, et ne le lira jamais.                     │
 * │                                                                            │
 * │ Or c'est ici que vivent les agrégations. Un interdit écrit dans un docblock │
 * │ n'est pas un interdit vérifié — même leçon que `Math.random`, proscrit par  │
 * │ trois commentaires et par aucune vérification jusqu'à ce qu'une passe de    │
 * │ mutation le glisse dans la composition des équipes.                        │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * Ce que ce verrou attrape : l'association, dans un même fichier, d'un libellé de
 * technique et d'une agrégation sur les points. Il ne prouve pas l'intention,
 * mais il oblige à écrire une exemption NOMMÉE, donc à réfléchir une fois.
 *
 * Ce qu'il ne remplace pas : `submissionType`, seul endroit où une technique est
 * enregistrée — parce qu'elle a été OBSERVÉE.
 */

declare global {
  interface ImportMeta {
    /**
     * Déclaré à la main : Vite remplace `import.meta.glob` à la transformation,
     * et ses types vivent dans `vite/client`, que ce package ne charge pas. Lire
     * la source par `node:fs` serait plus simple et est INTERDIT ici — la règle
     * `no-restricted-imports` d'un noyau pur ne connaît pas d'exception pour les
     * tests, et c'est très bien ainsi.
     */
    glob(
      pattern: string,
      options: { readonly query: "?raw"; readonly import: "default"; readonly eager: true },
    ): Record<string, string>;
  }
}

const SOURCES = import.meta.glob("../src/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
});

/** Les libellés qui nomment un GESTE, et qu'aucun calcul sur les points ne connaît. */
const TECHNIQUES = [
  "balayage",
  "balayages",
  "renversement",
  "renversements",
  "takedown",
  "takedowns",
  "amenée au sol",
  "genou-ventre",
  "genou ventre",
  "knee-on-belly",
] as const;

/** Ce qui trahit une agrégation sur la VALEUR des points. */
const AGREGATIONS = [
  "pointsMarques",
  "pointsEncaisses",
  "pointsA",
  "pointsB",
  "pointsFor",
  "pointsAgainst",
  '"points"',
] as const;

/**
 * Exemptions NOMMÉES, une par une, avec leur raison. Jamais un motif de chemin :
 * un motif finit toujours par couvrir un fichier qu'on n'avait pas en tête.
 */
const EXEMPTES: ReadonlyArray<readonly [string, string]> = [];

/**
 * On retire les commentaires : expliquer POURQUOI un `+2` n'est pas un balayage
 * est exactement ce qu'on veut encourager, et ce verrou ne doit pas punir la
 * prose qui le dit. Ce fichier-ci en est la preuve vivante.
 */
function sansCommentaires(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Le croisement fautif, nommé, ou `null`. Exporté au test pour être MUTÉ. */
function croisementFautif(source: string): string | null {
  const code = sansCommentaires(source);
  const technique = TECHNIQUES.find((t) =>
    new RegExp(`\\b${t.replace(/[-\s]/g, "[-\\s]")}\\b`, "i").test(code),
  );
  if (!technique) return null;
  const agregation = AGREGATIONS.find((a) => code.includes(a));
  if (!agregation) return null;
  return `« ${technique} » à côté de ${agregation}`;
}

const nomDe = (chemin: string): string => chemin.replace(/^\.\.\//, "");

describe("aucune statistique ne nomme une technique qu'elle n'a pas observée", () => {
  const fichiers = Object.keys(SOURCES).map(nomDe);

  it("balaie bien des fichiers, et leur contenu (le test ne doit pas passer à vide)", () => {
    // Sans cette garde, un renommage de dossier ou un `?raw` qui cesse de rendre
    // la source viderait le balayage, et le verrou deviendrait un décor qui
    // passe toujours.
    expect(fichiers.length).toBeGreaterThan(15);
    expect(fichiers).toContain("src/fight-stats.ts");
    const source = SOURCES["../src/fight-stats.ts"] ?? "";
    expect(source.length).toBeGreaterThan(1000);
    expect(source).toContain("aDesCombats");
  });

  it("le détecteur voit réellement le croisement qu'il prétend interdire", () => {
    // Un scan qui ne peut rien voir donne une garantie fausse : on le mute ici,
    // une fois, plutôt que de croire ses zéros.
    expect(croisementFautif("const balayages = pointsMarques;")).toBe(
      "« balayages » à côté de pointsMarques",
    );
    expect(croisementFautif("const takedowns = tally(pointsA);")).toContain("takedown");
    expect(croisementFautif('const t = { "genou ventre": agrege("points") };')).toContain("genou");
    // Une technique SEULE ne suffit pas : `submissionType` en nomme, légitimement.
    expect(croisementFautif("const balayages = [];")).toBeNull();
    // Une agrégation SEULE non plus : c'est le métier de ce module.
    expect(croisementFautif("const total = pointsMarques + pointsEncaisses;")).toBeNull();
    // …et la PROSE qui explique la règle reste libre.
    expect(croisementFautif("// un +2 n'est pas un balayage\nconst t = pointsMarques;")).toBeNull();
    expect(
      croisementFautif("/* un +2 est un renversement ou une amenée au sol */\nconst p = pointsA;"),
    ).toBeNull();
  });

  it("aucun fichier ne croise un libellé de technique avec une agrégation de points", () => {
    const exemptes = new Set(EXEMPTES.map(([f]) => f));
    const fautifs: string[] = [];

    for (const [chemin, source] of Object.entries(SOURCES)) {
      const nom = nomDe(chemin);
      if (exemptes.has(nom)) continue;
      const croisement = croisementFautif(source);
      if (croisement) fautifs.push(`${nom} (${croisement})`);
    }

    expect(
      fautifs,
      "Ces fichiers nomment une TECHNIQUE à côté d'une agrégation de POINTS :\n" +
        fautifs.map((x) => "  " + x).join("\n") +
        "\n\nUn « +2 » est un renversement OU une amenée au sol OU un genou-ventre. " +
        "Une statistique qui l'appelle « balayages » est fausse pour une part inconnue " +
        "de ses lignes, et personne ne peut dire laquelle. Utilisez la VALEUR " +
        "(« points à +2 »), ou inscrivez une exemption NOMMÉE avec sa raison dans EXEMPTES.",
    ).toEqual([]);
  });

  it("les exemptions désignent des fichiers qui existent", () => {
    // Une exemption périmée est une couverture silencieusement retirée : le
    // fichier a été renommé, et le nouveau n'est plus contrôlé.
    for (const [f] of EXEMPTES) {
      expect(fichiers, `exemption périmée : ${f} n'existe plus`).toContain(f);
    }
  });

  it("le type de soumission reste BORNÉ, et miroir de la contrainte de base", () => {
    // La seule technique enregistrée est celle qu'on a OBSERVÉE, et elle est
    // bornée : une saisie libre compterait « armbar », « clé de bras » et « juji
    // gatame » comme trois techniques différentes dans un classement.
    //
    // Miroir de `competition_fight_states_submission_type_check`, migration
    // `20261019000002_type_de_soumission.sql`. La base n'est pas lisible d'ici :
    // ce test gèle la liste, celui de la plateforme gèle la contrainte SQL, et
    // c'est chez elle que leur identité peut être prouvée.
    expect([...SUBMISSION_TYPES]).toEqual([
      "armbar",
      "triangle",
      "rear_naked_choke",
      "guillotine",
      "kimura",
      "americana",
      "omoplata",
      "bow_and_arrow",
      "cross_collar",
      "ezekiel",
      "arm_triangle",
      "north_south",
      "footlock",
      "kneebar",
      "toe_hold",
      "heel_hook",
      "other",
    ]);
  });
});

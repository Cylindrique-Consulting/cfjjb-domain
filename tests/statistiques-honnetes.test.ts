import { describe, expect, it } from "vitest";
import { SUBMISSION_TYPES } from "../src/fight-stats";

declare global {
  interface ImportMeta {
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

const AGREGATIONS = [
  "pointsMarques",
  "pointsEncaisses",
  "pointsA",
  "pointsB",
  "pointsFor",
  "pointsAgainst",
  '"points"',
] as const;

const EXEMPTES: ReadonlyArray<readonly [string, string]> = [];

function sansCommentaires(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

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
    expect(fichiers.length).toBeGreaterThan(15);
    expect(fichiers).toContain("src/fight-stats.ts");
    const source = SOURCES["../src/fight-stats.ts"] ?? "";
    expect(source.length).toBeGreaterThan(1000);
    expect(source).toContain("aDesCombats");
  });

  it("le détecteur voit réellement le croisement qu'il prétend interdire", () => {
    expect(croisementFautif("const balayages = pointsMarques;")).toBe(
      "« balayages » à côté de pointsMarques",
    );
    expect(croisementFautif("const takedowns = tally(pointsA);")).toContain("takedown");
    expect(croisementFautif('const t = { "genou ventre": agrege("points") };')).toContain("genou");
    expect(croisementFautif("const balayages = [];")).toBeNull();
    expect(croisementFautif("const total = pointsMarques + pointsEncaisses;")).toBeNull();
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
    for (const [f] of EXEMPTES) {
      expect(fichiers, `exemption périmée : ${f} n'existe plus`).toContain(f);
    }
  });

  it("le type de soumission reste BORNÉ, et miroir de la contrainte de base", () => {
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

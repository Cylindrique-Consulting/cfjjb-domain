import { describe, expect, it } from "vitest";
import * as domaine from "../src/index";
import { aDisputeLeCombat, finDeReposDeLAthlete } from "../src/fight-rest";
import { pointsDeResultat, saisonSportive } from "../src/points";
import { divisionMaxDuTableau, nomDuTour } from "../src/round-names";
import { REGLES_FIN_SANS_VAINQUEUR } from "../src/arbitrage";
import { classementOfficiel, estTermineeSansMedaille } from "../src/podium-officiel";

// ===================================================================
// UN MODULE AJOUTÉ DOIT ÊTRE VISIBLE DES CONSOMMATEURS.
//
// Le README le demande (« exporté par `src/index.ts` ET par la carte `exports`
// du `package.json` : sans les deux, un consommateur ne le voit pas ») et rien
// ne le vérifiait. Un oubli ne casse aucun test de ce dépôt : il casse
// l'import `@cfjjb/domain/round-names` du module et de la plateforme, après
// le tag, c'est-à-dire trop tard.
// ===================================================================

const SOURCES = import.meta.glob("../src/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
});
const MANIFESTE = import.meta.glob("../package.json", {
  query: "?raw",
  import: "default",
  eager: true,
});

describe("la carte des exports", () => {
  const modules = Object.keys(SOURCES)
    .map((chemin) => chemin.replace("../src/", "").replace(/\.ts$/, ""))
    .filter((m) => m !== "index");
  const index = SOURCES["../src/index.ts"] ?? "";
  const manifeste = JSON.parse(MANIFESTE["../package.json"] ?? "{}") as {
    exports?: Record<string, string>;
  };

  it("lit bien des modules (sentinelle anti-vacuité)", () => {
    expect(modules).toContain("round-names");
    expect(modules).toContain("fight-rest");
    expect(modules.length).toBeGreaterThan(20);
  });

  it("chaque module est ré-exporté par src/index.ts", () => {
    const absents = modules.filter((m) => !index.includes(`export * from "./${m}";`));
    expect(absents).toEqual([]);
  });

  it("chaque module a son entrée dans la carte `exports` du package.json", () => {
    const absents = modules.filter((m) => manifeste.exports?.[`./${m}`] !== `./src/${m}.ts`);
    expect(absents).toEqual([]);
  });

  it("les modules de la release A sont joignables depuis la racine", () => {
    expect(domaine.nomDuTour).toBe(nomDuTour);
    expect(domaine.divisionMaxDuTableau).toBe(divisionMaxDuTableau);
    expect(domaine.aDisputeLeCombat).toBe(aDisputeLeCombat);
    expect(domaine.finDeReposDeLAthlete).toBe(finDeReposDeLAthlete);
  });

  it("pointsDeResultat et saisonSportive (v0.16.0) sont joignables depuis la racine", () => {
    expect(domaine.pointsDeResultat).toBe(pointsDeResultat);
    expect(domaine.saisonSportive).toBe(saisonSportive);
  });

  it("les modules de la release B sont joignables depuis la racine et par leur entrée (v0.17.0)", () => {
    expect(modules).toContain("podium-officiel");
    expect(modules).toContain("arbitrage");
    expect(domaine.classementOfficiel).toBe(classementOfficiel);
    expect(domaine.estTermineeSansMedaille).toBe(estTermineeSansMedaille);
    expect(domaine.REGLES_FIN_SANS_VAINQUEUR).toBe(REGLES_FIN_SANS_VAINQUEUR);
    expect(manifeste.exports?.["./podium-officiel"]).toBe("./src/podium-officiel.ts");
    expect(manifeste.exports?.["./arbitrage"]).toBe("./src/arbitrage.ts");
    // `computePodium` est retiré (rupture assumée en 0.x) : un consommateur qui
    // l'importerait encore doit échouer à la compilation, pas lire `undefined`.
    expect("computePodium" in domaine).toBe(false);
  });
});

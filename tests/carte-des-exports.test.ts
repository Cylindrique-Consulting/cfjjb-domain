import { describe, expect, it } from "vitest";
import * as domaine from "../src/index";
import { aDisputeLeCombat, finDeReposDeLAthlete } from "../src/fight-rest";
import { pointsDeResultat, saisonSportive } from "../src/points";
import { divisionMaxDuTableau, nomDuTour } from "../src/round-names";
import { REGLES_FIN_SANS_VAINQUEUR } from "../src/arbitrage";
import { classementOfficiel, estTermineeSansMedaille } from "../src/podium-officiel";
import {
  SCENARIOS_FIN_DE_REPOS,
  SCENARIOS_PLACEMENT_APRES_REPOS,
  etatDuRepos,
  rangApresRepos,
  reposDuCombat,
} from "../src/repos-jour-j";
import { couleurDEcart, estimerLesHoraires } from "../src/estimateur-horaires";
import {
  DELAI_INSCRIPTION_ABSOLUT_MINUTES,
  etatInscriptionsAbsolut,
  tapisDuCombatAbsolut,
} from "../src/absolut-regles";

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
    expect("computePodium" in domaine).toBe(false);
  });

  it("le repos du jour J est joignable depuis la racine et par son entrée (v0.18.0)", () => {
    expect(modules).toContain("repos-jour-j");
    expect(domaine.etatDuRepos).toBe(etatDuRepos);
    expect(domaine.reposDuCombat).toBe(reposDuCombat);
    expect(domaine.rangApresRepos).toBe(rangApresRepos);
    expect(domaine.SCENARIOS_FIN_DE_REPOS).toBe(SCENARIOS_FIN_DE_REPOS);
    expect(domaine.SCENARIOS_PLACEMENT_APRES_REPOS).toBe(SCENARIOS_PLACEMENT_APRES_REPOS);
    expect(manifeste.exports?.["./repos-jour-j"]).toBe("./src/repos-jour-j.ts");
  });

  it("l'estimateur des heures (v0.19.0) est joignable depuis la racine et par son entrée", () => {
    expect(modules).toContain("estimateur-horaires");
    expect(domaine.estimerLesHoraires).toBe(estimerLesHoraires);
    expect(domaine.couleurDEcart).toBe(couleurDEcart);
    expect(manifeste.exports?.["./estimateur-horaires"]).toBe("./src/estimateur-horaires.ts");
  });

  it("les règles de l'absolut sont joignables depuis la racine et par leur entrée (v0.20.0)", () => {
    expect(modules).toContain("absolut-regles");
    expect(domaine.DELAI_INSCRIPTION_ABSOLUT_MINUTES).toBe(DELAI_INSCRIPTION_ABSOLUT_MINUTES);
    expect(domaine.etatInscriptionsAbsolut).toBe(etatInscriptionsAbsolut);
    expect(domaine.tapisDuCombatAbsolut).toBe(tapisDuCombatAbsolut);
    expect(manifeste.exports?.["./absolut-regles"]).toBe("./src/absolut-regles.ts");
  });
});

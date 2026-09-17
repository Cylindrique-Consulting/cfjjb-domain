import { describe, expect, it } from "vitest";
import { finDeReposDeLAthlete, multiplicateurDeRepos } from "../src/fight-rest";
import {
  ORIGINE_DES_SCENARIOS_DE_REPOS_MS,
  SCENARIOS_FIN_DE_REPOS,
  SCENARIOS_PLACEMENT_APRES_REPOS,
  combatsPassesDuScenario,
  etatDuRepos,
  finDeReposDuScenario,
  finReelleDuCombatDispute,
  rangApresRepos,
  reposDuCombat,
  type CombatDeLaFileDuRepos,
} from "../src/repos-jour-j";

// ===================================================================
// LE REPOS LE JOUR J : ALERTE AU LANCEMENT ET PLACEMENT DU COMBAT SUIVANT.
//
// Aucune règle nouvelle : la règle reste `fight-rest.ts`. Ces tests fixent la
// présentation (état du repos, une seule alerte par combat) et le placement
// (rang après le repos), que la plateforme rejoue en SQL.
// ===================================================================

const MINUTE = 60_000;
const T0 = ORIGINE_DES_SCENARIOS_DE_REPOS_MS;

describe("la fin réelle d'un combat", () => {
  it("l'arrêt du chrono fait foi, la fin enregistrée sert de repli", () => {
    expect(finReelleDuCombatDispute(T0, T0 + 4_000)).toBe(T0);
    expect(finReelleDuCombatDispute(null, T0 + 4_000)).toBe(T0 + 4_000);
    expect(finReelleDuCombatDispute(null, null)).toBeNull();
  });
});

describe("l'état d'un repos", () => {
  it("requis, écoulé et restant", () => {
    expect(
      etatDuRepos({
        finPrecedenteMs: T0,
        finDeReposMs: T0 + 10 * MINUTE,
        maintenantMs: T0 + 3 * MINUTE,
      }),
    ).toEqual({
      enRepos: true,
      requisMs: 10 * MINUTE,
      ecouleMs: 3 * MINUTE,
      restantMs: 7 * MINUTE,
    });
  });

  it("à l'échéance exacte, le repos est terminé", () => {
    const etat = etatDuRepos({
      finPrecedenteMs: T0,
      finDeReposMs: T0 + 5 * MINUTE,
      maintenantMs: T0 + 5 * MINUTE,
    });
    expect(etat.enRepos).toBe(false);
    expect(etat.restantMs).toBe(0);
  });

  it("jamais de valeur négative (horloge en retard, repos dépassé)", () => {
    const avant = etatDuRepos({
      finPrecedenteMs: T0,
      finDeReposMs: T0 + 5 * MINUTE,
      maintenantMs: T0 - MINUTE,
    });
    expect(avant.ecouleMs).toBe(0);
    const apres = etatDuRepos({
      finPrecedenteMs: T0,
      finDeReposMs: T0 + 5 * MINUTE,
      maintenantMs: T0 + 9 * MINUTE,
    });
    expect(apres.restantMs).toBe(0);
    expect(apres.ecouleMs).toBe(9 * MINUTE);
  });
});

describe("une seule alerte par combat", () => {
  it("deux athlètes en repos : une alerte, la fin la plus tardive", () => {
    const repos = reposDuCombat(
      [
        { cote: "b", finPrecedenteMs: T0, finDeReposMs: T0 + 10 * MINUTE },
        { cote: "a", finPrecedenteMs: T0, finDeReposMs: T0 + 5 * MINUTE },
      ],
      T0 + MINUTE,
    );
    expect(repos?.finDeReposMs).toBe(T0 + 10 * MINUTE);
    expect(repos?.cotes.map((c) => c.cote)).toEqual(["a", "b"]);
  });

  it("un côté au repos échu disparaît de l'alerte", () => {
    const repos = reposDuCombat(
      [
        { cote: "a", finPrecedenteMs: T0, finDeReposMs: T0 + 2 * MINUTE },
        { cote: "b", finPrecedenteMs: T0, finDeReposMs: T0 + 10 * MINUTE },
      ],
      T0 + 2 * MINUTE,
    );
    expect(repos?.cotes.map((c) => c.cote)).toEqual(["b"]);
  });

  it("aucun athlète en repos : aucune alerte", () => {
    expect(reposDuCombat([], T0)).toBeNull();
    expect(
      reposDuCombat([{ cote: "a", finPrecedenteMs: T0, finDeReposMs: T0 + MINUTE }], T0 + MINUTE),
    ).toBeNull();
  });
});

describe("le rang après le repos", () => {
  const prets = (n: number, duree = 300): CombatDeLaFileDuRepos[] =>
    Array.from({ length: n }, (_, i) => ({ fightId: `c${i}`, dureeSecondes: duree, compte: true }));

  it("sans repos ou repos échu, le rang ne change pas", () => {
    const base = { file: prets(3), rangActuel: 1, maintenantMs: T0, rangMax: 3 };
    expect(rangApresRepos({ ...base, finDuReposMs: null })).toBe(1);
    expect(rangApresRepos({ ...base, finDuReposMs: T0 })).toBe(1);
    expect(rangApresRepos({ ...base, finDuReposMs: T0 - MINUTE })).toBe(1);
  });

  it("jamais vers l'avant, même quand le plafond est sous le rang actuel", () => {
    // Un plafond incohérent (sous le rang actuel) ne fait pas avancer le combat.
    expect(
      rangApresRepos({
        file: prets(4),
        rangActuel: 3,
        maintenantMs: T0,
        finDuReposMs: T0 + 60 * MINUTE,
        rangMax: 1,
      }),
    ).toBe(3);
  });

  it("recule derrière les combats prêts jusqu'à ce que le début estimé atteigne la fin du repos", () => {
    const entree = {
      file: prets(5),
      rangActuel: 0,
      maintenantMs: T0,
      rangMax: 5,
    };
    expect(rangApresRepos({ ...entree, finDuReposMs: T0 + 1 })).toBe(1);
    expect(rangApresRepos({ ...entree, finDuReposMs: T0 + 5 * MINUTE })).toBe(1);
    expect(rangApresRepos({ ...entree, finDuReposMs: T0 + 5 * MINUTE + 1 })).toBe(2);
    expect(rangApresRepos({ ...entree, finDuReposMs: T0 + 15 * MINUTE })).toBe(3);
  });

  it("ne franchit pas un combat qui n'est pas prêt", () => {
    const file = prets(3);
    file[1] = { fightId: "pas-pret", dureeSecondes: 300, compte: false };
    expect(
      rangApresRepos({
        file,
        rangActuel: 0,
        maintenantMs: T0,
        finDuReposMs: T0 + 60 * MINUTE,
        rangMax: 3,
      }),
    ).toBe(1);
  });

  it("plafonné par le combat qui attend son résultat et par la fin de file", () => {
    const entree = {
      file: prets(4),
      rangActuel: 0,
      maintenantMs: T0,
      finDuReposMs: T0 + 99 * MINUTE,
    };
    expect(rangApresRepos({ ...entree, rangMax: 2 })).toBe(2);
    expect(rangApresRepos({ ...entree, rangMax: 40 })).toBe(4);
  });
});

describe("les scénarios exportés", () => {
  it("chaque scénario de fin de repos rend son attendu par la règle du domaine", () => {
    expect(SCENARIOS_FIN_DE_REPOS.length).toBeGreaterThanOrEqual(12);
    for (const s of SCENARIOS_FIN_DE_REPOS) {
      expect(finDeReposDuScenario(s), s.id).toBe(s.attendu);
      expect(finDeReposDeLAthlete(combatsPassesDuScenario(s), s.combatAVenir), s.id).toBe(
        s.attendu,
      );
    }
  });

  it("la fin précédente retenue est cohérente avec l'attendu", () => {
    for (const s of SCENARIOS_FIN_DE_REPOS) {
      if (s.attendu === null) {
        expect(s.finPrecedenteAttendueMs, s.id).toBeNull();
        continue;
      }
      expect(s.finPrecedenteAttendueMs, s.id).not.toBeNull();
      expect(
        (s.finPrecedenteAttendueMs ?? 0) +
          multiplicateurDeRepos(s.combatAVenir) * s.combatAVenir.dureeSecondes * 1000,
        s.id,
      ).toBe(s.attendu);
    }
  });

  it("les scénarios couvrent les cas de la règle (identifiants stables)", () => {
    const ids = SCENARIOS_FIN_DE_REPOS.map((s) => s.id);
    for (const attendu of [
      "simple",
      "double_avant_finale",
      "deuxieme_demie_tableau_de_trois",
      "wo_sans_repos",
      "bye_sans_repos",
      "lance_puis_forfait",
      "double_dq_disputee",
      "double_blessure_disputee",
      "designation_sans_repos",
      "dernier_combat_seul",
    ]) {
      expect(ids).toContain(attendu);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("chaque scénario de placement rend son attendu", () => {
    expect(SCENARIOS_PLACEMENT_APRES_REPOS.length).toBeGreaterThanOrEqual(8);
    const ids = new Set<string>();
    for (const s of SCENARIOS_PLACEMENT_APRES_REPOS) {
      ids.add(s.id);
      expect(rangApresRepos(s), s.id).toBe(s.attendu);
      expect(s.attendu, s.id).toBeGreaterThanOrEqual(Math.min(s.rangActuel, s.file.length));
    }
    expect(ids.size).toBe(SCENARIOS_PLACEMENT_APRES_REPOS.length);
  });
});

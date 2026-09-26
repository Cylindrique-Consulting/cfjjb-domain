import { describe, expect, it } from "vitest";
import {
  ABSOLUT_RANG_SPORTIF_SEEDING_PLAN,
  absolutSeedOrder,
  generateAbsolutBracket,
  type AbsolutRegistration,
} from "../src/absolut-seeding";
import { generateBracket, type BracketEntry, type GeneratedFight } from "../src/bracket-generator";
import { fnv1a, mulberry32 } from "../src/prng";
import {
  colonnesDeLaLegende,
  critereAMentionner,
  critereQuiDepartage,
  figerLePlacement,
  LIBELLES_CRITERE_DE_DEPARTAGE,
  placementPourLaBase,
  placerLesInscrits,
  RANG_SPORTIF_SEEDING_PLAN,
  resultatPourPlacementDepuisLaBase,
  type LigneResultatDeLaBase,
} from "../src/placement-par-rang";
import {
  ordonnerPourTableau,
  scoreDePlacement,
  type CibleDePlacement,
  type ResultatPourPlacement,
} from "../src/score-de-placement";
import { applySeedingPlan, describeSeedingPlan, seedPositions } from "../src/seeding-plan";
import { SQUAD_SEEDING_PLAN } from "../src/squad-composition";

const SANS_TIRAGE = (): number => {
  throw new Error("le placement par rang ne consomme aucun tirage");
};

function tailleDe(n: number): number {
  return 2 ** Math.ceil(Math.log2(Math.max(2, n)));
}

function athlete(rang: number, equipe: string | null = null): BracketEntry {
  return { registrationId: `r${rang}`, clubId: `club-${rang}`, teamId: equipe, rank: rang };
}

function placer(entries: BracketEntry[]) {
  return applySeedingPlan(
    entries,
    tailleDe(entries.length),
    SANS_TIRAGE,
    RANG_SPORTIF_SEEDING_PLAN,
  );
}

function ids(feuilles: readonly (BracketEntry | null)[]): (string | null)[] {
  return feuilles.map((f) => f?.registrationId ?? null);
}

function titulairesDeBye(feuilles: readonly (BracketEntry | null)[]): string[] {
  const out: string[] = [];
  for (let f = 0; 2 * f + 1 < feuilles.length; f++) {
    const a = feuilles[2 * f] ?? null;
    const b = feuilles[2 * f + 1] ?? null;
    if (a === null && b !== null) out.push(b.registrationId);
    if (b === null && a !== null) out.push(a.registrationId);
  }
  return out.sort();
}

function moitieDe(feuilles: readonly (BracketEntry | null)[], registrationId: string): number {
  const i = feuilles.findIndex((f) => f?.registrationId === registrationId);
  return i < feuilles.length / 2 ? 0 : 1;
}

function rencontresInternes(feuilles: readonly (BracketEntry | null)[]): number {
  let n = 0;
  for (let f = 0; 2 * f + 1 < feuilles.length; f++) {
    const a = feuilles[2 * f] ?? null;
    const b = feuilles[2 * f + 1] ?? null;
    if (a && b && a.teamId && a.teamId === b.teamId) n += 1;
  }
  return n;
}

describe("placement par rang : l'ordre des graines suit le rang sportif", () => {
  it("les graines se rangent par rang, quel que soit l'ordre de lecture", () => {
    const entries = [athlete(3), athlete(1), athlete(4), athlete(2)];
    expect(placer(entries).seedOrder.map((e) => e.registrationId)).toEqual([
      "r1",
      "r2",
      "r3",
      "r4",
    ]);
  });

  it("une inscription sans rang passe en dernier, et cela SE DIT", () => {
    const sans: BracketEntry = { registrationId: "x", clubId: null };
    const sorti = placer([sans, athlete(2), athlete(1)]);
    expect(sorti.seedOrder.map((e) => e.registrationId)).toEqual(["r1", "r2", "x"]);
    expect(sorti.warnings).toEqual([{ code: "rang-sportif-manquant", sansRang: 1 }]);
  });

  it("aucun tirage n'est consommé : deux graines de compétition rendent le même tableau", () => {
    const entries = Array.from({ length: 11 }, (_, i) => athlete(i + 1, i % 3 === 0 ? "T" : null));
    const un = generateBracket(entries, "graine-1", {
      thirdPlaceMode: "pool3",
      seedingPlan: RANG_SPORTIF_SEEDING_PLAN,
    });
    const deux = generateBracket(entries, "graine-2", {
      thirdPlaceMode: "pool3",
      seedingPlan: RANG_SPORTIF_SEEDING_PLAN,
    });
    expect(un).toEqual(deux);
  });
});

describe("placement par rang : la disposition standard", () => {
  it("#1 rencontre le dernier au premier tour, #1 et #2 sont dans deux moitiés", () => {
    const sorti = placer(Array.from({ length: 8 }, (_, i) => athlete(i + 1)));
    expect(ids(sorti.leaves)).toEqual(["r1", "r8", "r4", "r5", "r2", "r7", "r3", "r6"]);
    expect(moitieDe(sorti.leaves, "r1")).not.toBe(moitieDe(sorti.leaves, "r2"));
  });

  it("de 2 à 40 inscrits : les byes vont aux mieux classés et #1 / #2 restent opposés", () => {
    for (let n = 2; n <= 40; n++) {
      const sorti = placer(Array.from({ length: n }, (_, i) => athlete(i + 1)));
      const byes = tailleDe(n) - n;
      const attendus = Array.from({ length: byes }, (_, i) => `r${i + 1}`).sort();
      expect(titulairesDeBye(sorti.leaves), `n = ${n}`).toEqual(attendus);
      if (n >= 3) {
        expect(moitieDe(sorti.leaves, "r1"), `n = ${n}`).not.toBe(moitieDe(sorti.leaves, "r2"));
      }
      expect(sorti.leaves, `n = ${n}`).toEqual(sorti.placement);
    }
  });

  it("la disposition est celle de seedPositions, sans réparation quand personne n'est coéquipier", () => {
    const n = 16;
    const sorti = placer(Array.from({ length: n }, (_, i) => athlete(i + 1)));
    expect(ids(sorti.leaves)).toEqual(seedPositions(16).map((s) => `r${s}`));
    expect(sorti.echanges).toEqual([]);
  });
});

describe("placement par rang : deux coéquipiers au premier tour (BR3.6, proposition B)", () => {
  it("le moins bien classé des deux est échangé avec le rang le plus proche ; à écart égal, celui qui les sépare aussi de moitié", () => {
    // #3 contre #6 au premier tour : #6 part. #5 et #7 sont à un rang ; #7 laisserait #6 dans la
    // moitié de #3, que le guide v1.3 (§5) interdit : #5 prend sa place, en un seul échange.
    const entries = Array.from({ length: 8 }, (_, i) =>
      athlete(i + 1, i + 1 === 3 || i + 1 === 6 ? "T" : null),
    );
    const sorti = placer(entries);
    expect(ids(sorti.placement)).toEqual(["r1", "r8", "r4", "r5", "r2", "r7", "r3", "r6"]);
    expect(ids(sorti.leaves)).toEqual(["r1", "r8", "r4", "r6", "r2", "r7", "r3", "r5"]);
    expect(sorti.echanges).toEqual([
      { deplace: "r6", avec: "r5", contrainte: "meme-equipe-premier-tour" },
    ]);
    expect(rencontresInternes(sorti.leaves)).toBe(0);
    expect(moitieDe(sorti.leaves, "r3")).not.toBe(moitieDe(sorti.leaves, "r6"));
  });

  it("à défaut du voisin moins bien classé, le voisin mieux classé", () => {
    // #3 et #6 coéquipiers, #7 aussi : #7 rencontrerait #3. #5 prend la place de #6.
    const entries = Array.from({ length: 8 }, (_, i) =>
      athlete(i + 1, [3, 6, 7].includes(i + 1) ? "T" : null),
    );
    const sorti = placer(entries);
    expect(sorti.echanges[0]).toEqual({
      deplace: "r6",
      avec: "r5",
      contrainte: "meme-equipe-premier-tour",
    });
    expect(rencontresInternes(sorti.leaves)).toBe(0);
  });

  it("un bye ne change jamais de main", () => {
    // Six inscrits : #1 et #2 exemptés. #3 contre #6 coéquipiers : #5 (rang le plus proche) prend la place.
    const entries = Array.from({ length: 6 }, (_, i) =>
      athlete(i + 1, i + 1 === 3 || i + 1 === 6 ? "T" : null),
    );
    const sorti = placer(entries);
    expect(titulairesDeBye(sorti.leaves)).toEqual(["r1", "r2"]);
    expect(sorti.echanges).toEqual([
      { deplace: "r6", avec: "r5", contrainte: "meme-equipe-premier-tour" },
    ]);
    expect(rencontresInternes(sorti.leaves)).toBe(0);
  });

  it("à trois, #2 et #3 coéquipiers : #1 affronte #3 et #2 attend la deuxième demi-finale", () => {
    // Guide v1.3, §6 : « Si #2 et #3 appartiennent à la même équipe attribuée, la première
    // demi-finale devient #1 contre #3 et #2 attend la deuxième demi-finale. »
    const sorti = placer([athlete(1), athlete(2, "T"), athlete(3, "T")]);
    expect(ids(sorti.leaves)).toEqual(["r2", null, "r1", "r3"]);
    expect(sorti.echanges).toEqual([
      { deplace: "r2", avec: "r1", contrainte: "meme-equipe-premier-tour" },
    ]);
    expect(titulairesDeBye(sorti.leaves)).toEqual(["r2"]);
  });

  it("à trois, #1 coéquipier de #2 ou de #3 : le format normal #2/#3 est conservé", () => {
    // Guide v1.3, §6 : « Si #1 est coéquipier de #2 ou de #3, le format normal #2/#3 est
    // conservé. » Les trois d'une même équipe aussi : #1 ne peut pas affronter #3.
    for (const equipes of [
      ["T", "T", null],
      ["T", null, "T"],
      ["T", "T", "T"],
    ] as const) {
      const sorti = placer(equipes.map((e, i) => athlete(i + 1, e)));
      expect(sorti.leaves, equipes.join(",")).toEqual(sorti.placement);
      expect(sorti.echanges, equipes.join(",")).toEqual([]);
    }
  });

  it("#1 et #2 restent dans deux moitiés même quand #2 serait le seul voisin possible", () => {
    // Absolut à huit : #4 et #5 du même club. Les voisins #6, #7, #3 et #8 viennent de la même
    // catégorie source que #4 ; #2 serait accepté mais passerait dans la moitié de #1.
    const regs: AbsolutRegistration[] = [
      { registrationId: "r1", clubId: "c1", sourceCategoryId: "U", rank: 1 },
      { registrationId: "r2", clubId: "c2", sourceCategoryId: "V", rank: 2 },
      { registrationId: "r3", clubId: "c3", sourceCategoryId: "S", rank: 3 },
      { registrationId: "r4", clubId: "X", sourceCategoryId: "S", rank: 4 },
      { registrationId: "r5", clubId: "X", sourceCategoryId: "T", rank: 5 },
      { registrationId: "r6", clubId: "c6", sourceCategoryId: "S", rank: 6 },
      { registrationId: "r7", clubId: "c7", sourceCategoryId: "S", rank: 7 },
      { registrationId: "r8", clubId: "c8", sourceCategoryId: "S", rank: 8 },
    ];
    const entries: BracketEntry[] = regs.map((r) => ({
      registrationId: r.registrationId,
      clubId: r.clubId ?? null,
      sourceCategoryId: r.sourceCategoryId ?? null,
      rank: r.rank ?? null,
    }));
    const sorti = applySeedingPlan(entries, 8, SANS_TIRAGE, ABSOLUT_RANG_SPORTIF_SEEDING_PLAN);
    expect(sorti.echanges.map((e) => e.avec)).not.toContain("r2");
    expect(moitieDe(sorti.leaves, "r1")).not.toBe(moitieDe(sorti.leaves, "r2"));
  });

  it("balayage : au plus un tour blanc change de main, jamais celui de #1 ni de #2, #1 / #2 opposés, personne ne disparaît, jamais plus de rencontres internes qu'avant", () => {
    for (let n = 2; n <= 33; n++) {
      for (let graine = 0; graine < 40; graine++) {
        const rng = mulberry32(fnv1a(`balayage|${n}|${graine}`));
        const equipes = ["A", "B", "C", null, null];
        const entries = Array.from({ length: n }, (_, i) =>
          athlete(i + 1, equipes[Math.floor(rng() * equipes.length)] ?? null),
        );
        const sorti = placer(entries);
        const contexte = `n = ${n}, graine ${graine}`;
        // Guide v1.3, §4 : un seul tour blanc réattribué ; #1, puis #2 protégés. À trois, le
        // seul changement permis est le format du §6 : #2 prend le tour blanc de #1.
        const avant = titulairesDeBye(sorti.placement);
        const apres = titulairesDeBye(sorti.leaves);
        expect(apres, contexte).toHaveLength(avant.length);
        expect(apres.filter((r) => !avant.includes(r)).length, contexte).toBeLessThanOrEqual(1);
        if (n >= 4) {
          for (const tete of ["r1", "r2"]) {
            if (avant.includes(tete)) expect(apres, contexte).toContain(tete);
          }
        }
        if (n >= 3) {
          expect(moitieDe(sorti.leaves, "r1"), contexte).not.toBe(moitieDe(sorti.leaves, "r2"));
        }
        expect(ids(sorti.leaves).slice().sort(), contexte).toEqual(
          ids(sorti.placement).slice().sort(),
        );
        expect(rencontresInternes(sorti.leaves), contexte).toBeLessThanOrEqual(
          rencontresInternes(sorti.placement),
        );
        const graines = new Map(sorti.seedOrder.map((e, i) => [e.registrationId, i + 1]));
        for (const e of sorti.echanges) {
          expect(graines.has(e.deplace), contexte).toBe(true);
          expect(graines.has(e.avec), contexte).toBe(true);
        }
      }
    }
  });

  it("le tableau généré porte les échanges, pour le rapport de génération", () => {
    const entries = Array.from({ length: 8 }, (_, i) =>
      athlete(i + 1, i + 1 === 3 || i + 1 === 6 ? "T" : null),
    );
    const tableau = generateBracket(entries, "s", {
      thirdPlaceMode: "pool3",
      seedingPlan: RANG_SPORTIF_SEEDING_PLAN,
    });
    if (tableau.kind !== "bracket") throw new Error("tableau attendu");
    expect(tableau.echanges).toEqual([
      { deplace: "r6", avec: "r5", contrainte: "meme-equipe-premier-tour" },
    ]);
    const premierTour = tableau.fights
      .filter((f: GeneratedFight) => f.division === 3)
      .sort((a, b) => a.indexInDivision - b.indexInDivision);
    expect(premierTour[1]).toMatchObject({ slotA: "r4", slotB: "r6" });
    expect(premierTour[3]).toMatchObject({ slotA: "r3", slotB: "r5" });
  });

  it("le tirage actuel ne porte aucun échange : le plan des sous-équipes n'a pas changé", () => {
    const entries = Array.from({ length: 8 }, (_, i) => ({
      registrationId: `r${i + 1}`,
      clubId: i < 4 ? "A" : "B",
    }));
    const tableau = generateBracket(entries, "s", {
      thirdPlaceMode: "pool3",
      seedingPlan: SQUAD_SEEDING_PLAN,
    });
    if (tableau.kind !== "bracket") throw new Error("tableau attendu");
    expect(tableau.echanges).toBeUndefined();
    expect(SQUAD_SEEDING_PLAN.reparation).toBeUndefined();
  });

  it("le plan se décrit sans lire le code", () => {
    const lignes = describeSeedingPlan(RANG_SPORTIF_SEEDING_PLAN);
    expect(lignes.some((l) => l.includes("rang sportif") && l.includes("actif"))).toBe(true);
    expect(lignes.some((l) => l.includes("au rang voisin"))).toBe(true);
  });
});

describe("placement par rang : l'absolut", () => {
  const regs: AbsolutRegistration[] = [
    { registrationId: "or-leger", sourcePlace: 1, sourceWeightClass: "Galo", rank: 4 },
    { registrationId: "or-lourd", sourcePlace: 1, sourceWeightClass: "Pesado", rank: 3 },
    { registrationId: "argent", sourcePlace: 2, sourceWeightClass: "Leve", rank: 1 },
    { registrationId: "bronze", sourcePlace: 3, sourceWeightClass: "Medio", rank: 2 },
  ];

  it("sans option, l'absolut garde la place obtenue puis la catégorie la plus lourde", () => {
    expect(absolutSeedOrder(regs).map((r) => r.registrationId)).toEqual([
      "or-lourd",
      "or-leger",
      "argent",
      "bronze",
    ]);
    const sansOption = generateAbsolutBracket(regs, "abs", { thirdPlaceMode: "pool3" });
    const placeSource = generateAbsolutBracket(regs, "abs", {
      thirdPlaceMode: "pool3",
      placement: "place-source",
    });
    expect(sansOption).toEqual(placeSource);
  });

  it("en placement par rang, l'absolut suit le rang sportif et non la médaille", () => {
    expect(absolutSeedOrder(regs, "rang-sportif").map((r) => r.registrationId)).toEqual([
      "argent",
      "bronze",
      "or-lourd",
      "or-leger",
    ]);
    const tableau = generateAbsolutBracket(regs, "abs", {
      thirdPlaceMode: "pool3",
      placement: "rang-sportif",
    });
    if (tableau.kind !== "bracket") throw new Error("tableau attendu");
    const demies = tableau.fights
      .filter((f) => f.division === 2 && f.type === "BraketFight")
      .sort((a, b) => a.indexInDivision - b.indexInDivision);
    expect(demies[0]).toMatchObject({ slotA: "argent", slotB: "or-leger" });
    expect(demies[1]).toMatchObject({ slotA: "bronze", slotB: "or-lourd" });
  });

  it("en placement par rang, deux médaillés d'une même catégorie source sont séparés au rang voisin", () => {
    const memeSource: AbsolutRegistration[] = [1, 2, 3, 4].map((rang) => ({
      registrationId: `r${rang}`,
      sourceCategoryId: rang === 2 || rang === 3 ? "leve" : `cat-${rang}`,
      rank: rang,
    }));
    const tableau = generateAbsolutBracket(memeSource, "abs", {
      thirdPlaceMode: "pool3",
      placement: "rang-sportif",
    });
    if (tableau.kind !== "bracket") throw new Error("tableau attendu");
    expect(tableau.echanges).toEqual([
      { deplace: "r3", avec: "r4", contrainte: "meme-categorie-source-premier-tour" },
    ]);
  });

  it("le tableau de trois d'un absolut par rang garde #1 au repêchage", () => {
    const trois = regs.slice(0, 3);
    const tableau = generateAbsolutBracket(trois, "abs", {
      thirdPlaceMode: "pool3",
      placement: "rang-sportif",
    });
    if (tableau.kind !== "bracket") throw new Error("tableau attendu");
    const attente = tableau.fights.find((f) => f.type === "BraketFightRepechage3");
    expect(attente?.slotB).toBe("argent");
  });
});

describe("placement par rang : deux coéquipiers d'un absolut ne se rencontrent qu'en finale", () => {
  // Le cas de la recette du 21/09/2026, « Violette - Adulte - Femme - Absolut » : #1 et #5 de la
  // même équipe (deux clubs différents, l'entité voyage dans `clubId`) et de la même catégorie
  // source, les quatre autres dans une seconde catégorie source. Le placement standard met #5
  // dans la moitié de #1 : elles se retrouvaient en demi-finale.
  const RECETTE: AbsolutRegistration[] = [
    { registrationId: "balcer", clubId: "infinity", sourceCategoryId: "pluma", rank: 1 },
    { registrationId: "moree", clubId: "fayence", sourceCategoryId: "leve", rank: 2 },
    { registrationId: "domergue", clubId: "gap", sourceCategoryId: "leve", rank: 3 },
    { registrationId: "armand", clubId: "phoenix", sourceCategoryId: "leve", rank: 4 },
    { registrationId: "cropsal", clubId: "infinity", sourceCategoryId: "pluma", rank: 5 },
    { registrationId: "delaby", clubId: "asc59", sourceCategoryId: "leve", rank: 6 },
  ];

  function placerLAbsolut(inscrits: readonly AbsolutRegistration[]) {
    const entries: BracketEntry[] = inscrits.map((r) => ({
      registrationId: r.registrationId,
      clubId: r.clubId ?? null,
      sourceCategoryId: r.sourceCategoryId ?? null,
      rank: r.rank ?? null,
    }));
    return applySeedingPlan(
      entries,
      tailleDe(entries.length),
      SANS_TIRAGE,
      ABSOLUT_RANG_SPORTIF_SEEDING_PLAN,
    );
  }

  it("le cas de la recette : #5 passe dans l'autre moitié, échangée avec #6", () => {
    const sorti = placerLAbsolut(RECETTE);
    expect(ids(sorti.placement), "le placement standard, avant réparation").toEqual([
      "balcer",
      null,
      "armand",
      "cropsal",
      "moree",
      null,
      "domergue",
      "delaby",
    ]);
    expect(ids(sorti.leaves)).toEqual([
      "balcer",
      null,
      "armand",
      "delaby",
      "moree",
      null,
      "domergue",
      "cropsal",
    ]);
    expect(moitieDe(sorti.leaves, "balcer")).not.toBe(moitieDe(sorti.leaves, "cropsal"));
    expect(sorti.echanges).toContainEqual({
      deplace: "cropsal",
      avec: "delaby",
      contrainte: "meme-club-meme-moitie",
    });
    expect(titulairesDeBye(sorti.leaves)).toEqual(titulairesDeBye(sorti.placement));
    expect(moitieDe(sorti.leaves, "balcer")).not.toBe(moitieDe(sorti.leaves, "moree"));
  });

  it("à défaut d'un combat voisin, l'exemptée change de moitié avec son exemption", () => {
    // Cinq inscrites, #1, #2 et #3 exemptées, #2 et #3 coéquipières. Seule #1 est exemptée
    // dans l'autre moitié : #3 part avec son combat, et #4 contre #5 prend sa place.
    const cinq = [1, 2, 3, 4, 5].map((rang) => ({
      registrationId: `r${rang}`,
      clubId: rang === 2 || rang === 3 ? "X" : `club-${rang}`,
      rank: rang,
    }));
    const sorti = placerLAbsolut(cinq);
    expect(ids(sorti.placement)).toEqual(["r1", null, "r4", "r5", "r2", null, "r3", null]);
    expect(ids(sorti.leaves)).toEqual(["r1", null, "r3", null, "r2", null, "r4", "r5"]);
    expect(titulairesDeBye(sorti.leaves)).toEqual(["r1", "r2", "r3"]);
    expect(sorti.echanges).toEqual([
      { deplace: "r3", avec: "r4", contrainte: "meme-club-meme-moitie" },
    ]);
  });

  it("trois paires dans une même moitié : toutes séparées, sans qu'aucun tour blanc change de main", () => {
    // Onze inscrits, trois paires (B : #2 et #6, F : #7 et #10, C : #3 et #11). Au premier tour,
    // #10 quitte #7 pour #9, à un rang, qui le laisse aussi hors de la moitié de #7 ; #6 passe
    // dans l'autre moitié avec #8 ; la paire de #11 change de moitié avec le tour blanc de #5.
    const entites = ["A", "B", "C", "D", "E", "B", "F", "G", "H", "F", "C"];
    const onze = entites.map((entite, i) => ({
      registrationId: `r${i + 1}`,
      clubId: entite,
      rank: i + 1,
    }));
    const sorti = placerLAbsolut(onze);
    for (const [x, y] of [
      ["r2", "r6"],
      ["r7", "r10"],
      ["r3", "r11"],
    ] as const) {
      expect(moitieDe(sorti.leaves, x), `${x} et ${y}`).not.toBe(moitieDe(sorti.leaves, y));
    }
    expect(sorti.echanges).toEqual([
      { deplace: "r10", avec: "r9", contrainte: "meme-club-premier-tour" },
      { deplace: "r6", avec: "r8", contrainte: "meme-club-meme-moitie" },
      { deplace: "r8", avec: "r5", contrainte: "meme-club-meme-moitie" },
    ]);
    expect(titulairesDeBye(sorti.leaves)).toEqual(titulairesDeBye(sorti.placement));
  });

  it("à cinq, #4 et #5 coéquipières : un seul tour blanc change de main, #1 et #2 gardent le leur", () => {
    // Guide v1.3, §4, repris par l'absolut au §7 : « Tours blancs : #1, #2, #4. Combat : #3/#5. »
    const cinq = [1, 2, 3, 4, 5].map((rang) => ({
      registrationId: `r${rang}`,
      clubId: rang >= 4 ? "X" : `club-${rang}`,
      rank: rang,
    }));
    const sorti = placerLAbsolut(cinq);
    expect(ids(sorti.placement)).toEqual(["r1", null, "r4", "r5", "r2", null, "r3", null]);
    expect(ids(sorti.leaves)).toEqual(["r1", null, "r3", "r5", "r2", null, "r4", null]);
    expect(titulairesDeBye(sorti.leaves)).toEqual(["r1", "r2", "r4"]);
    expect(sorti.echanges).toEqual([
      { deplace: "r4", avec: "r3", contrainte: "meme-club-premier-tour" },
    ]);
  });

  it("à cinq, #4 et #5 de la même catégorie source : la revanche ne déplace aucun tour blanc", () => {
    // Guide v1.3, §7 : la revanche n'est évitée que « si elle ne pénalise aucun mieux classé » ;
    // prendre son tour blanc à #3 le pénaliserait.
    const cinq = [1, 2, 3, 4, 5].map((rang) => ({
      registrationId: `r${rang}`,
      clubId: `club-${rang}`,
      sourceCategoryId: rang >= 4 ? "S" : `s${rang}`,
      rank: rang,
    }));
    const sorti = placerLAbsolut(cinq);
    expect(sorti.leaves).toEqual(sorti.placement);
    expect(sorti.echanges).toEqual([]);
  });

  it("balayage : au plus un tour blanc réattribué, #1 / #2 opposés et exemptés, personne ne disparaît, l'équipe avant la revanche", () => {
    const sansMoitie = {
      ...ABSOLUT_RANG_SPORTIF_SEEDING_PLAN,
      constraints: ABSOLUT_RANG_SPORTIF_SEEDING_PLAN.constraints.filter(
        (c) => c.scope.kind !== "half",
      ),
    };
    const paires = (
      feuilles: readonly (BracketEntry | null)[],
      bloc: number,
      cle: (e: BracketEntry) => string | null,
    ): number => {
      let n = 0;
      for (let debut = 0; debut < feuilles.length; debut += bloc) {
        const vus = new Map<string, number>();
        for (let f = debut; f < Math.min(feuilles.length, debut + bloc); f++) {
          const e = feuilles[f] ?? null;
          const k = e === null ? null : cle(e);
          if (k !== null) vus.set(k, (vus.get(k) ?? 0) + 1);
        }
        for (const v of vus.values()) n += (v * (v - 1)) / 2;
      }
      return n;
    };
    let separables = 0;
    let separees = 0;
    for (let n = 2; n <= 33; n++) {
      for (let graine = 0; graine < 30; graine++) {
        const rng = mulberry32(fnv1a(`moities|${n}|${graine}`));
        const avecSources = graine % 3 !== 0;
        const entites: string[] = [];
        for (let i = 0; i < n; i++) {
          const precedente = entites[i - 1];
          const enPaire =
            precedente !== undefined && entites.filter((e) => e === precedente).length < 2;
          entites.push(enPaire && rng() < 0.4 ? precedente : `e${i}`);
        }
        const melangees = entites
          .map((e) => ({ e, r: rng() }))
          .sort((a, b) => a.r - b.r)
          .map((x) => x.e);
        const entries: BracketEntry[] = melangees.map((entite, i) => ({
          registrationId: `r${i + 1}`,
          clubId: entite,
          sourceCategoryId: avecSources ? `s${Math.floor(rng() * 3)}` : null,
          rank: i + 1,
        }));
        const taille = tailleDe(n);
        const sorti = applySeedingPlan(
          entries,
          taille,
          SANS_TIRAGE,
          ABSOLUT_RANG_SPORTIF_SEEDING_PLAN,
        );
        const avant = applySeedingPlan(entries, taille, SANS_TIRAGE, sansMoitie);
        const contexte = `n = ${n}, graine ${graine}`;
        // Guide v1.3, §4 et §7 : un seul tour blanc réattribué, jamais celui de #1 ni de #2 à
        // partir de quatre.
        const byesAvant = titulairesDeBye(sorti.placement);
        const byesApres = titulairesDeBye(sorti.leaves);
        expect(
          byesApres.filter((r) => !byesAvant.includes(r)).length,
          contexte,
        ).toBeLessThanOrEqual(1);
        if (n >= 4) {
          for (const tete of ["r1", "r2"]) {
            if (byesAvant.includes(tete)) expect(byesApres, contexte).toContain(tete);
          }
        }
        if (n >= 3) {
          expect(moitieDe(sorti.leaves, "r1"), contexte).not.toBe(moitieDe(sorti.leaves, "r2"));
        }
        expect(ids(sorti.leaves).slice().sort(), contexte).toEqual(
          ids(sorti.placement).slice().sort(),
        );
        const source = (e: BracketEntry) => e.sourceCategoryId ?? null;
        const entite = (e: BracketEntry) => e.clubId ?? null;
        const premierTour = (f: readonly (BracketEntry | null)[]) => [
          paires(f, 2, source),
          paires(f, 2, entite),
        ];
        const [sourceApres, entiteApres] = premierTour(sorti.leaves) as [number, number];
        const [sourceAvant, entiteAvant] = premierTour(avant.leaves) as [number, number];
        // L'équipe d'abord (premier tour, puis moitiés), la revanche ensuite (§7).
        expect(entiteApres, contexte).toBeLessThanOrEqual(entiteAvant);
        const moitiesApres = paires(sorti.leaves, taille / 2, entite);
        const moitiesAvant = paires(avant.leaves, taille / 2, entite);
        expect(moitiesApres, contexte).toBeLessThanOrEqual(moitiesAvant);
        if (entiteApres === entiteAvant && moitiesApres === moitiesAvant) {
          expect(sourceApres, contexte).toBeLessThanOrEqual(sourceAvant);
        }
        if (paires(avant.leaves, taille / 2, entite) > 0) {
          separables += 1;
          if (paires(sorti.leaves, taille / 2, entite) === 0) separees += 1;
        }
      }
    }
    expect(
      separees / separables,
      `${separees} tableaux séparés sur ${separables} qui avaient des coéquipiers dans une même moitié`,
    ).toBeGreaterThan(0.95);
  });

  it("la règle est dans les deux plans par rang : l'équipe au premier tour, puis par moitié, puis la revanche", () => {
    // Guide v1.3, §5 : « À partir de quatre combattants, deux athlètes auxquels la même équipe a
    // été attribuée doivent être placés dans des moitiés opposées. » §7 : la revanche en dernier.
    const moitie = ABSOLUT_RANG_SPORTIF_SEEDING_PLAN.constraints.find(
      (c) => c.scope.kind === "half",
    );
    expect(moitie).toMatchObject({ name: "meme-club-meme-moitie", key: "club", enabled: true });
    const palier = (name: string) =>
      ABSOLUT_RANG_SPORTIF_SEEDING_PLAN.constraints.find((c) => c.name === name)?.tier ?? -1;
    expect(palier("meme-club-premier-tour")).toBeLessThan(moitie?.tier ?? -1);
    expect(moitie?.tier ?? -1).toBeLessThan(palier("meme-categorie-source-premier-tour"));
    expect(
      RANG_SPORTIF_SEEDING_PLAN.constraints.find((c) => c.scope.kind === "half"),
    ).toMatchObject({ name: "meme-equipe-meme-moitie", key: "team", enabled: true, tier: 1 });
    const lignes = describeSeedingPlan(ABSOLUT_RANG_SPORTIF_SEEDING_PLAN);
    expect(
      lignes.some((l) => l.includes("meme-club-meme-moitie : club par moitié de tableau")),
    ).toBe(true);
  });

  it("le tableau généré les place dans deux demi-finales différentes", () => {
    const tableau = generateAbsolutBracket(RECETTE, "abs", {
      thirdPlaceMode: "pool3",
      placement: "rang-sportif",
    });
    if (tableau.kind !== "bracket") throw new Error("tableau attendu");
    const demies = tableau.fights
      .filter((f) => f.division === 2 && f.type === "BraketFight")
      .sort((a, b) => a.indexInDivision - b.indexInDivision);
    expect(demies[0]).toMatchObject({ slotA: "balcer" });
    const quartsDuBas = tableau.fights.filter(
      (f) => f.division === 3 && f.type === "BraketFight" && f.indexInDivision >= 2,
    );
    expect(quartsDuBas.flatMap((f) => [f.slotA, f.slotB])).toContain("cropsal");
  });
});

const CIBLE: CibleDePlacement = {
  saisonCourante: "2026-27",
  discipline: "gi",
  gender: "male",
  tranche: "Adulte",
  belt: "blue",
};

function resultat(
  id: string,
  licenseeId: string,
  pointsCentiemes: number,
  patch: Partial<ResultatPourPlacement> = {},
): ResultatPourPlacement {
  return {
    resultId: id,
    licenseeId,
    competitionId: "c",
    saisonSportive: "2026-27",
    discipline: "gi",
    gender: "male",
    tranche: "Adulte",
    belt: "blue",
    isAbsolut: false,
    place: 1,
    niveau: "open",
    pointsCentiemes,
    ...patch,
  };
}

describe("le critère qui départage chaque rang (légende, BR3.5 proposition B)", () => {
  it("catégorie de poids : score général, puis score direct, puis tirage", () => {
    const scores = [
      scoreDePlacement("a", [resultat("1", "a", 900)], CIBLE),
      scoreDePlacement(
        "b",
        [resultat("2", "b", 600), resultat("3", "b", 300, { belt: "white" })],
        CIBLE,
      ),
      scoreDePlacement("c", [resultat("4", "c", 750)], CIBLE),
      scoreDePlacement("d", [], CIBLE),
      scoreDePlacement("e", [], CIBLE),
    ];
    const rangs = ordonnerPourTableau(scores, { absolut: false, graine: "g" });
    const fige = figerLePlacement(rangs, false);
    // b : 600 en bleue et 300 en blanche, qui compte à 50 % vers un tableau bleue.
    expect(fige.map((f) => f.licenseeId).slice(0, 3)).toEqual(["a", "c", "b"]);
    expect(fige.map((f) => [f.generalCentiemes, f.directCentiemes]).slice(0, 3)).toEqual([
      [900, 900],
      [750, 750],
      [750, 600],
    ]);
    expect(fige.map((f) => f.critere)).toEqual([null, "general", "direct", "general", "tirage"]);
    expect(
      colonnesDeLaLegende(
        fige.map((f) => f.critere),
        false,
      ),
    ).toEqual({
      absolut: false,
      direct: true,
      departage: true,
    });
  });

  it("absolut : score Absolut, puis général ; la place du jour se nomme", () => {
    const scores = [
      scoreDePlacement("a", [resultat("1", "a", 1350, { isAbsolut: true })], CIBLE, {
        sourcePlace: 2,
        sourceWeightClass: "Leve",
      }),
      scoreDePlacement("b", [resultat("2", "b", 900)], CIBLE, {
        sourcePlace: 1,
        sourceWeightClass: "Leve",
      }),
      scoreDePlacement("c", [], CIBLE, { sourcePlace: 1, sourceWeightClass: "Pesado" }),
      scoreDePlacement("d", [], CIBLE, { sourcePlace: 1, sourceWeightClass: "Galo" }),
    ];
    const rangs = ordonnerPourTableau(scores, { absolut: true, graine: "g" });
    const fige = figerLePlacement(rangs, true);
    expect(fige.map((f) => f.licenseeId)).toEqual(["a", "b", "c", "d"]);
    expect(fige.map((f) => f.critere)).toEqual([null, "absolut", "general", "jour"]);
    expect(fige[0]?.absolutCentiemes).toBe(1350);
    expect(
      colonnesDeLaLegende(
        fige.map((f) => f.critere),
        true,
      ),
    ).toEqual({
      absolut: true,
      direct: false,
      departage: true,
    });
  });

  it("seuls le score direct, les critères, le jour et le tirage se mentionnent", () => {
    expect(critereAMentionner(null)).toBe(false);
    expect(critereAMentionner("general")).toBe(false);
    expect(critereAMentionner("absolut")).toBe(false);
    for (const c of ["direct", "criteres", "jour", "tirage"] as const) {
      expect(critereAMentionner(c)).toBe(true);
      expect(LIBELLES_CRITERE_DE_DEPARTAGE[c].length).toBeGreaterThan(5);
    }
  });

  it("le premier rang n'a pas de critère", () => {
    const [premier] = ordonnerPourTableau([scoreDePlacement("a", [], CIBLE)], { absolut: false });
    if (!premier) throw new Error("rang attendu");
    expect(critereQuiDepartage(null, premier, false)).toBeNull();
  });

  it("les contributions figées disent d'où vient chaque point", () => {
    const rangs = ordonnerPourTableau(
      [
        scoreDePlacement(
          "a",
          [resultat("r-n1", "a", 3600, { saisonSportive: "2025-26", niveau: "national" })],
          CIBLE,
        ),
      ],
      { absolut: false },
    );
    const [fige] = figerLePlacement(rangs, false);
    expect(fige?.contributions).toEqual([
      {
        resultId: "r-n1",
        saison: "2025-26",
        isAbsolut: false,
        pointsCentiemes: 3600,
        partSaison: 5000,
        partAge: 10000,
        partCeinture: 10000,
        contributionCentiemes: 1800,
      },
    ]);
    expect(fige?.generalCentiemes).toBe(1800);
  });
});

describe("un résultat lu en base devient un résultat de placement", () => {
  const ligne: LigneResultatDeLaBase = {
    id: "res-1",
    licensee_id: "lic-1",
    competition_id: "comp-1",
    sport_season: "2025-26",
    discipline: "gi",
    gender: "female",
    age_group_profile: "Master 1/2",
    belt: "purple",
    is_absolut: null,
    place: 2,
    ranking_level: "majeure",
    points: "6.00",
  };

  it("une ligne complète est lue telle quelle, points en centièmes", () => {
    expect(resultatPourPlacementDepuisLaBase(ligne)).toEqual({
      resultId: "res-1",
      licenseeId: "lic-1",
      competitionId: "comp-1",
      saisonSportive: "2025-26",
      discipline: "gi",
      gender: "female",
      tranche: "Master 1/2",
      belt: "purple",
      isAbsolut: false,
      place: 2,
      niveau: "majeure",
      pointsCentiemes: 600,
    });
  });

  it("une ligne incomplète ou hors podium ne compte pas", () => {
    const trous: Array<Partial<LigneResultatDeLaBase>> = [
      { licensee_id: null },
      { sport_season: null },
      { discipline: "mixed" },
      { gender: null },
      { belt: "violet" },
      { age_group_profile: null },
      { age_group_profile: "inconnu" },
      { place: 4 },
      { place: null },
      { ranking_level: "regional" },
      { points: 0 },
      { points: null },
      { points: "abc" },
    ];
    for (const trou of trous) {
      expect(resultatPourPlacementDepuisLaBase({ ...ligne, ...trou }), JSON.stringify(trou)).toBe(
        null,
      );
    }
  });
});

describe("placer les inscrits d'un tableau, et l'envoyer à la base", () => {
  it("chaque inscription reçoit un rang distinct, le licencié sans résultat passe au tirage", () => {
    const rangs = placerLesInscrits(
      [
        { registrationId: "reg-c", licenseeId: "c" },
        { registrationId: "reg-a", licenseeId: "a" },
        { registrationId: "reg-x", licenseeId: null },
        { registrationId: "reg-b", licenseeId: "b" },
      ],
      [resultat("1", "a", 900), resultat("2", "b", 300), resultat("3", "autre", 5000)],
      CIBLE,
      { absolut: false, graine: "tableau" },
    );
    expect(rangs.map((r) => r.registrationId).slice(0, 2)).toEqual(["reg-a", "reg-b"]);
    expect(rangs.map((r) => r.rang)).toEqual([1, 2, 3, 4]);
    expect(rangs.find((r) => r.registrationId === "reg-x")?.licenseeId).toBeNull();
    expect(rangs.find((r) => r.registrationId === "reg-a")?.licenseeId).toBe("a");
    expect(rangs.slice(2).map((r) => r.critere)).toContain("tirage");
  });

  it("le même tableau, relu dans un autre ordre, rend les mêmes rangs", () => {
    const inscrits = ["a", "b", "c", "d", "e"].map((l) => ({
      registrationId: `reg-${l}`,
      licenseeId: l,
    }));
    const un = placerLesInscrits(inscrits, [], CIBLE, { absolut: false, graine: "g" });
    const deux = placerLesInscrits([...inscrits].reverse(), [], CIBLE, {
      absolut: false,
      graine: "g",
    });
    expect(deux).toEqual(un);
  });

  it("sans profil lisible, personne n'a de point et le tirage départage tout le monde", () => {
    const rangs = placerLesInscrits(
      [
        { registrationId: "r1", licenseeId: "a" },
        { registrationId: "r2", licenseeId: "b" },
      ],
      [resultat("1", "a", 900)],
      null,
      { absolut: false, graine: "g" },
    );
    expect(rangs.every((r) => r.generalCentiemes === 0)).toBe(true);
    expect(rangs[1]?.critere).toBe("tirage");
  });

  it("l'absolut passe la place du jour de chaque inscrit", () => {
    const rangs = placerLesInscrits(
      [
        {
          registrationId: "leger",
          licenseeId: "a",
          jour: { sourcePlace: 1, sourceWeightClass: "Galo" },
        },
        {
          registrationId: "lourd",
          licenseeId: "b",
          jour: { sourcePlace: 1, sourceWeightClass: "Pesado" },
        },
      ],
      [],
      CIBLE,
      { absolut: true, graine: "g" },
    );
    expect(rangs.map((r) => [r.registrationId, r.critere])).toEqual([
      ["lourd", null],
      ["leger", "jour"],
    ]);
  });

  it("la charge envoyée à la base porte les scores en points, à deux décimales", () => {
    const rangs = placerLesInscrits(
      [{ registrationId: "r1", licenseeId: "a" }],
      [resultat("1", "a", 1350, { isAbsolut: true, saisonSportive: "2025-26" })],
      CIBLE,
      { absolut: true, graine: "g" },
    );
    const charge = placementPourLaBase(rangs, "g");
    expect(charge).toEqual({
      graine: "g",
      entrees: [
        {
          registrationId: "r1",
          rang: 1,
          general: 6.75,
          direct: 6.75,
          absolut: 6.75,
          critere: null,
          contributions: [
            {
              resultId: "1",
              saison: "2025-26",
              isAbsolut: true,
              pointsCentiemes: 1350,
              partSaison: 5000,
              partAge: 10000,
              partCeinture: 10000,
              contributionCentiemes: 675,
            },
          ],
        },
      ],
    });
    expect(JSON.stringify(charge)).toContain('"general":6.75');
  });
});

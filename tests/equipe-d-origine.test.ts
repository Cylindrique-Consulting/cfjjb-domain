import { describe, expect, it } from "vitest";
import type { BracketEntry } from "../src/bracket-generator";
import { groupesDExAequo, RANG_SPORTIF_SEEDING_PLAN } from "../src/placement-par-rang";
import {
  applySeedingPlan,
  describeSeedingPlan,
  type EchangeDeSeparation,
  type SeedingPlan,
} from "../src/seeding-plan";

/**
 * LA MÊME ÉQUIPE D'ORIGINE, SÉPARÉE ENTRE EX ÆQUO (guide v1.3, §1 et §5).
 *
 * ┌─ CE QUE CES TESTS TIENNENT ───────────────────────────────────────────────┐
 * │ Jusqu'à v0.35.0, le placement par rang ne connaissait que l'équipe        │
 * │ attribuée : TEAM CTG et TEAM CTG Jiu-Jitsu, sous-équipe de la première,   │
 * │ étaient deux équipes sans lien. Pour séparer Adama SY (#20) de son        │
 * │ coéquipier de TEAM CTG Jiu-Jitsu, la réparation l'échangeait avec #19 et  │
 * │ le plaçait face à Ilies JAOUANI (#14, TEAM CTG) au premier tour, alors que │
 * │ tous deux étaient ex æquo avec une vingtaine d'athlètes (Gén. 0,00).      │
 * │ Le guide : « Équipes attribuées différentes mais même équipe d'origine :  │
 * │ séparation recherchée seulement si elle ne pénalise aucun athlète mieux   │
 * │ classé. »                                                                  │
 * └───────────────────────────────────────────────────────────────────────────┘
 */

const SANS_TIRAGE = (): number => {
  throw new Error("le placement par rang ne consomme aucun tirage");
};

const SANS_RECHERCHE: SeedingPlan = {
  ...RANG_SPORTIF_SEEDING_PLAN,
  separationRecherchee: undefined,
};

type Feuilles = readonly (BracketEntry | null)[];

const tourDeRencontre = (f: number, g: number): number => 32 - Math.clz32(f ^ g);

function feuilleDe(feuilles: Feuilles, id: string): number {
  const f = feuilles.findIndex((e) => e?.registrationId === id);
  if (f < 0) throw new Error(`${id} absent du tableau`);
  return f;
}

function rencontre(feuilles: Feuilles, a: string, b: string): number {
  return tourDeRencontre(feuilleDe(feuilles, a), feuilleDe(feuilles, b));
}

const exempte = (feuilles: Feuilles, f: number): boolean =>
  feuilles[f] !== null && (feuilles[f ^ 1] ?? null) === null;

function exemptes(feuilles: Feuilles): string[] {
  return feuilles
    .flatMap((e, f) => (e !== null && exempte(feuilles, f) ? [e.registrationId] : []))
    .sort();
}

/**
 * Le tableau du ticket (Open Île-de-France Gi, blanche Adulte Homme Medio) : 29 inscrits
 * dans 32, #1, #2 et #3 à des scores distincts, #4 à #29 ex æquo. Quatre athlètes de
 * TEAM CTG : deux en TEAM CTG, deux en TEAM CTG Jiu-Jitsu.
 */
function tableauDuTicket(exAequo: boolean): BracketEntry[] {
  const noms = new Map<number, { id: string; team: string; origin: string }>([
    [5, { id: "cinqval", team: "ctg", origin: "ctg" }],
    [9, { id: "bouterfa", team: "ctg-jiu-jitsu", origin: "ctg" }],
    [14, { id: "jaouani", team: "ctg", origin: "ctg" }],
    [20, { id: "sy", team: "ctg-jiu-jitsu", origin: "ctg" }],
  ]);
  return Array.from({ length: 29 }, (_, i): BracketEntry => {
    const rang = i + 1;
    const nomme = noms.get(rang);
    return {
      registrationId: nomme?.id ?? `r${rang}`,
      clubId: `c${rang}`,
      teamId: nomme?.team ?? null,
      originTeamId: nomme?.origin ?? `c${rang}`,
      rank: rang,
      tieGroup: exAequo && rang >= 4 ? 4 : rang,
    };
  });
}

describe("même équipe d'origine : le tableau du ticket", () => {
  it("témoin : sans la séparation recherchée, #20 est échangé avec #19 et affronte #14 au premier tour", () => {
    const { leaves, echanges } = applySeedingPlan(
      tableauDuTicket(true),
      32,
      SANS_TIRAGE,
      SANS_RECHERCHE,
    );
    expect(rencontre(leaves, "jaouani", "sy")).toBe(1);
    expect(echanges).toEqual([
      { deplace: "sy", avec: "r19", contrainte: "meme-equipe-meme-moitie" },
    ]);
  });

  it("entre ex æquo, #14 et #20 ne peuvent plus se rencontrer qu'en demi-finale", () => {
    const { leaves, echanges } = applySeedingPlan(
      tableauDuTicket(true),
      32,
      SANS_TIRAGE,
      RANG_SPORTIF_SEEDING_PLAN,
    );
    // Deux par moitié, chacun dans son quart : la demi-finale, pas avant.
    expect(rencontre(leaves, "jaouani", "sy")).toBe(4);
    expect(rencontre(leaves, "cinqval", "bouterfa")).toBe(4);
    // La règle impérative tient toujours : chaque équipe attribuée dans deux moitiés.
    expect(rencontre(leaves, "cinqval", "jaouani")).toBe(5);
    expect(rencontre(leaves, "bouterfa", "sy")).toBe(5);
    // Un seul échange de plus, avec un ex æquo de #20, au rang le plus proche qui éloigne.
    expect(echanges).toEqual([
      { deplace: "sy", avec: "r19", contrainte: "meme-equipe-meme-moitie" },
      { deplace: "sy", avec: "r18", contrainte: "meme-equipe-d-origine" },
    ]);
  });

  it("les mieux classés ne bougent pas : #1, #2 et #3 gardent leur position et leur tour blanc", () => {
    const avant = applySeedingPlan(tableauDuTicket(true), 32, SANS_TIRAGE, SANS_RECHERCHE).leaves;
    const apres = applySeedingPlan(
      tableauDuTicket(true),
      32,
      SANS_TIRAGE,
      RANG_SPORTIF_SEEDING_PLAN,
    ).leaves;
    for (const id of ["r1", "r2", "r3"]) expect(feuilleDe(apres, id)).toBe(feuilleDe(avant, id));
    expect(exemptes(apres)).toEqual(exemptes(avant));
  });

  it("sans ex æquo, rien ne bouge : l'éloigner pénaliserait un mieux classé", () => {
    const avant = applySeedingPlan(tableauDuTicket(false), 32, SANS_TIRAGE, SANS_RECHERCHE);
    const apres = applySeedingPlan(
      tableauDuTicket(false),
      32,
      SANS_TIRAGE,
      RANG_SPORTIF_SEEDING_PLAN,
    );
    expect(apres.leaves).toEqual(avant.leaves);
    expect(apres.echanges).toEqual(avant.echanges);
    expect(rencontre(apres.leaves, "jaouani", "sy")).toBe(1);
  });
});

describe("même équipe d'origine : ce que la recherche ne fait jamais", () => {
  it("à cinq, #4 et #5 de même origine s'affrontent : aucun tour blanc ne change de main pour eux", () => {
    const entries = Array.from({ length: 5 }, (_, i): BracketEntry => ({
      registrationId: `r${i + 1}`,
      clubId: `c${i + 1}`,
      teamId: `t${i + 1}`,
      originTeamId: i >= 3 ? "origine" : `t${i + 1}`,
      rank: i + 1,
      tieGroup: 1,
    }));
    const { leaves, echanges } = applySeedingPlan(
      entries,
      8,
      SANS_TIRAGE,
      RANG_SPORTIF_SEEDING_PLAN,
    );
    expect(rencontre(leaves, "r4", "r5")).toBe(1);
    expect(exemptes(leaves)).toEqual(["r1", "r2", "r3"]);
    expect(echanges).toEqual([]);
  });

  it("#1 et #2 ne bougent jamais, même ex æquo et exemptés tous les deux", () => {
    // Six inscrits dans huit, tous ex æquo sauf #6 : #2 et #6 (même origine O) sont dans la
    // même moitié. Échanger #2 avec #1, exempté comme lui, les séparerait : c'est interdit.
    const cles: Record<number, [string | null, string]> = {
      1: [null, "c1"],
      2: ["O-0", "O"],
      3: ["P-0", "P"],
      4: [null, "c4"],
      5: ["P-2", "P"],
      6: ["O-1", "O"],
    };
    const entries = Array.from({ length: 6 }, (_, i): BracketEntry => {
      const [teamId, originTeamId] = cles[i + 1]!;
      return {
        registrationId: `r${i + 1}`,
        clubId: `c${i + 1}`,
        teamId,
        originTeamId,
        rank: i + 1,
        tieGroup: i + 1 === 6 ? 6 : 1,
      };
    });
    const avant = applySeedingPlan(entries, 8, SANS_TIRAGE, SANS_RECHERCHE);
    const apres = applySeedingPlan(entries, 8, SANS_TIRAGE, RANG_SPORTIF_SEEDING_PLAN);
    expect(feuilleDe(apres.leaves, "r1")).toBe(0);
    expect(feuilleDe(apres.leaves, "r2")).toBe(feuilleDe(avant.leaves, "r2"));
    expect(apres.echanges).toEqual(avant.echanges);
  });

  it("une entrée sans équipe d'origine ni groupe d'ex æquo laisse le placement de v0.35.0", () => {
    const entries = tableauDuTicket(true).map(
      ({ originTeamId: _o, tieGroup: _g, ...reste }): BracketEntry => reste,
    );
    const avant = applySeedingPlan(entries, 32, SANS_TIRAGE, SANS_RECHERCHE);
    const apres = applySeedingPlan(entries, 32, SANS_TIRAGE, RANG_SPORTIF_SEEDING_PLAN);
    expect(apres.leaves).toEqual(avant.leaves);
    expect(apres.echanges).toEqual(avant.echanges);
  });

  it("une contrainte que la réparation ne traite pas : sa paire en défaut reste la même", () => {
    // Un même club au quart de tableau, que la réparation au rang voisin ne répare pas : à
    // huit, #4 et #8 du club K (même origine) sont dans le même quart. Les séparer ferait
    // reculer leur rencontre de la demi-finale à la finale, mais retirerait une paire en
    // défaut du plan.
    const plan: SeedingPlan = {
      ...RANG_SPORTIF_SEEDING_PLAN,
      constraints: [
        ...RANG_SPORTIF_SEEDING_PLAN.constraints,
        {
          name: "meme-club-quart-de-tableau",
          enabled: true,
          key: "club",
          scope: { kind: "round", round: 2 },
          tier: 2,
          weight: 1,
        },
      ],
    };
    const entries = Array.from({ length: 8 }, (_, i): BracketEntry => {
      const rang = i + 1;
      const club = rang === 4 || rang === 8 ? "K" : `c${rang}`;
      return {
        registrationId: `r${rang}`,
        clubId: club,
        teamId: null,
        originTeamId: club,
        rank: rang,
        tieGroup: rang <= 2 ? rang : 3,
      };
    });
    const avant = applySeedingPlan(entries, 8, SANS_TIRAGE, {
      ...plan,
      separationRecherchee: undefined,
    });
    const apres = applySeedingPlan(entries, 8, SANS_TIRAGE, plan);
    expect(rencontre(avant.leaves, "r4", "r8")).toBe(2);
    expect(apres.leaves).toEqual(avant.leaves);
    expect(apres.echanges).toEqual([]);
  });

  it("le plan se décrit : la séparation recherchée, entre ex æquo", () => {
    const lignes = describeSeedingPlan(RANG_SPORTIF_SEEDING_PLAN);
    expect(
      lignes.some(
        (l) =>
          l.includes("séparation recherchée") &&
          l.includes("origin-team") &&
          l.includes("ex æquo") &&
          l.includes("actif"),
      ),
    ).toBe(true);
    expect(describeSeedingPlan(SANS_RECHERCHE).some((l) => l.includes("recherchée"))).toBe(false);
  });
});

/**
 * Tous ex æquo à partir de #3, sans équipe attribuée : seuls #3 et #7 partagent une équipe
 * d'origine. Dans le placement standard, ils sont dans la même moitié, dans deux quarts :
 * ils peuvent se rencontrer en demi-finale.
 */
function deuxDeMemeOrigineEnDemiFinale(n: number): BracketEntry[] {
  return Array.from({ length: n }, (_, i): BracketEntry => {
    const rang = i + 1;
    return {
      registrationId: `r${rang}`,
      clubId: `c${rang}`,
      teamId: null,
      originTeamId: rang === 3 || rang === 7 ? "origine" : `c${rang}`,
      rank: rang,
      tieGroup: rang <= 2 ? rang : 3,
    };
  });
}

describe("même équipe d'origine : jusqu'à la finale", () => {
  it("à vingt, #3 et #7 de même origine passent dans deux moitiés : ils ne peuvent plus se rencontrer qu'en finale", () => {
    const entries = deuxDeMemeOrigineEnDemiFinale(20);
    const avant = applySeedingPlan(entries, 32, SANS_TIRAGE, SANS_RECHERCHE);
    expect(rencontre(avant.leaves, "r3", "r7")).toBe(4);
    const { leaves, echanges } = applySeedingPlan(
      entries,
      32,
      SANS_TIRAGE,
      RANG_SPORTIF_SEEDING_PLAN,
    );
    expect(rencontre(leaves, "r3", "r7")).toBe(5);
    expect(echanges).toEqual([{ deplace: "r7", avec: "r8", contrainte: "meme-equipe-d-origine" }]);
  });

  it("à huit, dans une petite catégorie, de même", () => {
    const entries = deuxDeMemeOrigineEnDemiFinale(8);
    expect(
      rencontre(applySeedingPlan(entries, 8, SANS_TIRAGE, SANS_RECHERCHE).leaves, "r3", "r7"),
    ).toBe(2);
    const { leaves, echanges } = applySeedingPlan(
      entries,
      8,
      SANS_TIRAGE,
      RANG_SPORTIF_SEEDING_PLAN,
    );
    expect(rencontre(leaves, "r3", "r7")).toBe(3);
    expect(echanges).toEqual([{ deplace: "r7", avec: "r8", contrainte: "meme-equipe-d-origine" }]);
  });
});

/**
 * LE VERROU : sur des tableaux tirés au hasard (4 à 40 inscrits, équipes de deux réunies
 * en équipes d'origine, ex æquo par séries ; puis de petites catégories dominées par une
 * équipe, dont des équipes attribuées de trois qu'aucun placement ne sépare toutes ; puis
 * de grands tableaux de 41 à 128 inscrits, dont une grosse équipe d'origine), la
 * séparation recherchée :
 * - ne change aucune paire en défaut du plan : ni ajoutée, ni retirée, ni remplacée par
 *   une autre (relecture du 28/09 : sur les catégories dominées, une paire inévitable
 *   passait à d'autres athlètes, parfois mieux classés) ;
 * - ne fait jamais avancer les rencontres de même origine, et les recule souvent ;
 * - ne change aucun tour blanc de main, ne déplace ni #1 ni #2 (relecture du 28/09 : #1
 *   et #2 ex æquo et exemptés s'échangeaient) ;
 * - ne défait aucun échange de la réparation ;
 * - ne change le parcours de personne : dans chaque bloc de chaque tour, les scores
 *   présents (les groupes d'ex æquo) sont exactement ceux d'avant. C'est la forme
 *   vérifiable de « ne pénalise aucun athlète mieux classé » ;
 * - dit ce qu'elle a fait : ses échanges, rejoués sur le tableau de la réparation, donnent
 *   le tableau final ; et depuis le placement standard, tous les échanges donnent le
 *   tableau final partout où ceux de la réparation se rejouaient déjà (relecture du 28/09).
 */
function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function tableauAuHasard(n: number, rng: () => number, parEquipe = 2): BracketEntry[] {
  // Les ex æquo : des séries de rangs consécutifs.
  const groupes: number[] = [];
  let tete = 1;
  for (let rang = 1; rang <= n; rang++) {
    if (rang === 1 || rng() < 0.35) tete = rang;
    groupes.push(tete);
  }
  // Des équipes attribuées de `parEquipe` au plus, réunies par origines de deux ou trois.
  const ordre = Array.from({ length: n }, (_, i) => i + 1).sort(() => rng() - 0.5);
  const equipe = new Map<number, string>();
  const origine = new Map<number, string>();
  let k = 0;
  let o = 0;
  while (k < ordre.length && rng() < 0.85) {
    const equipes = 2 + Math.floor(rng() * 2);
    for (let e = 0; e < equipes && k < ordre.length; e++) {
      const taille = 1 + Math.floor(rng() * parEquipe);
      for (let m = 0; m < taille && k < ordre.length; m++, k++) {
        equipe.set(ordre[k]!, `o${o}-e${e}`);
        origine.set(ordre[k]!, `o${o}`);
      }
    }
    o++;
  }
  return Array.from({ length: n }, (_, i): BracketEntry => {
    const rang = i + 1;
    return {
      registrationId: `r${rang}`,
      clubId: `c${rang}`,
      teamId: equipe.get(rang) ?? null,
      originTeamId: origine.get(rang) ?? `c${rang}`,
      rank: rang,
      tieGroup: groupes[i]!,
    };
  });
}

/**
 * Une grosse équipe d'origine : 30 % à 70 % des inscrits, en équipes attribuées d'un à trois
 * athlètes ; les autres seuls. Les ex æquo par petites séries, ou un seul grand groupe
 * après quelques scores distincts (une catégorie de ceintures blanches).
 */
function tableauAvecUneGrosseOrigine(n: number, rng: () => number): BracketEntry[] {
  const seriesCourtes = rng() < 0.5;
  const distincts = 2 + Math.floor(rng() * 6);
  const groupes: number[] = [];
  let tete = 1;
  for (let rang = 1; rang <= n; rang++) {
    if (seriesCourtes ? rang === 1 || rng() < 0.35 : rang <= distincts) tete = rang;
    groupes.push(tete);
  }
  const ordre = Array.from({ length: n }, (_, i) => i + 1).sort(() => rng() - 0.5);
  const membres = Math.floor(n * (0.3 + 0.4 * rng()));
  const equipe = new Map<number, string>();
  let e = 0;
  let place = 0;
  for (let k = 0; k < membres; k++) {
    if (place === 0) place = 1 + Math.floor(rng() * 3);
    equipe.set(ordre[k]!, `grosse-e${e}`);
    place -= 1;
    if (place === 0) e += 1;
  }
  return Array.from({ length: n }, (_, i): BracketEntry => {
    const rang = i + 1;
    return {
      registrationId: `r${rang}`,
      clubId: `c${rang}`,
      teamId: equipe.get(rang) ?? null,
      originTeamId: equipe.has(rang) ? "grosse" : `c${rang}`,
      rank: rang,
      tieGroup: groupes[i]!,
    };
  });
}

const tailleDe = (n: number): number => 2 ** Math.ceil(Math.log2(Math.max(2, n)));

const idsDe = (feuilles: Feuilles): (string | null)[] =>
  feuilles.map((e) => e?.registrationId ?? null);

/** Les échanges rejoués : chacun permute les places des deux athlètes qu'il nomme. */
function rejouer(depart: Feuilles, echanges: readonly EchangeDeSeparation[]): (string | null)[] {
  const ids = idsDe(depart);
  for (const { deplace, avec } of echanges) {
    const i = ids.indexOf(deplace);
    const j = ids.indexOf(avec);
    if (i < 0 || j < 0) return [];
    ids[i] = avec;
    ids[j] = deplace;
  }
  return ids;
}

/** Les paires en défaut du plan, athlète par athlète : même équipe attribuée au premier tour, puis dans une même moitié. */
function pairesEnDefaut(feuilles: Feuilles): string[] {
  const out: string[] = [];
  for (let f = 0; f < feuilles.length; f++) {
    for (let g = f + 1; g < feuilles.length; g++) {
      const a = feuilles[f] ?? null;
      const b = feuilles[g] ?? null;
      if (a === null || b === null || (a.teamId ?? null) === null || a.teamId !== b.teamId)
        continue;
      const ids = [a.registrationId, b.registrationId].sort().join("|");
      if (tourDeRencontre(f, g) === 1) out.push(`premier-tour:${ids}`);
      if (f < feuilles.length / 2 === g < feuilles.length / 2) out.push(`moitie:${ids}`);
    }
  }
  return out.sort();
}

function rencontresDOrigine(feuilles: Feuilles): number[] {
  const finale = Math.log2(feuilles.length);
  const out = new Array<number>(Math.max(0, finale - 1)).fill(0);
  for (let f = 0; f < feuilles.length; f++) {
    for (let g = f + 1; g < feuilles.length; g++) {
      const a = feuilles[f]?.originTeamId ?? null;
      if (a === null || a !== (feuilles[g]?.originTeamId ?? null)) continue;
      const tour = tourDeRencontre(f, g);
      if (tour < finale) out[tour - 1]! += 1;
    }
  }
  return out;
}

function compare(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

function blocs(feuilles: Feuilles): string[] {
  const out: string[] = [];
  for (let taille = 2; taille <= feuilles.length; taille *= 2) {
    for (let debut = 0; debut < feuilles.length; debut += taille) {
      const groupes = feuilles
        .slice(debut, debut + taille)
        .map((e) => (e === null ? "-" : String(e.tieGroup)))
        .sort();
      out.push(`${taille}@${debut}:${groupes.join(",")}`);
    }
  }
  return out;
}

// Deux recherches exhaustives de quelques secondes sur un runner de CI chargé.
const VERROU = 60_000;

describe("même équipe d'origine : le verrou", () => {
  function verifier(
    entries: readonly BracketEntry[],
    cas: string,
  ): { recul: boolean; inevitable: boolean; rejouable: boolean } {
    const taille = tailleDe(entries.length);
    const avant = applySeedingPlan(entries, taille, SANS_TIRAGE, SANS_RECHERCHE);
    const apres = applySeedingPlan(entries, taille, SANS_TIRAGE, RANG_SPORTIF_SEEDING_PLAN);

    expect(pairesEnDefaut(apres.leaves), cas).toEqual(pairesEnDefaut(avant.leaves));
    const recul = compare(rencontresDOrigine(apres.leaves), rencontresDOrigine(avant.leaves));
    expect(recul, cas).toBeLessThanOrEqual(0);
    expect(exemptes(apres.leaves), cas).toEqual(exemptes(avant.leaves));
    for (const id of ["r1", "r2"]) {
      expect(feuilleDe(apres.leaves, id), cas).toBe(feuilleDe(avant.leaves, id));
    }
    expect(blocs(apres.leaves), cas).toEqual(blocs(avant.leaves));
    // Les échanges de la recherche : entre ex æquo, jamais avec soi-même, jamais le
    // retour d'un échange de la réparation.
    const groupeDe = new Map(entries.map((e) => [e.registrationId, e.tieGroup] as const));
    const paire = (x: string, y: string) => [x, y].sort().join("|");
    const reparation = new Set(avant.echanges.map((e) => paire(e.deplace, e.avec)));
    for (const e of apres.echanges.slice(avant.echanges.length)) {
      expect(e.contrainte, cas).toBe("meme-equipe-d-origine");
      expect(groupeDe.get(e.deplace), cas).toBe(groupeDe.get(e.avec));
      expect(e.deplace, cas).not.toBe(e.avec);
      expect(reparation.has(paire(e.deplace, e.avec)), cas).toBe(false);
    }
    expect(apres.echanges.slice(0, avant.echanges.length), cas).toEqual(avant.echanges);
    // Les échanges de la recherche, rejoués sur le tableau de la réparation.
    expect(rejouer(avant.leaves, apres.echanges.slice(avant.echanges.length)), cas).toEqual(
      idsDe(apres.leaves),
    );
    // Tous les échanges, depuis le placement standard, là où ceux de la réparation se
    // rejouent (limite connue depuis v0.31.0 : un combat entier changé de moitié avec un
    // combat exempté ne nomme que l'athlète du combat plein).
    const rejouable =
      JSON.stringify(rejouer(avant.placement, avant.echanges)) ===
      JSON.stringify(idsDe(avant.leaves));
    if (rejouable) {
      expect(rejouer(apres.placement, apres.echanges), cas).toEqual(idsDe(apres.leaves));
    }
    return { recul: recul < 0, inevitable: pairesEnDefaut(avant.leaves).length > 0, rejouable };
  }

  it(
    "3 000 tableaux au hasard : rien de ce que le plan a décidé ne change, personne de pénalisé, les rencontres reculent",
    () => {
      const rng = mulberry(20260928);
      let reculs = 0;
      let rejouables = 0;
      for (let essai = 0; essai < 3000; essai++) {
        const n = 4 + Math.floor(rng() * 37);
        const { recul, rejouable } = verifier(
          tableauAuHasard(n, rng),
          `essai ${essai}, ${n} inscrits`,
        );
        if (recul) reculs += 1;
        if (rejouable) rejouables += 1;
      }
      // Le verrou n'est pas vide : la recherche a réellement éloigné des équipes d'origine, et
      // presque tous les tableaux se rejouent depuis le placement standard.
      expect(reculs).toBeGreaterThan(300);
      expect(rejouables).toBeGreaterThan(2700);
    },
    VERROU,
  );

  it(
    "3 000 petites catégories dominées par une équipe : une paire inévitable reste la même",
    () => {
      const rng = mulberry(280926);
      let reculs = 0;
      let inevitables = 0;
      let rejouables = 0;
      for (let essai = 0; essai < 3000; essai++) {
        const n = 4 + Math.floor(rng() * 9);
        const { recul, inevitable, rejouable } = verifier(
          tableauAuHasard(n, rng, 3),
          `catégorie dominée ${essai}, ${n} inscrits`,
        );
        if (recul) reculs += 1;
        if (inevitable) inevitables += 1;
        if (rejouable) rejouables += 1;
      }
      // Le décor n'est pas vide : des paires inévitables, des rencontres qui reculent, des
      // tableaux qui se rejouent depuis le placement standard.
      expect(inevitables).toBeGreaterThan(100);
      expect(reculs).toBeGreaterThan(300);
      expect(rejouables).toBeGreaterThan(2700);
    },
    VERROU,
  );

  it(
    "300 grands tableaux de 41 à 128 inscrits, dont une grosse équipe d'origine : les mêmes garanties",
    () => {
      const rng = mulberry(20260930);
      let reculs = 0;
      let rejouables = 0;
      let grands = 0;
      for (let essai = 0; essai < 300; essai++) {
        const n = 41 + Math.floor(rng() * 88);
        if (n > 64) grands += 1;
        const grosse = essai % 2 === 1;
        const entries = grosse ? tableauAvecUneGrosseOrigine(n, rng) : tableauAuHasard(n, rng);
        const { recul, rejouable } = verifier(
          entries,
          `grand tableau ${essai}, ${n} inscrits${grosse ? ", une grosse équipe d'origine" : ""}`,
        );
        if (recul) reculs += 1;
        if (rejouable) rejouables += 1;
      }
      // Des tableaux de 64 et de 128, des rencontres qui reculent, des échanges rejoués
      // depuis le placement standard.
      expect(grands).toBeGreaterThan(100);
      expect(reculs).toBeGreaterThan(200);
      expect(rejouables).toBeGreaterThan(150);
    },
    VERROU,
  );
});

/**
 * LE MEILLEUR PLACEMENT QUE LES RÈGLES PERMETTENT, par énumération : les athlètes mobiles
 * (ex æquo, ni #1 ni #2) ne changent de place qu'entre eux, à groupe et statut égaux ; aucun
 * ne prend la place d'un athlète que la réparation a échangé avec lui ; les paires en défaut
 * restent les mêmes. Les mobiles sans équipe, seuls de leur origine et hors des échanges de
 * la réparation, sont interchangeables : seuls les autres sont placés, un par un. Rend
 * `null` au-delà de `plafond` placements.
 */
function meilleurPossible(
  depart: Feuilles,
  reparation: readonly EchangeDeSeparation[],
  plafond: number,
): number[] | null {
  const paire = (x: string, y: string) => [x, y].sort().join("|");
  const interdites = new Set(reparation.map((e) => paire(e.deplace, e.avec)));
  const lies = new Set(reparation.flatMap((e) => [e.deplace, e.avec]));
  const effectifs = new Map<string, number>();
  for (const e of depart) {
    const o = e?.originTeamId ?? null;
    if (o !== null) effectifs.set(o, (effectifs.get(o) ?? 0) + 1);
  }
  const place = (e: BracketEntry) =>
    (e.teamId ?? null) !== null ||
    lies.has(e.registrationId) ||
    (effectifs.get(e.originTeamId ?? "") ?? 0) >= 2;
  const classes = new Map<string, number[]>();
  depart.forEach((e, f) => {
    if (e === null || (e.tieGroup ?? null) === null || (e.rank ?? 0) <= 2) return;
    const cle = `${e.tieGroup}|${exempte(depart, f)}`;
    classes.set(cle, [...(classes.get(cle) ?? []), f]);
  });
  const positions = [...classes.values()];
  const aPlacer = positions.map((p) => p.map((f) => depart[f] as BracketEntry).filter(place));
  const autres = positions.map((p) =>
    p.map((f) => depart[f] as BracketEntry).filter((e) => !place(e)),
  );
  let total = 1;
  for (let k = 0; k < positions.length; k++) {
    for (let i = 0; i < aPlacer[k]!.length; i++) total *= positions[k]!.length - i;
    if (total > plafond) return null;
  }
  const paires = pairesEnDefaut(depart).join(",");
  const courant = [...depart];
  let meilleur = rencontresDOrigine(depart);
  const classe = (k: number): void => {
    if (k === positions.length) {
      if (pairesEnDefaut(courant).join(",") !== paires) return;
      const v = rencontresDOrigine(courant);
      if (compare(v, meilleur) < 0) meilleur = v;
      return;
    }
    const libres = positions[k]!.map(() => true);
    const athlete = (i: number): void => {
      if (i === aPlacer[k]!.length) {
        let j = 0;
        positions[k]!.forEach((f, p) => {
          if (libres[p]) courant[f] = autres[k]![j++]!;
        });
        classe(k + 1);
        return;
      }
      const a = aPlacer[k]![i]!;
      positions[k]!.forEach((f, p) => {
        const occupant = depart[f] as BracketEntry;
        if (!libres[p]) return;
        if (occupant !== a && interdites.has(paire(a.registrationId, occupant.registrationId)))
          return;
        libres[p] = false;
        courant[f] = a;
        athlete(i + 1);
        libres[p] = true;
      });
    };
    athlete(0);
    positions[k]!.forEach((f) => (courant[f] = depart[f] ?? null));
  };
  classe(0);
  return meilleur;
}

/**
 * La distribution de la relecture : quelques scores distincts, puis un ou deux grands
 * groupes d'ex æquo ; une à trois équipes d'origine de deux à cinq athlètes, en équipes
 * attribuées de deux au plus.
 */
function tableauAGrandsGroupes(n: number, rng: () => number): BracketEntry[] {
  const distincts = Math.floor(rng() * Math.min(6, n));
  const deuxGroupes = rng() < 0.3;
  const coupe = distincts + Math.floor((n - distincts) / 2);
  const ordre = Array.from({ length: n }, (_, i) => i + 1).sort(() => rng() - 0.5);
  const origine = new Map<number, string>();
  const equipe = new Map<number, string>();
  let k = 0;
  const origines = 1 + Math.floor(rng() * 3);
  for (let o = 0; o < origines && k < n; o++) {
    const taille = 2 + Math.floor(rng() * 4);
    let e = 0;
    let dans = 0;
    for (let m = 0; m < taille && k < n; m++, k++) {
      if (dans === 2 || (dans === 1 && rng() < 0.4)) {
        e++;
        dans = 0;
      }
      origine.set(ordre[k]!, `o${o}`);
      equipe.set(ordre[k]!, `o${o}-e${e}`);
      dans++;
    }
  }
  return Array.from({ length: n }, (_, i): BracketEntry => {
    const rang = i + 1;
    const groupe =
      rang <= distincts ? rang : deuxGroupes && rang > coupe ? coupe + 1 : distincts + 1;
    return {
      registrationId: `r${rang}`,
      clubId: `c${rang}`,
      teamId: equipe.get(rang) ?? null,
      originTeamId: origine.get(rang) ?? `c${rang}`,
      rank: rang,
      tieGroup: groupe,
    };
  });
}

describe("même équipe d'origine : la recherche exacte des petites catégories", () => {
  it("deux échanges à la fois : #8 et #9, de même origine, ne se rencontrent plus au premier tour", () => {
    // Relecture du 28/09 : dix inscrits, #4 à #10 ex æquo. Chaque équipe attribuée est déjà
    // dans deux moitiés ; éloigner #8 de #9 seul mettrait #8 dans la moitié de #6, son
    // coéquipier, et chaque échange seul défait une séparation impérative.
    const equipes: Record<number, string> = {
      1: "o0-e0",
      10: "o0-e0",
      2: "o1-e0",
      9: "o1-e0",
      6: "o1-e1",
      8: "o1-e1",
      4: "o2-e0",
      7: "o2-e0",
    };
    const entries = Array.from({ length: 10 }, (_, i): BracketEntry => {
      const rang = i + 1;
      const equipe = equipes[rang] ?? null;
      return {
        registrationId: `r${rang}`,
        clubId: `c${rang}`,
        teamId: equipe,
        originTeamId: equipe?.split("-")[0] ?? `c${rang}`,
        rank: rang,
        tieGroup: rang >= 4 ? 4 : rang,
      };
    });
    const avant = applySeedingPlan(entries, 16, SANS_TIRAGE, SANS_RECHERCHE);
    expect(rencontre(avant.leaves, "r8", "r9")).toBe(1);
    const { leaves, echanges } = applySeedingPlan(
      entries,
      16,
      SANS_TIRAGE,
      RANG_SPORTIF_SEEDING_PLAN,
    );
    expect(rencontresDOrigine(avant.leaves)).toEqual([1, 0, 1]);
    expect(rencontresDOrigine(leaves)).toEqual([0, 1, 1]);
    expect(rencontre(leaves, "r8", "r9")).toBe(4);
    expect(pairesEnDefaut(leaves)).toEqual([]);
    expect(exemptes(leaves)).toEqual(exemptes(avant.leaves));
    // Les deux échanges : #8 prend la place de #7, #6 celle de #4 ; les deux équipes
    // attribuées changent de moitié ensemble.
    expect(echanges).toEqual([
      { deplace: "r8", avec: "r7", contrainte: "meme-equipe-d-origine" },
      { deplace: "r6", avec: "r4", contrainte: "meme-equipe-d-origine" },
    ]);
  });

  it("un échange à la fois suffit : le tableau de la recherche locale reste", () => {
    // Trois athlètes d'une même origine parmi huit : deux d'entre eux partagent une moitié,
    // une demi-finale au moins est inévitable. La recherche locale l'atteint en échangeant
    // #5 avec #7 ; la recherche exacte, qui aurait préféré déplacer #8, ne fait pas mieux et
    // ne change rien.
    const entries = Array.from({ length: 8 }, (_, i): BracketEntry => {
      const rang = i + 1;
      return {
        registrationId: `r${rang}`,
        clubId: `c${rang}`,
        teamId: null,
        originTeamId: rang >= 4 && rang <= 6 ? "origine" : `c${rang}`,
        rank: rang,
        tieGroup: rang <= 2 ? rang : 3,
      };
    });
    const { leaves, echanges } = applySeedingPlan(
      entries,
      8,
      SANS_TIRAGE,
      RANG_SPORTIF_SEEDING_PLAN,
    );
    expect(rencontresDOrigine(leaves)).toEqual([0, 1]);
    expect(echanges).toEqual([{ deplace: "r5", avec: "r7", contrainte: "meme-equipe-d-origine" }]);
  });

  it(
    "3 000 petites catégories : le meilleur placement que les règles permettent, jamais moins",
    () => {
      let compares = 0;
      let ameliores = 0;
      for (const [nom, graine, tirer] of [
        [
          "séries d'ex æquo",
          20261001,
          (n: number, rng: () => number) => tableauAuHasard(n, rng, 1 + Math.floor(rng() * 3)),
        ],
        ["grands groupes d'ex æquo", 20261002, tableauAGrandsGroupes],
      ] as const) {
        const rng = mulberry(graine);
        for (let essai = 0; essai < 1500; essai++) {
          const n = 4 + Math.floor(rng() * 14);
          const entries = tirer(n, rng);
          const taille = tailleDe(n);
          const avant = applySeedingPlan(entries, taille, SANS_TIRAGE, SANS_RECHERCHE);
          const apres = applySeedingPlan(entries, taille, SANS_TIRAGE, RANG_SPORTIF_SEEDING_PLAN);
          const possible = meilleurPossible(avant.leaves, avant.echanges, 20_000);
          if (possible === null) continue;
          compares += 1;
          const obtenu = rencontresDOrigine(apres.leaves);
          expect(compare(obtenu, possible), `${nom} ${essai}, ${n} inscrits`).toBeLessThanOrEqual(
            0,
          );
          if (compare(obtenu, rencontresDOrigine(avant.leaves)) < 0) ameliores += 1;
        }
      }
      // L'énumération a jugé la plupart des tableaux, et la recherche en a amélioré beaucoup.
      expect(compares).toBeGreaterThan(2400);
      expect(ameliores).toBeGreaterThan(600);
    },
    VERROU,
  );
});

describe("groupesDExAequo", () => {
  it("le rang du premier de chaque série que seul le tirage a départagée", () => {
    const groupes = groupesDExAequo([
      { registrationId: "c", rang: 3, critere: "tirage" },
      { registrationId: "a", rang: 1, critere: null },
      { registrationId: "b", rang: 2, critere: "general" },
      { registrationId: "d", rang: 4, critere: "criteres" },
      { registrationId: "e", rang: 5, critere: "tirage" },
      { registrationId: "f", rang: 6, critere: "tirage" },
      { registrationId: "g", rang: 7, critere: "direct" },
    ]);
    expect(Object.fromEntries(groupes)).toEqual({ a: 1, b: 2, c: 2, d: 4, e: 4, f: 4, g: 7 });
  });

  // Relecture du 28/09 : la série se propage par le critère « tirage » du rang suivant. Une
  // liste incomplète (filtrée, relue après un désistement) mettait la suite d'une série dans
  // le groupe précédent, d'un autre score : la recherche aurait échangé deux athlètes qui
  // ne sont pas ex æquo.
  it("la tête d'une série manque : sa suite ne rejoint pas le groupe précédent", () => {
    const groupes = groupesDExAequo([
      { registrationId: "a", rang: 1, critere: null },
      { registrationId: "b", rang: 2, critere: "general" },
      { registrationId: "d", rang: 4, critere: "tirage" },
    ]);
    expect(Object.fromEntries(groupes)).toEqual({ a: 1, b: 2, d: 4 });
  });

  it("un rang manque au milieu d'une série : la suite forme son propre groupe", () => {
    // #4 manque : rien ne dit si #5, départagé de #4 par le tirage, est l'ex æquo de #3.
    const groupes = groupesDExAequo([
      { registrationId: "a", rang: 1, critere: null },
      { registrationId: "b", rang: 2, critere: "general" },
      { registrationId: "c", rang: 3, critere: "tirage" },
      { registrationId: "e", rang: 5, critere: "tirage" },
      { registrationId: "f", rang: 6, critere: "tirage" },
    ]);
    expect(Object.fromEntries(groupes)).toEqual({ a: 1, b: 2, c: 2, e: 5, f: 5 });
  });

  it("une liste qui commence après le premier rang : le premier présent ouvre son groupe", () => {
    const groupes = groupesDExAequo([
      { registrationId: "c", rang: 3, critere: "tirage" },
      { registrationId: "d", rang: 4, critere: "tirage" },
      { registrationId: "e", rang: 5, critere: "general" },
    ]);
    expect(Object.fromEntries(groupes)).toEqual({ c: 3, d: 3, e: 5 });
  });
});

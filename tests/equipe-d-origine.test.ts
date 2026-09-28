import { describe, expect, it } from "vitest";
import type { BracketEntry } from "../src/bracket-generator";
import { groupesDExAequo, RANG_SPORTIF_SEEDING_PLAN } from "../src/placement-par-rang";
import { applySeedingPlan, describeSeedingPlan, type SeedingPlan } from "../src/seeding-plan";

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

  it("une entrée sans équipe d'origine ni groupe d'ex æquo laisse le placement de v0.35.0", () => {
    const entries = tableauDuTicket(true).map(
      ({ originTeamId: _o, tieGroup: _g, ...reste }): BracketEntry => reste,
    );
    const avant = applySeedingPlan(entries, 32, SANS_TIRAGE, SANS_RECHERCHE);
    const apres = applySeedingPlan(entries, 32, SANS_TIRAGE, RANG_SPORTIF_SEEDING_PLAN);
    expect(apres.leaves).toEqual(avant.leaves);
    expect(apres.echanges).toEqual(avant.echanges);
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
 * LE VERROU : sur des tableaux tirés au hasard (4 à 40 inscrits, équipes de deux réunies
 * en équipes d'origine, ex æquo par séries), la séparation recherchée :
 * - ne dégrade aucune contrainte du plan, palier par palier ;
 * - ne fait jamais avancer les rencontres de même origine, et les recule souvent ;
 * - ne change aucun tour blanc de main, garde #1 et #2 dans deux moitiés ;
 * - ne change le parcours de personne : dans chaque bloc de chaque tour, les scores
 *   présents (les groupes d'ex æquo) sont exactement ceux d'avant. C'est la forme
 *   vérifiable de « ne pénalise aucun athlète mieux classé ».
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

function tableauAuHasard(n: number, rng: () => number): BracketEntry[] {
  // Les ex æquo : des séries de rangs consécutifs.
  const groupes: number[] = [];
  let tete = 1;
  for (let rang = 1; rang <= n; rang++) {
    if (rang === 1 || rng() < 0.35) tete = rang;
    groupes.push(tete);
  }
  // Des équipes attribuées de deux au plus, réunies par origines de deux ou trois équipes.
  const ordre = Array.from({ length: n }, (_, i) => i + 1).sort(() => rng() - 0.5);
  const equipe = new Map<number, string>();
  const origine = new Map<number, string>();
  let k = 0;
  let o = 0;
  while (k < ordre.length && rng() < 0.85) {
    const equipes = 2 + Math.floor(rng() * 2);
    for (let e = 0; e < equipes && k < ordre.length; e++) {
      const taille = 1 + Math.floor(rng() * 2);
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

const tailleDe = (n: number): number => 2 ** Math.ceil(Math.log2(Math.max(2, n)));

function penalites(feuilles: Feuilles): number[] {
  const out = [0, 0];
  for (let f = 0; f < feuilles.length; f++) {
    for (let g = f + 1; g < feuilles.length; g++) {
      const a = feuilles[f]?.teamId ?? null;
      if (a === null || a !== (feuilles[g]?.teamId ?? null)) continue;
      if (tourDeRencontre(f, g) === 1) out[0]! += 1;
      if (f < feuilles.length / 2 === g < feuilles.length / 2) out[1]! += 1;
    }
  }
  return out;
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

describe("même équipe d'origine : le verrou", () => {
  it("3 000 tableaux au hasard : rien de dégradé, personne de pénalisé, les rencontres reculent", () => {
    const rng = mulberry(20260928);
    let reculs = 0;
    for (let essai = 0; essai < 3000; essai++) {
      const n = 4 + Math.floor(rng() * 37);
      const entries = tableauAuHasard(n, rng);
      const taille = tailleDe(n);
      const avant = applySeedingPlan(entries, taille, SANS_TIRAGE, SANS_RECHERCHE);
      const apres = applySeedingPlan(entries, taille, SANS_TIRAGE, RANG_SPORTIF_SEEDING_PLAN);
      const cas = `essai ${essai}, ${n} inscrits`;

      expect(compare(penalites(apres.leaves), penalites(avant.leaves)), cas).toBeLessThanOrEqual(0);
      const recul = compare(rencontresDOrigine(apres.leaves), rencontresDOrigine(avant.leaves));
      expect(recul, cas).toBeLessThanOrEqual(0);
      if (recul < 0) reculs += 1;
      expect(exemptes(apres.leaves), cas).toEqual(exemptes(avant.leaves));
      const moitieDe = (id: string) => feuilleDe(apres.leaves, id) < taille / 2;
      expect(moitieDe("r1") !== moitieDe("r2"), cas).toBe(true);
      expect(blocs(apres.leaves), cas).toEqual(blocs(avant.leaves));
      // Les échanges de la recherche : entre ex æquo, jamais avec soi-même.
      const groupeDe = new Map(entries.map((e) => [e.registrationId, e.tieGroup] as const));
      for (const e of apres.echanges.slice(avant.echanges.length)) {
        expect(e.contrainte, cas).toBe("meme-equipe-d-origine");
        expect(groupeDe.get(e.deplace), cas).toBe(groupeDe.get(e.avec));
        expect(e.deplace, cas).not.toBe(e.avec);
      }
      expect(apres.echanges.slice(0, avant.echanges.length), cas).toEqual(avant.echanges);
    }
    // Le verrou n'est pas vide : la recherche a réellement éloigné des équipes d'origine.
    expect(reculs).toBeGreaterThan(300);
  });
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
});

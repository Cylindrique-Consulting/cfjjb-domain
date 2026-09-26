import { describe, expect, it } from "vitest";
import {
  ABSOLUT_RANG_SPORTIF_SEEDING_PLAN,
  generateAbsolutBracket,
  type AbsolutRegistration,
} from "../src/absolut-seeding";
import { generateBracket, type BracketEntry } from "../src/bracket-generator";
import { RANG_SPORTIF_SEEDING_PLAN } from "../src/placement-par-rang";
import { applySeedingPlan, type SeedingPlan } from "../src/seeding-plan";

/**
 * LES COÉQUIPIERS NE SE RENCONTRENT QU'EN FINALE, EN PLACEMENT PAR RANG (guide v1.3, §4 à §7).
 *
 * ┌─ CE QUE CES TESTS TIENNENT ───────────────────────────────────────────────┐
 * │ Jusqu'à v0.34.0, le placement par rang ne séparait les coéquipiers qu'au  │
 * │ premier tour : aucune contrainte de moitié, et des tours blancs            │
 * │ intouchables, qui rendaient impossibles le format à trois et l'exception  │
 * │ à cinq du guide. En absolut, la revanche (même catégorie source) passait  │
 * │ avant l'équipe. Balayage de 4 à 32 inscrits : 2 499 paires sur 5 452      │
 * │ restaient dans la même moitié.                                             │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * Le verrou est une recherche exhaustive : pour chaque configuration de paires
 * de coéquipiers, si le guide rend possible un placement qui les sépare toutes,
 * le générateur doit le trouver.
 */

const SANS_TIRAGE = (): number => {
  throw new Error("le placement par rang ne consomme aucun tirage");
};

const tailleDe = (n: number): number => 2 ** Math.ceil(Math.log2(Math.max(2, n)));

type Feuilles = readonly (BracketEntry | null)[];

function entrees(n: number, paires: readonly (readonly number[])[], cle: "team" | "club") {
  const equipe = new Map<number, string>();
  paires.forEach((p, k) => p.forEach((rang) => equipe.set(rang, `T${k}`)));
  return Array.from({ length: n }, (_, i): BracketEntry => {
    const rang = i + 1;
    const e = equipe.get(rang) ?? null;
    return cle === "team"
      ? { registrationId: `r${rang}`, clubId: `c${rang}`, teamId: e, rank: rang }
      : { registrationId: `r${rang}`, clubId: e ?? `c${rang}`, rank: rang };
  });
}

function rangDe(e: BracketEntry): number {
  return Number(e.registrationId.slice(1));
}

function lire(n: number, feuilles: Feuilles, paires: readonly (readonly number[])[]) {
  const moitie = new Map<number, number>();
  const exemptes: number[] = [];
  const vus: number[] = [];
  feuilles.forEach((e, i) => {
    if (e === null) return;
    const rang = rangDe(e);
    vus.push(rang);
    moitie.set(rang, i < feuilles.length / 2 ? 0 : 1);
    if ((feuilles[i ^ 1] ?? null) === null) exemptes.push(rang);
  });
  const tb = feuilles.length - n;
  return {
    violations: paires.filter(([x, y]) => moitie.get(x!) === moitie.get(y!)).length,
    reattribues: exemptes.filter((r) => r > tb).length,
    teteDeSerie: n < 2 || moitie.get(1) !== moitie.get(2),
    protegees: (tb < 1 || exemptes.includes(1)) && (tb < 2 || exemptes.includes(2)),
    complet:
      vus.sort((a, b) => a - b).join(",") === Array.from({ length: n }, (_, i) => i + 1).join(","),
  };
}

/**
 * Ce que le guide rend possible : chaque paire dans deux moitiés opposées (§5), #1 et
 * #2 opposés, au plus un tour blanc réattribué, #1 puis #2 protégés (§4). Dans chaque
 * moitié, les tours blancs vont aux mieux classés présents, le choix qui en réattribue
 * le moins.
 */
function realisable(n: number, paires: readonly (readonly number[])[]): boolean {
  const combatsParMoitie = tailleDe(n) / 4;
  const tb = tailleDe(n) - n;
  const rangs = Array.from({ length: n }, (_, i) => i + 1);
  for (let masque = 0; masque < 1 << n; masque++) {
    const cote = (r: number) => (masque >> (r - 1)) & 1;
    const effectifs = [0, 1].map((m) => rangs.filter((r) => cote(r) === m).length);
    if (effectifs.some((e) => e < combatsParMoitie || e > 2 * combatsParMoitie)) continue;
    if (cote(1) === cote(2)) continue;
    if (paires.some(([x, y]) => cote(x!) === cote(y!))) continue;
    const exemptes = [0, 1].flatMap((m) =>
      rangs.filter((r) => cote(r) === m).slice(0, 2 * combatsParMoitie - effectifs[m]!),
    );
    const protegees = (tb < 1 || exemptes.includes(1)) && (tb < 2 || exemptes.includes(2));
    if (protegees && exemptes.filter((r) => r > tb).length <= 1) return true;
  }
  return false;
}

function configurations(n: number): number[][][] {
  const out: number[][][] = [];
  for (let a = 1; a <= n; a++) for (let b = a + 1; b <= n; b++) out.push([[a, b]]);
  if (n <= 12) {
    for (let a = 1; a <= n; a++)
      for (let b = a + 1; b <= n; b++)
        for (let c = a + 1; c <= n; c++)
          for (let d = c + 1; d <= n; d++) {
            if (c === b || d === b) continue;
            out.push([
              [a, b],
              [c, d],
            ]);
          }
  }
  if (n >= 6 && n <= 9) {
    const trois = (restants: number[], acc: number[][]): void => {
      if (acc.length === 3) {
        out.push(acc);
        return;
      }
      for (let i = 0; i < restants.length; i++)
        for (let j = i + 1; j < restants.length; j++) {
          if (acc.length > 0 && restants[i]! < acc[acc.length - 1]![0]!) continue;
          trois(
            restants.filter((_, k) => k !== i && k !== j),
            [...acc, [restants[i]!, restants[j]!]],
          );
        }
    };
    trois(
      Array.from({ length: n }, (_, i) => i + 1),
      [],
    );
  }
  return out;
}

function balayer(
  plan: SeedingPlan,
  cle: "team" | "club",
): { configurations: number; echecs: string[] } {
  const echecs: string[] = [];
  let total = 0;
  for (let n = 4; n <= 17; n++) {
    for (const paires of configurations(n)) {
      total += 1;
      const sorti = applySeedingPlan(entrees(n, paires, cle), tailleDe(n), SANS_TIRAGE, plan);
      const lu = lire(n, sorti.leaves, paires);
      const nom = `n = ${n}, ${paires.map((p) => p.map((r) => `#${r}`).join("+")).join(" ; ")}`;
      if (!lu.complet) echecs.push(`${nom} : un athlète manque ou apparaît deux fois`);
      if (!lu.teteDeSerie) echecs.push(`${nom} : #1 et #2 dans la même moitié`);
      if (!lu.protegees) echecs.push(`${nom} : #1 ou #2 a perdu son tour blanc`);
      if (lu.reattribues > 1) echecs.push(`${nom} : ${lu.reattribues} tours blancs réattribués`);
      if (lu.violations > 0 && realisable(n, paires)) {
        echecs.push(`${nom} : ${lu.violations} paire(s) dans une même moitié, séparable(s)`);
      }
    }
  }
  return { configurations: total, echecs };
}

describe("recherche exhaustive : tout placement que le guide rend possible est trouvé", () => {
  it("placement par rang : une paire de 4 à 17 inscrits, deux jusqu'à 12, trois de 6 à 9", () => {
    const { configurations: total, echecs } = balayer(RANG_SPORTIF_SEEDING_PLAN, "team");
    expect(total).toBe(6473);
    expect(echecs).toEqual([]);
  });

  it("absolut par rang : les mêmes configurations, l'équipe figée portée par le club", () => {
    const { configurations: total, echecs } = balayer(ABSOLUT_RANG_SPORTIF_SEEDING_PLAN, "club");
    expect(total).toBe(6473);
    expect(echecs).toEqual([]);
  });
});

describe("les exemples du guide v1.3", () => {
  function placer(n: number, paires: readonly (readonly number[])[]) {
    return applySeedingPlan(
      entrees(n, paires, "team"),
      tailleDe(n),
      SANS_TIRAGE,
      RANG_SPORTIF_SEEDING_PLAN,
    );
  }
  const ids = (f: Feuilles) => f.map((e) => e?.registrationId ?? null);

  it("§5 : #1 et #16 coéquipiers, #16 échange avec #15, les rangs affichés ne changent pas", () => {
    const sorti = placer(16, [[1, 16]]);
    const premierTour = (f: Feuilles) =>
      Array.from(
        { length: 8 },
        (_, k) => `${f[2 * k]?.registrationId}/${f[2 * k + 1]?.registrationId}`,
      );
    expect(premierTour(sorti.leaves)).toContain("r1/r15");
    expect(premierTour(sorti.leaves)).toContain("r2/r16");
    expect(sorti.echanges).toEqual([
      { deplace: "r16", avec: "r15", contrainte: "meme-equipe-premier-tour" },
    ]);
    expect(sorti.seedOrder.map((e) => e.rank)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
  });

  it("§4 : à cinq, #4 et #5 coéquipiers donnent les tours blancs #1, #2 et #4 et le combat #3/#5", () => {
    const sorti = placer(5, [[4, 5]]);
    expect(ids(sorti.leaves)).toEqual(["r1", null, "r3", "r5", "r2", null, "r4", null]);
  });

  it("§4 et §5 : à cinq, #1 et #4 d'une équipe, #2 et #5 d'une autre, un seul tour blanc change de main", () => {
    const sorti = placer(5, [
      [1, 4],
      [2, 5],
    ]);
    expect(ids(sorti.leaves)).toEqual(["r1", null, "r3", "r5", "r2", null, "r4", null]);
    expect(
      lire(5, sorti.leaves, [
        [1, 4],
        [2, 5],
      ]),
    ).toMatchObject({ violations: 0, reattribues: 1, protegees: true });
  });

  it("§6 : à trois, #2 et #3 coéquipiers, la 1re demi-finale est #1 contre #3 et #2 attend", () => {
    const tableau = generateBracket(entrees(3, [[2, 3]], "team"), "s", {
      thirdPlaceMode: "shared_bronze",
      seedingPlan: RANG_SPORTIF_SEEDING_PLAN,
    });
    if (tableau.kind !== "bracket") throw new Error("tableau attendu");
    const premiere = tableau.fights.find((f) => f.division === 2 && f.type === "BraketFight");
    const attente = tableau.fights.find((f) => f.type === "BraketFightRepechage3");
    expect([premiere?.slotA, premiere?.slotB].sort()).toEqual(["r1", "r3"]);
    expect(attente?.slotB).toBe("r2");
  });
});

describe("absolut : l'équipe avant la revanche (guide v1.3, §7)", () => {
  const PAR_RANG = { thirdPlaceMode: "shared_bronze", placement: "rang-sportif" } as const;
  const premierTour = (regs: AbsolutRegistration[]) => {
    const tableau = generateAbsolutBracket(regs, "absolut", PAR_RANG);
    if (tableau.kind !== "bracket") throw new Error("tableau attendu");
    const profondeur = Math.max(...tableau.fights.map((f) => f.division));
    return {
      tableau,
      combats: tableau.fights
        .filter((f) => f.division === profondeur && f.type === "BraketFight")
        .map((f) => [f.slotA, f.slotB].sort().join("/")),
    };
  };

  it("#1 et #4 coéquipiers, #3 venu de la catégorie de #1 : les coéquipiers sont séparés, la revanche est acceptée", () => {
    const { tableau, combats } = premierTour([
      { registrationId: "a1", clubId: "EQ-X", sourceCategoryId: "S1", sourcePlace: 1, rank: 1 },
      { registrationId: "a2", clubId: "EQ-Y", sourceCategoryId: "S2", sourcePlace: 1, rank: 2 },
      { registrationId: "a3", clubId: "EQ-Z", sourceCategoryId: "S1", sourcePlace: 2, rank: 3 },
      { registrationId: "a4", clubId: "EQ-X", sourceCategoryId: "S3", sourcePlace: 1, rank: 4 },
    ]);
    expect(combats.sort()).toEqual(["a1/a3", "a2/a4"]);
    expect(tableau.kind === "bracket" && tableau.echanges).toEqual([
      { deplace: "a4", avec: "a3", contrainte: "meme-club-premier-tour" },
    ]);
  });

  it("à trois, #2 et #3 de la même équipe : la 1re demi-finale est #1 contre #3", () => {
    const { combats } = premierTour([
      { registrationId: "b1", clubId: "EQ-X", sourceCategoryId: "S1", sourcePlace: 1, rank: 1 },
      { registrationId: "b2", clubId: "EQ-T", sourceCategoryId: "S2", sourcePlace: 1, rank: 2 },
      { registrationId: "b3", clubId: "EQ-T", sourceCategoryId: "S3", sourcePlace: 1, rank: 3 },
    ]);
    expect(combats).toEqual(["b1/b3"]);
  });
});

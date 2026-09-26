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
  const cedants = Array.from({ length: tb }, (_, i) => i + 1).filter((r) => !exemptes.includes(r));
  return {
    violations: paires.filter(([x, y]) => moitie.get(x!) === moitie.get(y!)).length,
    reattribues: exemptes.filter((r) => r > tb).length,
    cedant: cedants.length > 0 ? Math.min(...cedants) : Number.POSITIVE_INFINITY,
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

/**
 * Le meilleur que le guide permette : le moins de paires dans une même moitié, puis le
 * moins de tours blancs réattribués (« conservés chaque fois que la séparation … le
 * permet »), puis le tour blanc cédé par le moins bien classé possible (§4).
 */
function optimum(
  n: number,
  paires: readonly (readonly number[])[],
): { violations: number; reattribues: number; cedant: number } {
  const combatsParMoitie = tailleDe(n) / 4;
  const tb = tailleDe(n) - n;
  const rangs = Array.from({ length: n }, (_, i) => i + 1);
  let meilleur = {
    violations: Number.POSITIVE_INFINITY,
    reattribues: Number.POSITIVE_INFINITY,
    cedant: -1,
  };
  for (let masque = 0; masque < 1 << n; masque++) {
    const cote = (r: number) => (masque >> (r - 1)) & 1;
    const effectifs = [0, 1].map((m) => rangs.filter((r) => cote(r) === m).length);
    if (effectifs.some((e) => e < combatsParMoitie || e > 2 * combatsParMoitie)) continue;
    if (cote(1) === cote(2)) continue;
    const exemptes = [0, 1].flatMap((m) =>
      rangs.filter((r) => cote(r) === m).slice(0, 2 * combatsParMoitie - effectifs[m]!),
    );
    if ((tb >= 1 && !exemptes.includes(1)) || (tb >= 2 && !exemptes.includes(2))) continue;
    const reattribues = exemptes.filter((r) => r > tb).length;
    if (reattribues > 1) continue;
    const perdus = rangs.filter((r) => r <= tb && !exemptes.includes(r));
    const candidat = {
      violations: paires.filter(([x, y]) => cote(x!) === cote(y!)).length,
      reattribues,
      cedant: perdus.length > 0 ? Math.min(...perdus) : Number.POSITIVE_INFINITY,
    };
    if (
      candidat.violations < meilleur.violations ||
      (candidat.violations === meilleur.violations &&
        (candidat.reattribues < meilleur.reattribues ||
          (candidat.reattribues === meilleur.reattribues && candidat.cedant > meilleur.cedant)))
    ) {
      meilleur = candidat;
    }
  }
  return meilleur;
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
  if (n >= 8 && n <= 10) {
    const quatre = (restants: number[], acc: number[][]): void => {
      if (acc.length === 4) {
        out.push(acc);
        return;
      }
      for (let i = 0; i < restants.length; i++)
        for (let j = i + 1; j < restants.length; j++) {
          if (acc.length > 0 && restants[i]! < acc[acc.length - 1]![0]!) continue;
          quatre(
            restants.filter((_, k) => k !== i && k !== j),
            [...acc, [restants[i]!, restants[j]!]],
          );
        }
    };
    quatre(
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
      if (lu.violations > 0 || lu.reattribues > 0) {
        const mieux = optimum(n, paires);
        if (lu.violations > mieux.violations) {
          echecs.push(
            `${nom} : ${lu.violations} paire(s) réunie(s), ${mieux.violations} possible(s)`,
          );
        } else if (lu.reattribues > mieux.reattribues) {
          echecs.push(`${nom} : un tour blanc réattribué sans nécessité`);
        } else if (lu.reattribues === 1 && lu.cedant < mieux.cedant) {
          echecs.push(`${nom} : #${lu.cedant} cède son tour blanc, #${mieux.cedant} le pouvait`);
        }
      }
    }
  }
  return { configurations: total, echecs };
}

describe("recherche exhaustive : tout placement que le guide rend possible est trouvé", () => {
  it("placement par rang : une paire de 4 à 17 inscrits, deux jusqu'à 12, trois de 6 à 9, quatre de 8 à 10", () => {
    const { configurations: total, echecs } = balayer(RANG_SPORTIF_SEEDING_PLAN, "team");
    expect(total).toBe(12248);
    expect(echecs).toEqual([]);
  });

  it("absolut par rang : les mêmes configurations, l'équipe figée portée par le club", () => {
    const { configurations: total, echecs } = balayer(ABSOLUT_RANG_SPORTIF_SEEDING_PLAN, "club");
    expect(total).toBe(12248);
    expect(echecs).toEqual([]);
  });

  // Guide v1.3, §7 : la revanche n'est évitée que « si elle ne pénalise aucun mieux classé
  // et respecte toutes les séparations impératives ». Sur les mêmes configurations, avec des
  // catégories sources qui se croisent, l'absolut garde exactement les tours blancs et la
  // séparation d'équipe du même plan sans revanche.
  it("absolut par rang : la revanche ne change ni un tour blanc ni la séparation d'équipe", () => {
    const sansRevanche: SeedingPlan = {
      ...ABSOLUT_RANG_SPORTIF_SEEDING_PLAN,
      constraints: ABSOLUT_RANG_SPORTIF_SEEDING_PLAN.constraints.filter(
        (c) => c.key !== "source-category",
      ),
    };
    const echecs: string[] = [];
    for (let n = 4; n <= 12; n++) {
      for (const paires of configurations(n)) {
        for (const variante of [0, 1, 2]) {
          const avecSources = entrees(n, paires, "club").map((e) => ({
            ...e,
            sourceCategoryId: `s${(rangDe(e) * (variante + 2) + variante) % 3}`,
          }));
          const avec = applySeedingPlan(
            avecSources,
            tailleDe(n),
            SANS_TIRAGE,
            ABSOLUT_RANG_SPORTIF_SEEDING_PLAN,
          );
          const sans = applySeedingPlan(avecSources, tailleDe(n), SANS_TIRAGE, sansRevanche);
          const a = lire(n, avec.leaves, paires);
          const b = lire(n, sans.leaves, paires);
          const exemptes = (f: Feuilles) =>
            f
              .filter((e, i) => e !== null && (f[i ^ 1] ?? null) === null)
              .map((e) => e!.registrationId)
              .sort()
              .join(",");
          if (a.violations !== b.violations || exemptes(avec.leaves) !== exemptes(sans.leaves)) {
            echecs.push(`n = ${n}, ${JSON.stringify(paires)}, variante ${variante}`);
          }
        }
      }
    }
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

  // Relevé en revue le 26/09 : réparée avant les moitiés, la revanche laissait deux
  // coéquipiers dans une même moitié, ou faisait perdre un tour blanc pour rien.
  const dix = (clubs: readonly string[], sources: readonly string[]): AbsolutRegistration[] =>
    clubs.map((clubId, i) => ({
      registrationId: `r${i + 1}`,
      clubId,
      sourceCategoryId: sources[i]!,
      rank: i + 1,
    }));
  const exemptesEtMoities = (regs: AbsolutRegistration[]) => {
    const t = generateAbsolutBracket(regs, "absolut", PAR_RANG);
    if (t.kind !== "bracket") throw new Error("tableau attendu");
    const profondeur = Math.max(...t.fights.map((f) => f.division));
    const feuilles = t.fights
      .filter((f) => f.division === profondeur && f.type === "BraketFight")
      .sort((a, b) => a.indexInDivision - b.indexInDivision)
      .flatMap((f) => [f.slotA, f.slotB]);

    const moitie = (id: string) => (feuilles.indexOf(id) < feuilles.length / 2 ? 0 : 1);
    const reunies = [...new Set(regs.map((r) => r.clubId))].filter((c) => {
      const ids = regs.filter((r) => r.clubId === c).map((r) => r.registrationId);
      return ids.length === 2 && moitie(ids[0]!) === moitie(ids[1]!);
    });
    const exemptes = feuilles
      .filter((id, i) => id !== null && feuilles[i ^ 1] === null)
      .map((id) => id as string)
      .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
    return { reunies, exemptes };
  };

  it("dix inscrits, cinq paires : la revanche ne garde aucune paire de coéquipiers dans une même moitié", () => {
    const { reunies, exemptes } = exemptesEtMoities(
      dix(
        ["T1", "T2", "T0", "T3", "T4", "T2", "T3", "T0", "T4", "T1"],
        ["S1", "S2", "S2", "S1", "S0", "S0", "S1", "S0", "S0", "S1"],
      ),
    );
    expect(reunies).toEqual([]);
    expect(exemptes).toEqual(["r1", "r2", "r3", "r4", "r5", "r6"]);
  });

  it("dix inscrits : la revanche ne fait perdre aucun tour blanc", () => {
    const { reunies, exemptes } = exemptesEtMoities(
      dix(
        ["T1", "T0", "solo3", "T2", "T3", "solo6", "T3", "T1", "T2", "T0"],
        ["S2", "S2", "S1", "S2", "S1", "S0", "S3", "S0", "S0", "S3"],
      ),
    );
    expect(reunies).toEqual([]);
    expect(exemptes).toEqual(["r1", "r2", "r3", "r4", "r5", "r6"]);
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

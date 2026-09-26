import { describe, expect, it } from "vitest";
import {
  absolutEntries,
  absolutSeedOrder,
  ABSOLUT_SEEDING_PLAN,
  generateAbsolutBracket,
  sourceWeightRank,
  type AbsolutRegistration,
} from "../src/absolut-seeding";
import { fnv1a, mulberry32 } from "../src/prng";
import { applySeedingPlan, separationKeyOf, type SeedingPlan } from "../src/seeding-plan";
import type { BracketEntry, GeneratedFight } from "../src/bracket-generator";

function sizeFor(n: number): number {
  return 2 ** Math.ceil(Math.log2(Math.max(2, n)));
}

function pipeline(
  regs: readonly AbsolutRegistration[],
  seed = "absolut",
  plan = ABSOLUT_SEEDING_PLAN,
) {
  const entries = absolutEntries(regs);
  return applySeedingPlan(entries, sizeFor(entries.length), mulberry32(fnv1a(seed)), plan);
}

function ids(leaves: readonly (BracketEntry | null)[]): (string | null)[] {
  return leaves.map((l) => l?.registrationId ?? null);
}

function pairCount(
  leaves: readonly (BracketEntry | null)[],
  block: number,
  key: "club" | "source-category",
): number {
  let pairs = 0;
  for (let start = 0; start < leaves.length; start += block) {
    const counts = new Map<string, number>();
    for (let l = start; l < Math.min(leaves.length, start + block); l++) {
      const k = separationKeyOf(leaves[l] ?? null, key);
      if (k !== null) counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    for (const n of counts.values()) pairs += (n * (n - 1)) / 2;
  }
  return pairs;
}

function firstRoundLeaves(fights: readonly GeneratedFight[]): (string | null)[] {
  const regular = fights.filter((f) => f.type === "BraketFight");
  const deepest = Math.max(...regular.map((f) => f.division));
  return regular
    .filter((f) => f.division === deepest)
    .sort((a, b) => a.indexInDivision - b.indexInDivision)
    .flatMap((f) => [f.slotA, f.slotB]);
}

const ABSOLUT_NOIRE: AbsolutRegistration[] = [
  {
    registrationId: "leve-2",
    clubId: "club-lyon",
    sourceCategoryId: "cat-leve",
    sourcePlace: 2,
    sourceWeightClass: "Leve",
  },
  {
    registrationId: "pesadissimo-1",
    clubId: "club-paris",
    sourceCategoryId: "cat-pesadissimo",
    sourcePlace: 1,
    sourceWeightClass: "Pesadissimo",
  },
  {
    registrationId: "sans-podium-b",
    clubId: "club-nice",
    sourceCategoryId: null,
    sourcePlace: null,
    sourceWeightClass: null,
  },
  {
    registrationId: "medio-1",
    clubId: "club-brest",
    sourceCategoryId: "cat-medio",
    sourcePlace: 1,
    sourceWeightClass: "Medio",
  },
  {
    registrationId: "pesado-2",
    clubId: "club-lille",
    sourceCategoryId: "cat-pesado",
    sourcePlace: 2,
    sourceWeightClass: "Pesado",
  },
  {
    registrationId: "leve-1",
    clubId: "club-rennes",
    sourceCategoryId: "cat-leve",
    sourcePlace: 1,
    sourceWeightClass: "Leve",
  },
  {
    registrationId: "medio-2",
    clubId: "club-dijon",
    sourceCategoryId: "cat-medio",
    sourcePlace: 2,
    sourceWeightClass: "Medio",
  },
  {
    registrationId: "pesado-1",
    clubId: "club-tours",
    sourceCategoryId: "cat-pesado",
    sourcePlace: 1,
    sourceWeightClass: "Pesado",
  },
  {
    registrationId: "sans-podium-a",
    clubId: "club-caen",
    sourceCategoryId: null,
    sourcePlace: null,
    sourceWeightClass: null,
  },
  {
    registrationId: "pesadissimo-2",
    clubId: "club-metz",
    sourceCategoryId: "cat-pesadissimo",
    sourcePlace: 2,
    sourceWeightClass: "Pesadissimo",
  },
];

describe("absolut : l'ordre des graines suit la place source, puis le poids", () => {
  it("toutes les premières places passent devant toutes les deuxièmes", () => {
    const order = absolutSeedOrder(ABSOLUT_NOIRE).map((r) => r.sourcePlace);
    const premieres = order.filter((p) => p === 1).length;
    expect(
      order.slice(0, premieres).every((p) => p === 1),
      "un deuxième s'est glissé devant un premier de sa catégorie",
    ).toBe(true);
    expect(
      order.slice(premieres, premieres * 2).every((p) => p === 2),
      "les deuxièmes places ne suivent pas immédiatement les premières",
    ).toBe(true);
  });

  it("à place égale, la catégorie de poids la plus LOURDE passe devant", () => {
    const order = absolutSeedOrder(ABSOLUT_NOIRE).map((r) => r.registrationId);
    expect(order.slice(0, 4), "les premières places, du plus lourd au plus léger").toEqual([
      "pesadissimo-1",
      "pesado-1",
      "medio-1",
      "leve-1",
    ]);
    expect(order.slice(4, 8), "les deuxièmes places, du plus lourd au plus léger").toEqual([
      "pesadissimo-2",
      "pesado-2",
      "medio-2",
      "leve-2",
    ]);
  });

  it("une place source ABSENTE passe derrière tous les médaillés", () => {
    const order = absolutSeedOrder(ABSOLUT_NOIRE).map((r) => r.registrationId);
    expect(
      order.slice(8),
      "les ceintures noires entrées sans podium ferment la marche, dans l'ordre d'arrivée",
    ).toEqual(["sans-podium-b", "sans-podium-a"]);
  });

  it("un poids source ILLISIBLE est traité comme le plus léger, jamais comme le plus lourd", () => {
    const regs: AbsolutRegistration[] = [
      {
        registrationId: "inconnu",
        sourceCategoryId: "cat-x",
        sourcePlace: 1,
        sourceWeightClass: "500",
      },
      {
        registrationId: "galo",
        sourceCategoryId: "cat-galo",
        sourcePlace: 1,
        sourceWeightClass: "Galo",
      },
    ];
    expect(
      absolutSeedOrder(regs).map((r) => r.registrationId),
      "un poids illisible ne doit pas offrir la meilleure graine faute d'information",
    ).toEqual(["galo", "inconnu"]);
  });

  it("l'ordre des graines ne dépend pas de l'ordre de LECTURE", () => {
    const attendu = absolutSeedOrder(ABSOLUT_NOIRE).map((r) => r.registrationId);
    const inverse = absolutSeedOrder([...ABSOLUT_NOIRE].reverse()).map((r) => r.registrationId);
    expect(attendu.slice(0, 8), "les médaillés sont totalement ordonnés").toEqual(
      inverse.slice(0, 8),
    );
  });

  it("le placement standard donne les byes aux meilleures graines", () => {
    const outcome = pipeline(ABSOLUT_NOIRE);
    const size = sizeFor(10);
    expect(size).toBe(16);
    const holders: string[] = [];
    for (let f = 0; 2 * f + 1 < size; f++) {
      const a = outcome.placement[2 * f] ?? null;
      const b = outcome.placement[2 * f + 1] ?? null;
      if (a === null && b !== null) holders.push(b.registrationId);
      if (b === null && a !== null) holders.push(a.registrationId);
    }
    expect(
      holders.sort(),
      "les six byes vont aux six meilleures graines, c'est-à-dire aux six meilleures places sources",
    ).toEqual(
      ["pesadissimo-1", "pesado-1", "medio-1", "leve-1", "pesadissimo-2", "pesado-2"].sort(),
    );
  });

  it("le rang de poids lit les DEUX vocabulaires de la colonne", () => {
    expect(sourceWeightRank("Leve"), "le nom écrit par la plateforme").toBe(3);
    expect(sourceWeightRank("3"), "l'indice hérité de l'ETL").toBe(3);
    expect(sourceWeightRank("Pesadissimo"), "la plus lourde ferme la liste").toBe(8);
    expect(sourceWeightRank("Galo"), "la plus légère ouvre la liste").toBe(0);
    expect(sourceWeightRank("500"), "un kilo hors référentiel n'est pas un rang").toBe(null);
    expect(sourceWeightRank(null), "l'absence n'est pas le rang 0").toBe(null);
  });
});

const TROIS_SOURCES: AbsolutRegistration[] = [
  {
    registrationId: "a1",
    clubId: "club-a1",
    sourceCategoryId: "cat-a",
    sourcePlace: 1,
    sourceWeightClass: "Pesado",
  },
  {
    registrationId: "a2",
    clubId: "club-a2",
    sourceCategoryId: "cat-a",
    sourcePlace: 2,
    sourceWeightClass: "Pesado",
  },
  {
    registrationId: "b1",
    clubId: "club-b1",
    sourceCategoryId: "cat-b",
    sourcePlace: 1,
    sourceWeightClass: "Medio",
  },
  {
    registrationId: "b2",
    clubId: "club-b2",
    sourceCategoryId: "cat-b",
    sourcePlace: 2,
    sourceWeightClass: "Medio",
  },
  {
    registrationId: "c1",
    clubId: "club-c1",
    sourceCategoryId: "cat-c",
    sourcePlace: 1,
    sourceWeightClass: "Leve",
  },
  {
    registrationId: "c2",
    clubId: "club-c2",
    sourceCategoryId: "cat-c",
    sourcePlace: 2,
    sourceWeightClass: "Leve",
  },
];

describe("absolut : deux médaillés d'une même catégorie source ne se retrouvent pas au premier tour", () => {
  it("le placement standard PRODUIT l'appariement interdit, la réparation le défait", () => {
    const outcome = pipeline(TROIS_SOURCES);
    expect(
      pairCount(outcome.placement, 2, "source-category"),
      "sans réparation, c1 et c2 rejouent leur finale au premier tour de l'absolut",
    ).toBe(1);
    expect(
      pairCount(outcome.leaves, 2, "source-category"),
      "après réparation, plus aucun combat du premier tour n'oppose deux médaillés de la même source",
    ).toBe(0);
  });

  it("la réparation paie le prix en places, et ce prix est MESURÉ", () => {
    const outcome = pipeline(TROIS_SOURCES);
    expect(ids(outcome.placement), "le placement standard, avant réparation").toEqual([
      "a1",
      null,
      "a2",
      "b2",
      "b1",
      null,
      "c1",
      "c2",
    ]);
    expect(ids(outcome.leaves), "après réparation").toEqual([
      "c1",
      null,
      "a2",
      "b2",
      "b1",
      null,
      "a1",
      "c2",
    ]);
  });

  it("balayage : dès qu'il y a deux catégories sources, la séparation est TOTALE", () => {
    const poids = [
      "Galo",
      "Pluma",
      "Pena",
      "Leve",
      "Medio",
      "Meio Pesado",
      "Pesado",
      "Super Pesado",
      "Pesadissimo",
    ];
    const echecs: string[] = [];
    for (let cats = 2; cats <= 8; cats++) {
      for (let places = 1; places <= 3; places++) {
        const regs: AbsolutRegistration[] = [];
        for (let c = 0; c < cats; c++) {
          for (let p = 1; p <= places; p++) {
            regs.push({
              registrationId: "cat" + c + "-p" + p,
              clubId: "club-" + c + "-" + p,
              sourceCategoryId: "cat-" + c,
              sourcePlace: p,
              sourceWeightClass: poids[8 - c] ?? null,
            });
          }
        }
        if (regs.length < 2) continue;
        const restant = pairCount(pipeline(regs).leaves, 2, "source-category");
        if (restant !== 0) echecs.push(cats + " sources x " + places + " places : " + restant);
      }
    }
    expect(echecs, "aucune forme d'absolut ne doit garder un appariement de même source").toEqual(
      [],
    );
  });

  it("une source UNIQUE reste un rejeu, et le pipeline ne le cache pas", () => {
    const podium: AbsolutRegistration[] = [
      {
        registrationId: "seul-1",
        sourceCategoryId: "cat-a",
        sourcePlace: 1,
        sourceWeightClass: "Pesado",
      },
      {
        registrationId: "seul-2",
        sourceCategoryId: "cat-a",
        sourcePlace: 2,
        sourceWeightClass: "Pesado",
      },
    ];
    expect(pairCount(pipeline(podium).leaves, 2, "source-category")).toBe(1);
  });

  // GUIDE v1.3, §7 : la revanche immédiate n'est évitée « que si elle ne pénalise aucun
  // mieux classé et respecte toutes les séparations impératives ». Jusqu'à v0.34.0, elle
  // passait au palier 0, avant l'équipe : #1 et #4 coéquipiers, #3 venu de la catégorie de
  // #1, l'échange qui les séparait était refusé.
  it("la règle est exprimée DANS LE PIPELINE, au dernier palier : l'équipe passe avant", () => {
    const actives = ABSOLUT_SEEDING_PLAN.constraints.filter((c) => c.enabled);
    const separation = actives.find((c) => c.key === "source-category");
    expect(
      separation,
      "la séparation de catégorie source doit être une contrainte du plan",
    ).toBeDefined();
    expect(separation?.scope, "elle porte sur le combat du premier tour").toEqual({
      kind: "round",
      round: 1,
    });
    expect(separation?.tier, "dernier palier : l'équipe attribuée passe avant la revanche").toBe(
      Math.max(...actives.map((c) => c.tier)),
    );
    expect(
      Math.max(...actives.filter((c) => c.key === "club").map((c) => c.tier)),
      "toutes les séparations d'équipe restent actives, et avant",
    ).toBeLessThan(separation?.tier ?? -1);
  });

  it("l'anti-club reste tenu, sans entrelacement", () => {
    const memeClub: AbsolutRegistration[] = TROIS_SOURCES.map((r) => ({
      ...r,
      clubId: r.registrationId.endsWith("1") ? "club-alpha" : "club-beta",
    }));
    expect(
      pairCount(pipeline(memeClub).leaves, 2, "club"),
      "trois clubmates dans huit feuilles se séparent sans toucher à l'ordre des graines",
    ).toBe(0);
  });
});

describe("absolut : deux coéquipiers ne se retrouvent qu'en finale", () => {
  const POIDS = ["Pesadissimo", "Super Pesado", "Pesado", "Meio Pesado", "Medio", "Leve"];
  // Douze médaillés de six catégories : les graines 1 et 4 viennent de la même entité.
  // Le placement standard les met dans la même moitié, dans deux quarts différents : la
  // contrainte de quart de tableau ne les voit pas, et elles se retrouvaient en demi-finale.
  const DOUZE: AbsolutRegistration[] = Array.from({ length: 12 }, (_, i) => ({
    registrationId: `p${i + 1}`,
    clubId: i === 0 || i === 3 ? "entite-x" : `club-${i + 1}`,
    sourceCategoryId: `cat-${i % 6}`,
    sourcePlace: i < 6 ? 1 : 2,
    sourceWeightClass: POIDS[i % 6] ?? null,
  }));

  const sansMoitie: SeedingPlan = {
    ...ABSOLUT_SEEDING_PLAN,
    constraints: ABSOLUT_SEEDING_PLAN.constraints.filter((c) => c.scope.kind !== "half"),
  };

  function moitieDe(leaves: readonly (BracketEntry | null)[], id: string): number {
    const i = leaves.findIndex((l) => l?.registrationId === id);
    return i < leaves.length / 2 ? 0 : 1;
  }

  it("le placement standard les met dans la même moitié, la réparation les sépare", () => {
    expect(ids(pipeline(DOUZE).seedOrder as BracketEntry[]).slice(0, 4)).toEqual([
      "p1",
      "p2",
      "p3",
      "p4",
    ]);
    const avant = pipeline(DOUZE, "absolut", sansMoitie);
    expect(moitieDe(avant.leaves, "p1"), "sans la contrainte de moitié").toBe(
      moitieDe(avant.leaves, "p4"),
    );
    const apres = pipeline(DOUZE);
    expect(moitieDe(apres.leaves, "p1")).not.toBe(moitieDe(apres.leaves, "p4"));
    expect(pairCount(apres.leaves, 2, "source-category")).toBe(0);
    expect(pairCount(apres.leaves, 4, "club")).toBe(0);
  });

  it("balayage : deux coéquipiers de catégories différentes finissent toujours dans deux moitiés", () => {
    const echecs: string[] = [];
    for (let n = 2; n <= 40; n++) {
      for (let graine = 0; graine < 10; graine++) {
        const rng = mulberry32(fnv1a(`moitie|${n}|${graine}`));
        const entites: string[] = [];
        for (let i = 0; i < n; i++) {
          const precedente = entites[i - 1];
          const enPaire =
            precedente !== undefined && entites.filter((e) => e === precedente).length < 2;
          entites.push(enPaire && rng() < 0.4 ? precedente : `e${i}`);
        }
        const regs: AbsolutRegistration[] = entites.map((entite, i) => ({
          registrationId: `r${i}`,
          clubId: entite,
          sourceCategoryId: null,
          sourcePlace: 1 + Math.floor(rng() * 3),
          sourceWeightClass: POIDS[Math.floor(rng() * POIDS.length)] ?? null,
        }));
        const leaves = pipeline(regs).leaves;
        const restant = pairCount(leaves, leaves.length / 2, "club");
        if (restant !== 0) echecs.push(`n = ${n}, graine ${graine} : ${restant}`);
      }
    }
    expect(echecs).toEqual([]);
  });

  // GUIDE v1.3, §5 : la séparation par moitié est impérative, le quart ne l'est pas, et la
  // revanche vient en dernier (§7). La moitié suit donc directement le premier tour.
  it("la moitié d'équipe suit le premier tour, avant le quart et la revanche", () => {
    const actives = ABSOLUT_SEEDING_PLAN.constraints.filter((c) => c.enabled);
    const palier = (name: string) => actives.find((c) => c.name === name)?.tier;
    expect(actives.find((c) => c.scope.kind === "half")).toMatchObject({
      name: "meme-club-meme-moitie",
      key: "club",
      tier: 1,
    });
    expect(palier("meme-club-premier-tour")).toBe(0);
    expect(palier("meme-club-quart-de-tableau")).toBe(2);
    expect(palier("meme-categorie-source-premier-tour")).toBe(3);
    expect(actives.filter((c) => c.tier === 1)).toHaveLength(1);
  });
});

describe("absolut : un classement, pas un tirage", () => {
  it("l'entrelacement anti-club est ÉTEINT, sans quoi il détruirait l'ordre par place", () => {
    expect(
      ABSOLUT_SEEDING_PLAN.order.filter((s) => s.enabled).map((s) => s.kind),
      "seul l'ordre par place source ordonne un absolut",
    ).toEqual(["source-place"]);
  });

  it("deux graines de compétition différentes rendent le MÊME absolut", () => {
    const a = generateAbsolutBracket(ABSOLUT_NOIRE, "graine-A", { thirdPlaceMode: "pool3" });
    const b = generateAbsolutBracket(ABSOLUT_NOIRE, "graine-B", { thirdPlaceMode: "pool3" });
    if (a.kind !== "bracket" || b.kind !== "bracket") throw new Error("tableau attendu");
    expect(
      firstRoundLeaves(b.fights),
      "un absolut se conteste avec un classement, pas avec une graine",
    ).toEqual(firstRoundLeaves(a.fights));
  });

  it("mélanger AVANT le classement ne déplace que les ÉGALITÉS", () => {
    const avecMelange: SeedingPlan = {
      ...ABSOLUT_SEEDING_PLAN,
      order: ABSOLUT_SEEDING_PLAN.order.map((s) =>
        s.kind === "interleave" ? { ...s, enabled: true } : s,
      ),
    };
    const reference = absolutSeedOrder(ABSOLUT_NOIRE).map((r) => r.registrationId);
    const egalitesDeplacees: string[] = [];
    for (const graine of ["a", "b", "c", "d", "e", "f", "g", "h", "graine-1", "graine-2"]) {
      const ordre = pipeline(ABSOLUT_NOIRE, graine, avecMelange).seedOrder.map(
        (e) => e.registrationId,
      );
      expect(
        ordre.slice(0, 8),
        "les huit médaillés sont totalement ordonnés : aucun mélange ne peut les déplacer",
      ).toEqual(reference.slice(0, 8));
      if (ordre.join(",") !== reference.join(",")) egalitesDeplacees.push(graine);
    }
    expect(
      egalitesDeplacees.length,
      "les deux ceintures noires sans podium sont à égalité complète : là, et là seulement, le tirage tranche",
    ).toBeGreaterThan(0);
  });

  it("mélanger APRÈS le classement le DÉTRUIT : l'ordre des étapes est portant", () => {
    const melangeApres: SeedingPlan = {
      ...ABSOLUT_SEEDING_PLAN,
      order: [
        { kind: "source-place", enabled: true },
        { kind: "interleave", enabled: true, key: "club" },
      ],
    };
    const ordre = pipeline(ABSOLUT_NOIRE, "graine", melangeApres).seedOrder.map(
      (e) => e.registrationId,
    );
    expect(
      ordre.slice(0, 4).every((id) => id.endsWith("-1")),
      "un entrelacement postérieur remet des deuxièmes places en tête de série",
    ).toBe(false);
  });

  it("le tableau généré et le pipeline seul rendent les mêmes feuilles", () => {
    const result = generateAbsolutBracket(ABSOLUT_NOIRE, "graine", { thirdPlaceMode: "pool3" });
    if (result.kind !== "bracket") throw new Error("tableau attendu");
    expect(
      firstRoundLeaves(result.fights),
      "le générateur n'a pas de placement à lui : il pose l'arbre autour des feuilles du pipeline",
    ).toEqual(ids(pipeline(ABSOLUT_NOIRE, "graine").leaves));
  });
});

describe("absolut : les désistements ne montent pas sur le tatami", () => {
  it("une inscription ANNULÉE n'est ni ordonnée ni placée", () => {
    const avecDesistement: AbsolutRegistration[] = [
      ...TROIS_SOURCES,
      {
        registrationId: "desiste",
        clubId: "club-z",
        sourceCategoryId: "cat-z",
        sourcePlace: 1,
        sourceWeightClass: "Pesadissimo",
        status: "cancelled",
      },
    ];
    expect(
      absolutSeedOrder(avecDesistement).map((r) => r.registrationId),
      "le désisté serait la GRAINE 1 (premier du plus lourd) : l'oublier ne se verrait pas",
    ).not.toContain("desiste");
    const result = generateAbsolutBracket(avecDesistement, "graine", { thirdPlaceMode: "pool3" });
    if (result.kind !== "bracket") throw new Error("tableau attendu");
    expect(firstRoundLeaves(result.fights)).not.toContain("desiste");
  });

  it("une inscription sans statut est ACTIVE : la colonne a un défaut, pas un trou", () => {
    expect(absolutEntries([{ registrationId: "x" }]).map((e) => e.registrationId)).toEqual(["x"]);
  });
});

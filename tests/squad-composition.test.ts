import { describe, expect, it } from "vitest";
import {
  autoComposeSquads,
  isSquadWindowOpen,
  squadCompositionDeadline,
  squadTeamId,
  SQUAD_LETTERS,
  SQUAD_SEEDING_PLAN,
  SQUAD_WINDOW_HOURS_DEFAULT,
  type SquadCandidate,
  type SquadLetter,
} from "../src/squad-composition";
import type { BracketEntry } from "../src/bracket-generator";
import { fnv1a, mulberry32 } from "../src/prng";
import { applySeedingPlan, DEFAULT_SEEDING_PLAN, separationKeyOf } from "../src/seeding-plan";

// ===================================================================
// Outils de lecture
// ===================================================================

function candidats(
  clubId: string,
  categoryKey: string,
  n: number,
  prefixe = "reg",
): SquadCandidate[] {
  const out: SquadCandidate[] = [];
  for (let i = 0; i < n; i++) {
    out.push({ registrationId: prefixe + "-" + i, clubId, categoryKey });
  }
  return out;
}

/** Les lettres attribuées, par inscription. C'est la SORTIE qui doit être stable. */
function lettres(
  candidats: readonly SquadCandidate[],
  seed: string,
): Map<string, SquadLetter | undefined> {
  const composition = autoComposeSquads(candidats, seed);
  return new Map(composition.assignments.map((a) => [a.registrationId, a.letter]));
}

/** Combien de fois chaque lettre est utilisée, dans l'ordre A, B, C. */
function charge(candidats: readonly SquadCandidate[], seed: string): number[] {
  const posees = [...lettres(candidats, seed).values()];
  return SQUAD_LETTERS.map((l) => posees.filter((x) => x === l).length);
}

/** Permutation déterministe d'une liste, pour rejouer la MÊME population lue autrement. */
function permute<T>(items: readonly T[], seed: string): T[] {
  const rng = mulberry32(fnv1a(seed));
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

function pairCount(
  leaves: readonly (BracketEntry | null)[],
  block: number,
  key: "club" | "team",
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

// ===================================================================
// LA RÈGLE : répartition équilibrée par catégorie
// ===================================================================

describe("équipes A/B/C : la répartition est équilibrée, catégorie par catégorie", () => {
  it("trois combattants d'un club dans une catégorie vont en A, B et C", () => {
    const posees = [
      ...lettres(candidats("club-marseille", "noire-adulte-h-leve", 3), "g1").values(),
    ];
    expect(
      [...posees].sort(),
      "trois combattants, trois lettres : c'est ce qui les fait se rencontrer le plus tard possible",
    ).toEqual(["A", "B", "C"]);
  });

  it("deux combattants vont en A et B", () => {
    expect([...lettres(candidats("club-lyon", "cat", 2), "g1").values()].sort()).toEqual([
      "A",
      "B",
    ]);
  });

  it("un combattant seul prend A", () => {
    expect([...lettres(candidats("club-lyon", "cat", 1), "g1").values()]).toEqual(["A"]);
  });

  it("AU-DELÀ DE TROIS, les lettres tournent plutôt que de refuser de composer", () => {
    expect(charge(candidats("club-lyon", "cat", 4), "g1"), "quatre : A, B, C, puis A").toEqual([
      2, 1, 1,
    ]);
    expect(charge(candidats("club-lyon", "cat", 5), "g1"), "cinq").toEqual([2, 2, 1]);
    expect(charge(candidats("club-lyon", "cat", 7), "g1"), "sept").toEqual([3, 2, 2]);
    // Le refus aurait rendu à un club la capacité de bloquer la génération,
    // c'est-à-dire exactement ce que le délai ferme vient de lui retirer.
  });

  it("l'équilibre se calcule PAR CATÉGORIE, pas par club", () => {
    const mixte = [
      ...candidats("club-lyon", "cat-leve", 2, "leve"),
      ...candidats("club-lyon", "cat-medio", 2, "medio"),
    ];
    const posees = lettres(mixte, "g1");
    const parCategorie = (p: string) =>
      [...posees.entries()]
        .filter(([id]) => id.startsWith(p))
        .map(([, l]) => l)
        .sort();
    expect(parCategorie("leve"), "deux Leve : A et B").toEqual(["A", "B"]);
    expect(
      parCategorie("medio"),
      "deux Medio : A et B aussi - un club a bien une équipe A par catégorie",
    ).toEqual(["A", "B"]);
  });

  it("deux clubs ne se partagent pas les lettres", () => {
    const deuxClubs = [
      ...candidats("club-lyon", "cat", 2, "lyon"),
      ...candidats("club-nice", "cat", 2, "nice"),
    ];
    const posees = lettres(deuxClubs, "g1");
    const du = (p: string) =>
      [...posees.entries()]
        .filter(([id]) => id.startsWith(p))
        .map(([, l]) => l)
        .sort();
    expect(du("lyon")).toEqual(["A", "B"]);
    expect(du("nice"), "le A de Nice n'est pas le A de Lyon").toEqual(["A", "B"]);
  });

  it("les équipes à créer sont rendues, une par (club, lettre)", () => {
    const composition = autoComposeSquads(
      [...candidats("club-lyon", "cat", 3, "lyon"), ...candidats("club-nice", "cat", 2, "nice")],
      "g1",
    );
    expect(composition.squads.map((s) => squadTeamId(s.clubId, s.letter)).sort()).toEqual([
      "club-lyon#A",
      "club-lyon#B",
      "club-lyon#C",
      "club-nice#A",
      "club-nice#B",
    ]);
  });
});

// ===================================================================
// DÉTERMINISME
// ===================================================================

describe("équipes A/B/C : la composition est reproductible, et l'ordre de lecture n'y entre pas", () => {
  const POPULATION: SquadCandidate[] = [
    ...candidats("club-lyon", "cat-leve", 4, "lyon-leve"),
    ...candidats("club-lyon", "cat-medio", 2, "lyon-medio"),
    ...candidats("club-nice", "cat-leve", 3, "nice-leve"),
    ...candidats("club-brest", "cat-leve", 1, "brest-leve"),
  ];

  it("la même graine rend la même composition, quel que soit l'ORDRE DE LECTURE", () => {
    const reference = lettres(POPULATION, "graine-2026");
    const distinctes = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const melangee = permute(POPULATION, "permutation-" + i);
      const rejouee = lettres(melangee, "graine-2026");
      distinctes.add(
        [...reference.keys()]
          .map((id) => id + "=" + String(rejouee.get(id)))
          .sort()
          .join(","),
      );
    }
    expect(
      distinctes.size,
      "une lecture PostgREST ne garantit aucun ordre : 50 ordres de lecture doivent donner UNE composition",
    ).toBe(1);
    expect(
      [...distinctes][0],
      "et cette composition unique est celle de la lecture d'origine",
    ).toBe(
      [...reference.entries()]
        .map(([id, l]) => id + "=" + String(l))
        .sort()
        .join(","),
    );
  });

  it("la graine de compétition décide VRAIMENT de qui prend le A", () => {
    const paire = candidats("club-lyon", "cat", 2);
    const premier = lettres(paire, "graine-1").get("reg-0");
    const contraires = ["graine-2", "graine-3", "graine-4", "graine-5", "graine-6"].filter(
      (g) => lettres(paire, g).get("reg-0") !== premier,
    );
    expect(
      contraires.length,
      "sans cette sensibilité, la composition serait constante et l'aléa décoratif",
    ).toBeGreaterThan(0);
  });

  it("rejouer la composition sur son propre résultat ne change rien", () => {
    const composition = autoComposeSquads(POPULATION, "graine-2026");
    const figee: SquadCandidate[] = composition.assignments.map((a) => ({
      registrationId: a.registrationId,
      clubId: a.clubId,
      categoryKey: a.categoryKey,
      letter: a.letter,
      source: a.source,
    }));
    const rejouee = autoComposeSquads(figee, "AUTRE-GRAINE");
    expect(
      rejouee.assignments,
      "une composition posée est un fait : la rejouer avec une autre graine ne doit rien bouger",
    ).toEqual(composition.assignments);
  });
});

// ===================================================================
// L'AUTO-COMPOSITION COMPLÈTE, ELLE NE RÉÉCRIT PAS
// ===================================================================

describe("équipes A/B/C : une lettre posée par le club ne bouge jamais", () => {
  it("la lettre du club est conservée, et son origine avec elle", () => {
    const mixte: SquadCandidate[] = [
      {
        registrationId: "pose",
        clubId: "club-lyon",
        categoryKey: "cat",
        letter: "C",
        source: "club",
      },
      ...candidats("club-lyon", "cat", 2, "auto"),
    ];
    const composition = autoComposeSquads(mixte, "g1");
    const pose = composition.assignments.find((a) => a.registrationId === "pose");
    expect(pose?.letter, "le club avait choisi C").toBe("C");
    expect(pose?.source, "et l'écran doit continuer à dire que c'est le club qui a composé").toBe(
      "club",
    );
    expect(
      composition.assignments
        .filter((a) => a.source === "auto")
        .map((a) => a.letter)
        .sort(),
      "l'auto-composition COMPLÈTE autour du C : elle prend les deux lettres libres",
    ).toEqual(["A", "B"]);
  });

  it("une composition DÉSÉQUILIBRÉE par le club est respectée, pas corrigée", () => {
    const troisEnA: SquadCandidate[] = [
      {
        registrationId: "a1",
        clubId: "club-lyon",
        categoryKey: "cat",
        letter: "A",
        source: "club",
      },
      {
        registrationId: "a2",
        clubId: "club-lyon",
        categoryKey: "cat",
        letter: "A",
        source: "club",
      },
      {
        registrationId: "a3",
        clubId: "club-lyon",
        categoryKey: "cat",
        letter: "A",
        source: "club",
      },
      { registrationId: "libre", clubId: "club-lyon", categoryKey: "cat" },
    ];
    const composition = autoComposeSquads(troisEnA, "g1");
    expect(
      composition.assignments.filter((a) => a.letter === "A").length,
      "trois A restent trois A : c'est un choix de club, pas une erreur à redresser",
    ).toBe(3);
    expect(
      composition.assignments.find((a) => a.registrationId === "libre")?.letter,
      "le seul libre part sur la lettre la moins chargée",
    ).toBe("B");
  });

  it("une lettre posée par la FÉDÉRATION est traitée comme celle d'un club", () => {
    const composition = autoComposeSquads(
      [
        {
          registrationId: "arbitre",
          clubId: "club-lyon",
          categoryKey: "cat",
          letter: "B",
          source: "federation",
        },
        ...candidats("club-lyon", "cat", 1, "auto"),
      ],
      "g1",
    );
    expect(composition.assignments.find((a) => a.registrationId === "arbitre")?.source).toBe(
      "federation",
    );
    expect(
      composition.assignments.find((a) => a.registrationId === "auto-0")?.letter,
      "B est pris : le libre part sur A",
    ).toBe("A");
  });

  it("une lettre posée sans origine déclarée est attribuée au CLUB, jamais à `auto`", () => {
    const composition = autoComposeSquads(
      [{ registrationId: "x", clubId: "club-lyon", categoryKey: "cat", letter: "A" }],
      "g1",
    );
    expect(
      composition.assignments[0]?.source,
      "`auto` doit rester le signal fiable de « le système a composé à votre place »",
    ).toBe("club");
  });
});

// ===================================================================
// SANS CLUB
// ===================================================================

describe("équipes A/B/C : une inscription sans club est rendue, pas effacée", () => {
  it("elle ne reçoit pas de lettre et figure dans `withoutClub`", () => {
    const composition = autoComposeSquads(
      [
        { registrationId: "orphelin", clubId: null, categoryKey: "cat" },
        { registrationId: "vide", clubId: "", categoryKey: "cat" },
        ...candidats("club-lyon", "cat", 1),
      ],
      "g1",
    );
    expect(composition.assignments.map((a) => a.registrationId)).toEqual(["reg-0"]);
    expect(
      composition.withoutClub,
      "une équipe est unique par (compétition, club, lettre) : sans club, il n'y a pas d'équipe",
    ).toEqual(["orphelin", "vide"]);
  });
});

// ===================================================================
// LA FENÊTRE DE COMPOSITION
// ===================================================================

describe("équipes A/B/C : le délai est ferme", () => {
  const CLOTURE = "2026-11-01T12:00:00.000Z";

  it("le délai par défaut est de 72 heures après la clôture", () => {
    expect(SQUAD_WINDOW_HOURS_DEFAULT).toBe(72);
    expect(squadCompositionDeadline(CLOTURE)).toBe("2026-11-04T12:00:00.000Z");
  });

  it("le délai s'ajoute en temps ABSOLU, comme `now() + interval` côté base", () => {
    expect(squadCompositionDeadline(CLOTURE, 0), "0 h : la main passe immédiatement").toBe(CLOTURE);
    expect(squadCompositionDeadline(CLOTURE, 336)).toBe("2026-11-15T12:00:00.000Z");
  });

  it("le club a la main avant l'échéance, plus après", () => {
    expect(isSquadWindowOpen("2026-11-04T11:59:59.000Z", CLOTURE)).toBe(true);
    expect(isSquadWindowOpen("2026-11-04T12:00:00.000Z", CLOTURE), "à la seconde près").toBe(false);
    expect(isSquadWindowOpen("2026-11-05T00:00:00.000Z", CLOTURE)).toBe(false);
  });

  it("une date ILLISIBLE ferme la fenêtre plutôt que de bloquer la génération", () => {
    expect(squadCompositionDeadline(null)).toBe(null);
    expect(squadCompositionDeadline("pas une date")).toBe(null);
    expect(
      isSquadWindowOpen("2026-11-01T00:00:00.000Z", null),
      "composer à la place d'un club s'affiche et se corrige ; attendre indéfiniment bloque la journée",
    ).toBe(false);
    expect(isSquadWindowOpen("pas une date", CLOTURE)).toBe(false);
  });
});

// ===================================================================
// CE QUE LES LETTRES CHANGENT VRAIMENT AU TIRAGE
// ===================================================================

/**
 * ┌─ LA PROMESSE, ET SA MESURE ───────────────────────────────────────────────┐
 * │ « Répartir les combattants d'un club maximise leur séparation. » C'est la  │
 * │ raison d'être de la règle, et elle est PARTIELLEMENT fausse telle qu'on la │
 * │ lit d'habitude : à trois combattants ou moins, les trois lettres sont      │
 * │ différentes, donc AUCUNE paire de même équipe n'existe, donc les           │
 * │ contraintes d'équipe ne voient rien. Toute la séparation vient alors de    │
 * │ l'anti-club, qui est actif sans la moindre lettre.                         │
 * │                                                                            │
 * │ Les trois tests ci-dessous mesurent où la lettre commence à peser, plutôt  │
 * │ que de répéter la promesse.                                                │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
describe("équipes A/B/C : ce que la lettre apporte au tirage, mesuré", () => {
  function tableau(nClub: number, nAutres: number, seed: string) {
    const population = [
      ...candidats("club-marseille", "cat", nClub, "mars"),
      ...Array.from({ length: nAutres }, (_, i) => ({
        registrationId: "autre-" + i,
        clubId: "club-" + i,
        categoryKey: "cat",
      })),
    ];
    const composition = autoComposeSquads(population, seed);
    const entries: BracketEntry[] = composition.assignments.map((a) => ({
      registrationId: a.registrationId,
      clubId: a.clubId,
      teamId: squadTeamId(a.clubId, a.letter),
    }));
    const size = 2 ** Math.ceil(Math.log2(entries.length));
    const avec = applySeedingPlan(entries, size, mulberry32(fnv1a(seed)), SQUAD_SEEDING_PLAN);
    const sans = applySeedingPlan(entries, size, mulberry32(fnv1a(seed)), DEFAULT_SEEDING_PLAN);
    return {
      size,
      avec: pairCount(avec.leaves, size / 2, "team"),
      sans: pairCount(sans.leaves, size / 2, "team"),
    };
  }

  const GRAINES = ["g1", "g2", "g3", "g4", "g5"];

  it("le plan d'équipe allume les DEUX contraintes d'équipe, et rien d'autre", () => {
    expect(
      SQUAD_SEEDING_PLAN.constraints.filter((c) => c.enabled).map((c) => c.name),
      "les deux règles anti-club historiques restent actives, les deux règles d'équipe s'allument",
    ).toEqual([
      "meme-club-premier-tour",
      "meme-club-quart-de-tableau",
      "meme-equipe-premier-tour",
      "meme-equipe-meme-moitie",
    ]);
  });

  it("à trois combattants ou moins, la lettre n'a RIEN à séparer", () => {
    for (const n of [2, 3]) {
      const composition = autoComposeSquads(candidats("club-marseille", "cat", n), "g1");
      const equipes = composition.assignments.map((a) => squadTeamId(a.clubId, a.letter));
      expect(
        new Set(equipes).size,
        "toutes les lettres sont différentes : aucune paire de même équipe n'existe",
      ).toBe(n);
    }
    for (const seed of GRAINES) {
      const m = tableau(3, 13, seed);
      expect(m.avec, "il n'y a rien à séparer").toBe(0);
      expect(m.sans, "et l'anti-club seul y arrivait déjà").toBe(0);
    }
  });

  it("à QUATRE, deux combattants partagent une lettre - et l'anti-club les sépare déjà", () => {
    const composition = autoComposeSquads(candidats("club-marseille", "cat", 4), "g1");
    const equipes = composition.assignments.map((a) => squadTeamId(a.clubId, a.letter));
    expect(new Set(equipes).size, "quatre combattants, trois lettres : une paire apparaît").toBe(3);
    for (const seed of GRAINES) {
      const m = tableau(4, 12, seed);
      expect(
        m.sans,
        "mesuré sur cinq graines : à quatre, l'entrelacement anti-club sépare déjà les deux A tout seul",
      ).toBe(0);
      expect(m.avec).toBe(0);
    }
  });

  it("c'est à partir de CINQ que la contrainte d'équipe mord vraiment", () => {
    const gagnantes = GRAINES.filter((seed) => {
      const m = tableau(6, 10, seed);
      return m.avec < m.sans;
    });
    expect(
      gagnantes.length,
      "à six combattants d'un club, l'anti-club sature et la lettre récupère la séparation",
    ).toBeGreaterThan(0);
    for (const seed of GRAINES) {
      expect(
        tableau(6, 10, seed).avec,
        "avec les lettres, les trois paires A/B/C finissent dans des moitiés opposées",
      ).toBe(0);
    }
  });
});

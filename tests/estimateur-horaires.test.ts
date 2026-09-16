import { describe, expect, it } from "vitest";
import {
  PLANCHER_AFFICHAGE_MS,
  couleurDEcart,
  ecartDeRythmeMinutes,
  estimerLesHoraires,
  type CombatAEstimer,
  type EntreeEstimation,
  type TatamiAEstimer,
} from "../src/estimateur-horaires";

// ===================================================================
// L'ESTIMATEUR UNIQUE DES HEURES DE PASSAGE (TB1, TB2, TB4, T9.1, T9.3,
// T12.1, T12.5, T12.6).
// ===================================================================

const MINUTE = 60_000;
/** 20/09/2026 à H:M, en UTC : l'estimateur ne connaît aucun fuseau. */
const T = (h: number, m = 0, s = 0) => Date.UTC(2026, 8, 20, h, m, s);
const hm = (ms: number | null | undefined) => {
  if (ms === null || ms === undefined) return null;
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}${d.getUTCSeconds() ? `:${p(d.getUTCSeconds())}` : ""}`;
};

let compteur = 0;
function combat(p: Partial<CombatAEstimer> & { id: string }): CombatAEstimer {
  compteur += 1;
  return {
    tatamiId: "T1",
    rang: compteur,
    jour: 0,
    statut: "pending",
    startedAtMs: null,
    pausedAtMs: null,
    pausedMs: 0,
    dureeSecondes: 300,
    categoryId: `cat-${p.id}`,
    division: 3,
    index: 0,
    type: "BraketFight",
    athletes: [null, null],
    plancherMs: null,
    ...p,
  };
}

function tatami(id: string, debut: number | null, p: Partial<TatamiAEstimer> = {}): TatamiAEstimer {
  return { id, debutPrevuMs: [debut, null], ...p };
}

function entree(p: Partial<EntreeEstimation>): EntreeEstimation {
  return {
    maintenantMs: T(9, 30),
    espacementSecondes: 60,
    journee: { index: 0, commencee: false },
    tatamis: [tatami("T1", T(10))],
    combats: [],
    reposParAthlete: {},
    ...p,
  };
}

describe("l'espacement entre deux combats d'un tatami", () => {
  it("3 combats de 5 min à 60 s d'espacement partant de 10:00 : 10:00, 10:06, 10:12, fin 10:17", () => {
    const r = estimerLesHoraires(
      entree({
        combats: [
          combat({ id: "c1", rang: 1 }),
          combat({ id: "c2", rang: 2 }),
          combat({ id: "c3", rang: 3 }),
        ],
      }),
    );
    expect(["c1", "c2", "c3"].map((id) => hm(r.combats.get(id)?.debutMs))).toEqual([
      "10:00",
      "10:06",
      "10:12",
    ]);
    expect(hm(r.tatamis.get("T1")?.finEstimeeMs)).toBe("10:17");
    expect(r.tatamis.get("T1")?.restants).toBe(3);
  });

  it("un espacement nul enchaîne les combats sur leur seule durée", () => {
    const r = estimerLesHoraires(
      entree({
        espacementSecondes: 0,
        combats: [combat({ id: "c1", rang: 1 }), combat({ id: "c2", rang: 2 })],
      }),
    );
    expect(hm(r.combats.get("c2")?.debutMs)).toBe("10:05");
  });

  it("l'ordre de la file est celui du rang, jamais celui de la lecture", () => {
    const r = estimerLesHoraires(
      entree({
        combats: [combat({ id: "b", rang: 2 }), combat({ id: "a", rang: 1 })],
      }),
    );
    expect(hm(r.combats.get("a")?.debutMs)).toBe("10:00");
    expect(hm(r.combats.get("b")?.debutMs)).toBe("10:06");
  });
});

describe("l'ancrage sur le début prévu du tatami", () => {
  const file = [combat({ id: "c1", rang: 1 }), combat({ id: "c2", rang: 2 })];

  it("planning à 09:00 regardé à 08:00, rien de lancé : le premier combat est à 09:00", () => {
    const r = estimerLesHoraires(
      entree({ maintenantMs: T(8), tatamis: [tatami("T1", T(9))], combats: file }),
    );
    expect(hm(r.combats.get("c1")?.debutMs)).toBe("09:00");
  });

  it("à 09:40 sans combat lancé : 09:40, soit 40 minutes de retard lisibles", () => {
    const r = estimerLesHoraires(
      entree({ maintenantMs: T(9, 40), tatamis: [tatami("T1", T(9))], combats: file }),
    );
    expect(hm(r.combats.get("c1")?.debutMs)).toBe("09:40");
    expect(hm(r.combats.get("c2")?.debutMs)).toBe("09:46");
  });

  it("un tatami déjà lancé ce jour-là part de sa dernière fin réelle, pas de son début prévu", () => {
    const r = estimerLesHoraires(
      entree({
        maintenantMs: T(8, 50),
        journee: { index: 0, commencee: true },
        tatamis: [tatami("T1", T(9), { lanceAujourdhui: true, derniereFinMs: T(8, 49, 30) })],
        combats: file,
      }),
    );
    // 08:49:30 + 60 s d'espacement = 08:50:30 : l'avance sur le planning reste lisible.
    expect(hm(r.combats.get("c1")?.debutMs)).toBe("08:50:30");
  });

  it("un tatami sans début prévu part de maintenant", () => {
    const r = estimerLesHoraires(
      entree({ maintenantMs: T(11), tatamis: [tatami("T1", null)], combats: file }),
    );
    expect(hm(r.combats.get("c1")?.debutMs)).toBe("11:00");
  });
});

describe("un combat en cours ou en pause", () => {
  it("fin = départ + durée + pauses cumulées + pause en cours", () => {
    const r = estimerLesHoraires(
      entree({
        maintenantMs: T(10, 2),
        journee: { index: 0, commencee: true },
        combats: [
          combat({
            id: "vivant",
            rang: 1,
            statut: "paused",
            startedAtMs: T(10),
            pausedMs: 30_000,
            pausedAtMs: T(10, 1),
          }),
          combat({ id: "suivant", rang: 2 }),
        ],
      }),
    );
    const vivant = r.combats.get("vivant")!;
    expect(vivant.etat).toBe("en_cours");
    expect(hm(vivant.debutMs)).toBe("10:00");
    // 10:00 + 5 min + 30 s cumulées + 1 min de pause en cours = 10:06:30
    expect(hm(vivant.finMs)).toBe("10:06:30");
    expect(hm(r.combats.get("suivant")?.debutMs)).toBe("10:07:30");
  });

  it("un combat qui dépasse sa durée finit maintenant, jamais dans le passé", () => {
    const r = estimerLesHoraires(
      entree({
        maintenantMs: T(10, 20),
        journee: { index: 0, commencee: true },
        combats: [
          combat({ id: "long", rang: 1, statut: "in_progress", startedAtMs: T(10) }),
          combat({ id: "suivant", rang: 2 }),
        ],
      }),
    );
    expect(hm(r.combats.get("long")?.finMs)).toBe("10:20");
    expect(hm(r.combats.get("suivant")?.debutMs)).toBe("10:21");
  });

  it("un combat en cours passe devant la file, quel que soit son rang", () => {
    const r = estimerLesHoraires(
      entree({
        maintenantMs: T(10, 1),
        journee: { index: 0, commencee: true },
        combats: [
          combat({ id: "premier", rang: 1 }),
          combat({ id: "lance", rang: 5, statut: "in_progress", startedAtMs: T(10) }),
        ],
      }),
    );
    expect(hm(r.combats.get("premier")?.debutMs)).toBe("10:06");
  });
});

describe("le repos des athlètes", () => {
  it("repos simple : une durée de combat après la fin réelle du combat précédent", () => {
    const r = estimerLesHoraires(
      entree({
        maintenantMs: T(10),
        tatamis: [tatami("T1", T(9))],
        combats: [combat({ id: "c", athletes: ["ana", "bea"], division: 2 })],
        reposParAthlete: { ana: T(9, 58) },
      }),
    );
    const c = r.combats.get("c")!;
    expect(hm(c.debutMs)).toBe("10:03");
    expect(hm(c.debutDeFileMs)).toBe("10:00");
    expect(c.attendRepos).toBe(true);
    expect(hm(c.finDeReposMs)).toBe("10:03");
  });

  it("repos double avant une finale (division 1, combat ordinaire)", () => {
    const r = estimerLesHoraires(
      entree({
        maintenantMs: T(10),
        tatamis: [tatami("T1", T(9))],
        combats: [combat({ id: "finale", athletes: ["ana", "bea"], division: 1 })],
        reposParAthlete: { ana: T(9, 58) },
      }),
    );
    expect(hm(r.combats.get("finale")?.debutMs)).toBe("10:08");
  });

  it("la 2e demi-finale d'un tableau de trois est un repos simple", () => {
    const r = estimerLesHoraires(
      entree({
        maintenantMs: T(10),
        tatamis: [tatami("T1", T(9))],
        combats: [
          combat({
            id: "rep",
            athletes: ["ana", "bea"],
            division: 2,
            type: "BraketFightRepechage3",
          }),
        ],
        reposParAthlete: { ana: T(9, 58) },
      }),
    );
    expect(hm(r.combats.get("rep")?.debutMs)).toBe("10:03");
  });

  it("repos croisé : une finale au tatami 2 attend la demi-finale estimée du tatami 1 plus deux durées", () => {
    const r = estimerLesHoraires(
      entree({
        maintenantMs: T(10),
        tatamis: [tatami("T1", T(10)), tatami("T2", T(10))],
        combats: [
          combat({
            id: "demi",
            tatamiId: "T1",
            rang: 1,
            athletes: ["ana", "bea"],
            categoryId: "K",
            division: 2,
          }),
          combat({
            id: "finale-autre",
            tatamiId: "T2",
            rang: 1,
            athletes: ["ana", "clo"],
            categoryId: "L",
            division: 1,
          }),
        ],
      }),
    );
    // Demi-finale 10:00-10:05, finale de l'autre catégorie : 10:05 + 2 × 5 min.
    expect(hm(r.combats.get("demi")?.debutMs)).toBe("10:00");
    expect(hm(r.combats.get("finale-autre")?.debutMs)).toBe("10:15");
    expect(r.combats.get("finale-autre")?.attendRepos).toBe(true);
  });

  it("une finale aux adversaires inconnus attend ses deux sources, sur un autre tatami", () => {
    const r = estimerLesHoraires(
      entree({
        maintenantMs: T(10),
        tatamis: [tatami("T1", T(10)), tatami("T2", T(10))],
        combats: [
          combat({
            id: "d0",
            tatamiId: "T1",
            rang: 1,
            categoryId: "K",
            division: 2,
            index: 0,
            athletes: ["a", "b"],
          }),
          combat({
            id: "d1",
            tatamiId: "T1",
            rang: 2,
            categoryId: "K",
            division: 2,
            index: 1,
            athletes: ["c", "d"],
          }),
          combat({ id: "f", tatamiId: "T2", rang: 1, categoryId: "K", division: 1, index: 0 }),
        ],
      }),
    );
    // d1 finit à 10:11 ; la finale attend 10:11 + 2 × 5 min = 10:21.
    expect(hm(r.combats.get("d1")?.finMs)).toBe("10:11");
    expect(hm(r.combats.get("f")?.debutMs)).toBe("10:21");
    expect(r.combats.get("f")?.dependanceIgnoree).toBe(false);
    // Le créneau de la finale, lui, reste 10:00 : c'est sa place dans la file du
    // tatami 2, avant que l'attente de ses sources ne la repousse.
    expect(hm(r.combats.get("f")?.debutDeFileMs)).toBe("10:00");
  });

  it("un athlète sans combat disputé connu n'attend aucun repos (un W.O. ou une désignation n'en ouvre pas)", () => {
    // Le prédicat « disputé » vit dans `aDisputeLeCombat` et sa jumelle SQL : un
    // athlète dont le seul combat est un forfait n'a pas d'entrée dans la carte.
    const r = estimerLesHoraires(
      entree({
        maintenantMs: T(10),
        tatamis: [tatami("T1", T(9))],
        combats: [combat({ id: "c", athletes: ["ana", "bea"], division: 1 })],
        reposParAthlete: {},
      }),
    );
    expect(hm(r.combats.get("c")?.debutMs)).toBe("10:00");
    expect(r.combats.get("c")?.attendRepos).toBe(false);
    expect(r.combats.get("c")?.finDeReposMs).toBeNull();
  });

  it("aucun réordonnancement : la tête de file en repos fait attendre le tatami", () => {
    const r = estimerLesHoraires(
      entree({
        maintenantMs: T(10),
        tatamis: [tatami("T1", T(9))],
        combats: [
          combat({ id: "repos", rang: 1, athletes: ["ana", "bea"] }),
          combat({ id: "pret", rang: 2, athletes: ["clo", "dan"] }),
        ],
        reposParAthlete: { ana: T(9, 59) },
      }),
    );
    expect(hm(r.combats.get("repos")?.debutMs)).toBe("10:04");
    expect(hm(r.combats.get("pret")?.debutMs)).toBe("10:10");
  });
});

describe("le plancher de 90 minutes", () => {
  it("un tatami en avance de 3 h n'annonce pas un combat avant l'heure prévue de sa catégorie moins 90 min", () => {
    const heurePrevue = T(13);
    const r = estimerLesHoraires(
      entree({
        maintenantMs: T(10),
        journee: { index: 0, commencee: true },
        tatamis: [tatami("T1", T(9))],
        combats: [
          combat({ id: "c1", rang: 1, plancherMs: heurePrevue - PLANCHER_AFFICHAGE_MS }),
          combat({ id: "c2", rang: 2, plancherMs: heurePrevue - PLANCHER_AFFICHAGE_MS }),
        ],
      }),
    );
    expect(PLANCHER_AFFICHAGE_MS).toBe(90 * MINUTE);
    expect(hm(r.combats.get("c1")?.debutMs)).toBe("11:30");
    expect(hm(r.combats.get("c1")?.debutDeFileMs)).toBe("11:30");
    expect(r.combats.get("c1")?.plancherApplique).toBe(true);
    // Le suivant découle du premier : il n'est plus borné par son propre plancher.
    expect(hm(r.combats.get("c2")?.debutMs)).toBe("11:36");
    expect(r.combats.get("c2")?.plancherApplique).toBe(false);
    // Le plancher n'est pas « À présent » : l'heure n'est pas atteinte.
    expect(r.combats.get("c1")?.aPresent).toBe(false);
  });

  it("sans plancher, le même tatami annonce l'heure réelle", () => {
    const r = estimerLesHoraires(
      entree({
        maintenantMs: T(10),
        tatamis: [tatami("T1", T(9))],
        combats: [combat({ id: "c1", rang: 1 })],
      }),
    );
    expect(hm(r.combats.get("c1")?.debutMs)).toBe("10:00");
    expect(r.combats.get("c1")?.plancherApplique).toBe(false);
  });
});

describe("« À présent »", () => {
  const base = (commencee: boolean, maintenant: number) =>
    estimerLesHoraires(
      entree({
        maintenantMs: maintenant,
        journee: { index: 0, commencee },
        tatamis: [tatami("T1", T(9))],
        combats: [combat({ id: "tete", rang: 1 }), combat({ id: "deuxieme", rang: 2 })],
      }),
    );

  it("faux tant que la journée n'est pas commencée", () => {
    expect(base(false, T(9, 30)).combats.get("tete")?.aPresent).toBe(false);
  });

  it("vrai sur la seule tête de file, journée commencée et heure atteinte", () => {
    const r = base(true, T(9, 30));
    expect(r.combats.get("tete")?.aPresent).toBe(true);
    expect(r.combats.get("deuxieme")?.aPresent).toBe(false);
  });

  it("faux quand l'estimation est encore à venir", () => {
    expect(base(true, T(8, 30)).combats.get("tete")?.aPresent).toBe(false);
  });

  it("faux derrière un combat en cours : l'estimation est après sa fin", () => {
    const r = estimerLesHoraires(
      entree({
        maintenantMs: T(10, 1),
        journee: { index: 0, commencee: true },
        combats: [
          combat({ id: "vivant", rang: 1, statut: "in_progress", startedAtMs: T(10) }),
          combat({ id: "tete", rang: 2 }),
        ],
      }),
    );
    expect(r.combats.get("vivant")?.aPresent).toBe(false);
    expect(r.combats.get("tete")?.aPresent).toBe(false);
  });
});

describe("deux journées", () => {
  it("un combat du jour 2 repart du début prévu du jour 2 ; la fin estimée porte sur la journée courante", () => {
    const J2 = Date.UTC(2026, 8, 21, 9);
    const r = estimerLesHoraires(
      entree({
        maintenantMs: T(10),
        journee: { index: 0, commencee: true },
        tatamis: [{ id: "T1", debutPrevuMs: [T(9), J2] }],
        combats: [combat({ id: "j1", rang: 1, jour: 0 }), combat({ id: "j2", rang: 2, jour: 1 })],
      }),
    );
    expect(hm(r.combats.get("j1")?.debutMs)).toBe("10:00");
    expect(r.combats.get("j2")?.debutMs).toBe(J2);
    expect(r.combats.get("j2")?.aPresent).toBe(false);
    expect(hm(r.tatamis.get("T1")?.finEstimeeMs)).toBe("10:05");
    expect(r.tatamis.get("T1")?.restants).toBe(1);
  });
});

describe("l'enchaînement des compétitions sur un même tatami physique", () => {
  const avecSoeur = () =>
    entree({
      maintenantMs: T(11),
      journee: { index: 0, commencee: true },
      tatamis: [
        tatami("GI-1", T(9), { physique: "P1", soeur: true, enchainement: -1 }),
        tatami("NOGI-1", T(11), { physique: "P1" }),
      ],
      combats: [
        combat({
          id: "gi-dernier",
          tatamiId: "GI-1",
          rang: 40,
          statut: "in_progress",
          startedAtMs: T(11, 35),
        }),
        combat({ id: "nogi-1", tatamiId: "NOGI-1", rang: 1 }),
      ],
    });

  it("« decalage » : la sœur finissant à 11:40 décale le premier No-Gi à 11:41", () => {
    const r = estimerLesHoraires(
      { ...avecSoeur(), maintenantMs: T(11, 36) },
      { enchainement: "decalage" },
    );
    expect(hm(r.combats.get("gi-dernier")?.finMs)).toBe("11:40");
    expect(hm(r.combats.get("nogi-1")?.debutMs)).toBe("11:41");
    expect(r.tatamis.get("NOGI-1")?.finEstimeeMs).toBe(T(11, 46));
  });

  it("« aucun » : la compétition part de son propre début prévu", () => {
    const r = estimerLesHoraires(
      { ...avecSoeur(), maintenantMs: T(10, 30) },
      { enchainement: "aucun" },
    );
    expect(r.combats.has("gi-dernier")).toBe(false);
    expect(hm(r.combats.get("nogi-1")?.debutMs)).toBe("11:00");
  });

  it("les athlètes communs portent leur repos d'une compétition à l'autre", () => {
    const r = estimerLesHoraires({
      ...avecSoeur(),
      maintenantMs: T(11, 36),
      tatamis: [
        tatami("GI-1", T(9), { physique: "P1", soeur: true, enchainement: -1 }),
        tatami("NOGI-2", T(11), { physique: "P2" }),
      ],
      combats: [
        combat({
          id: "gi-dernier",
          tatamiId: "GI-1",
          rang: 40,
          statut: "in_progress",
          startedAtMs: T(11, 35),
          athletes: ["ana", "bea"],
        }),
        combat({
          id: "nogi-1",
          tatamiId: "NOGI-2",
          rang: 1,
          athletes: ["ana", "clo"],
          division: 3,
        }),
      ],
    });
    // Tatami physique différent, mais Ana finit son combat Gi à 11:40 : 11:45.
    expect(hm(r.combats.get("nogi-1")?.debutMs)).toBe("11:45");
  });
});

describe("robustesse", () => {
  it("une source rangée après son dépendant sur le même tatami : pas de boucle, contrainte ignorée et marquée", () => {
    const r = estimerLesHoraires(
      entree({
        maintenantMs: T(10),
        tatamis: [tatami("T1", T(10))],
        combats: [
          combat({ id: "f", rang: 1, categoryId: "K", division: 1, index: 0 }),
          combat({
            id: "d0",
            rang: 2,
            categoryId: "K",
            division: 2,
            index: 0,
            athletes: ["a", "b"],
          }),
          combat({
            id: "d1",
            rang: 3,
            categoryId: "K",
            division: 2,
            index: 1,
            athletes: ["c", "d"],
          }),
        ],
      }),
    );
    expect(r.combats.size).toBe(3);
    expect(r.combats.get("f")?.dependanceIgnoree).toBe(true);
    expect(hm(r.combats.get("f")?.debutMs)).toBe("10:00");
    expect(hm(r.combats.get("d1")?.debutMs)).toBe("10:12");
  });

  it("deux dépendances croisées entre deux tatamis : pas d'interblocage", () => {
    const r = estimerLesHoraires(
      entree({
        maintenantMs: T(10),
        tatamis: [tatami("T1", T(10)), tatami("T2", T(10))],
        combats: [
          combat({ id: "fK", tatamiId: "T1", rang: 1, categoryId: "K", division: 1 }),
          combat({
            id: "sL",
            tatamiId: "T1",
            rang: 2,
            categoryId: "L",
            division: 2,
            athletes: ["a", "b"],
          }),
          combat({ id: "fL", tatamiId: "T2", rang: 1, categoryId: "L", division: 1 }),
          combat({
            id: "sK",
            tatamiId: "T2",
            rang: 2,
            categoryId: "K",
            division: 2,
            athletes: ["c", "d"],
          }),
        ],
      }),
    );
    expect(r.combats.size).toBe(4);
    expect([...r.combats.values()].some((e) => e.dependanceIgnoree)).toBe(true);
  });

  it("un combat d'un tatami non déclaré n'est pas estimé", () => {
    const r = estimerLesHoraires(entree({ combats: [combat({ id: "x", tatamiId: "inconnu" })] }));
    expect(r.combats.has("x")).toBe(false);
  });

  it("déterministe : mêmes entrées, même sortie, quel que soit l'ordre de lecture", () => {
    const combats = Array.from({ length: 30 }, (_, i) =>
      combat({
        id: `c${String(i).padStart(2, "0")}`,
        tatamiId: i % 3 === 0 ? "T1" : "T2",
        rang: i % 7,
        athletes: [`a${i % 5}`, `b${i % 4}`],
      }),
    );
    const e = entree({
      maintenantMs: T(10),
      tatamis: [tatami("T1", T(10)), tatami("T2", T(10))],
      combats,
    });
    const a = estimerLesHoraires(e);
    const b = estimerLesHoraires({ ...e, combats: [...combats].reverse() });
    expect([...b.combats.entries()].sort()).toEqual([...a.combats.entries()].sort());
    expect([...b.tatamis.entries()]).toEqual([...a.tatamis.entries()]);
  });

  it("pur : le source ne lit jamais l'horloge", () => {
    const sources = import.meta.glob("../src/estimateur-horaires.ts", {
      query: "?raw",
      import: "default",
      eager: true,
    });
    const source = String(sources["../src/estimateur-horaires.ts"] ?? "");
    expect(source.length).toBeGreaterThan(1000);
    expect(source).not.toMatch(/Date\.now|new Date\(|performance\.now/);
  });

  it("volume : 2 500 combats sur 10 tatamis, estimés en moins de 50 ms", () => {
    const combats: CombatAEstimer[] = [];
    for (let i = 0; i < 2_500; i += 1) {
      const cat = Math.floor(i / 8);
      const div = 3 - (i % 8 < 4 ? 0 : i % 8 < 6 ? 1 : 2);
      combats.push(
        combat({
          id: `v${i}`,
          tatamiId: `T${cat % 10}`,
          rang: i,
          categoryId: `K${cat}`,
          division: div,
          index: i % 8 < 4 ? i % 8 : i % 8 < 6 ? (i % 8) - 4 : 0,
          athletes: div === 3 ? [`l${i % 900}`, `l${(i * 7) % 900}`] : [null, null],
        }),
      );
    }
    const e = entree({
      maintenantMs: T(9),
      tatamis: Array.from({ length: 10 }, (_, i) => tatami(`T${i}`, T(9))),
      combats,
    });
    estimerLesHoraires(e);
    let meilleur = Number.POSITIVE_INFINITY;
    for (let essai = 0; essai < 5; essai += 1) {
      const debut = Date.now();
      const r = estimerLesHoraires(e);
      meilleur = Math.min(meilleur, Date.now() - debut);
      expect(r.combats.size).toBe(2_500);
    }
    expect(meilleur).toBeLessThan(50);
  });
});

describe("l'écart de rythme et sa couleur", () => {
  it("fin prévue 19:00, absolut ajouté de 25 min, fin estimée 19:33 : +8 min", () => {
    expect(ecartDeRythmeMinutes(T(19, 33), T(19), 25 * 60)).toBe(8);
  });

  it("une catégorie de 6 × (5 min + 60 s) déplacée : effet −36 et +36, écarts inchangés", () => {
    const effet = 6 * (300 + 60);
    expect(effet).toBe(36 * 60);
    // Tatami 1 : fin prévue 18:00, la catégorie partie, fin estimée 17:24.
    expect(ecartDeRythmeMinutes(T(17, 24), T(18), -effet)).toBe(0);
    // Tatami 3 : fin prévue 18:00, la catégorie reçue, fin estimée 18:36.
    expect(ecartDeRythmeMinutes(T(18, 36), T(18), effet)).toBe(0);
  });

  it("un démarrage tardif se lit dans l'écart", () => {
    expect(ecartDeRythmeMinutes(T(19, 18), T(19), 0)).toBe(18);
    expect(ecartDeRythmeMinutes(T(18, 51), T(19), 0)).toBe(-9);
  });

  it("arrondi symétrique à la minute, jamais « −0 »", () => {
    expect(ecartDeRythmeMinutes(T(19, 0, 20), T(19), 0)).toBe(0);
    expect(Object.is(ecartDeRythmeMinutes(T(18, 59, 40), T(19), 0), -0)).toBe(false);
    expect(ecartDeRythmeMinutes(T(19, 0, 30), T(19), 0)).toBe(1);
    expect(ecartDeRythmeMinutes(T(18, 59, 30), T(19), 0)).toBe(-1);
  });

  it("quatre couleurs aux bornes : −10 bleu, −9 vert, 9 vert, 10 orange, 30 orange, 31 rouge", () => {
    expect(couleurDEcart(-11)).toBe("bleu");
    expect(couleurDEcart(-10)).toBe("bleu");
    expect(couleurDEcart(-9)).toBe("vert");
    expect(couleurDEcart(0)).toBe("vert");
    expect(couleurDEcart(9)).toBe("vert");
    expect(couleurDEcart(10)).toBe("orange");
    expect(couleurDEcart(30)).toBe("orange");
    expect(couleurDEcart(31)).toBe("rouge");
  });
});

import { describe, expect, it } from "vitest";
import {
  DELAI_INSCRIPTION_ABSOLUT_MINUTES,
  estNoireAdulte,
  etatInscriptionsAbsolut,
  groupeAbsolutJuvenile,
  manquesDeGeneration,
  nombreDeTapisAdmis,
  ouvertureAbsolut,
  perimetreAbsolut,
  scenariosGroupeJuvenile,
  scenariosInscriptionsAbsolut,
  statutALaCloture,
  tapisDuCombatAbsolut,
  type EntreeGenerationAbsolut,
  type EntreeInscriptionsAbsolut,
} from "../src/absolut-regles";
import { BELT_RANK_ORDER } from "../src/belts";
import { generateBracket, type BracketEntry, type GeneratedFight } from "../src/bracket-generator";
import { AGE_GROUPS, WEIGHT_CLASSES } from "../src/referential";

const MIN = 60_000;

describe("le délai d'inscription", () => {
  it("vaut 20 minutes, règle CFJJB (T5.3)", () => {
    expect(DELAI_INSCRIPTION_ABSOLUT_MINUTES).toBe(20);
  });
});

describe("le groupe juvénile Leve / Pesado (AB6.1)", () => {
  it("range Galo à Leve dans Leve et Medio à Pesadissimo dans Pesado, par nom", () => {
    expect(["Galo", "Pluma", "Pena", "Leve"].map(groupeAbsolutJuvenile)).toEqual([
      "Leve",
      "Leve",
      "Leve",
      "Leve",
    ]);
    expect(
      ["Medio", "Meio Pesado", "Pesado", "Super Pesado", "Pesadissimo"].map(groupeAbsolutJuvenile),
    ).toEqual(["Pesado", "Pesado", "Pesado", "Pesado", "Pesado"]);
  });

  it("lit les indices de la reprise : 0 à 3 Leve, 4 à 8 Pesado", () => {
    expect(["0", "1", "2", "3"].map(groupeAbsolutJuvenile)).toEqual([
      "Leve",
      "Leve",
      "Leve",
      "Leve",
    ]);
    expect(["4", "5", "6", "7", "8"].map(groupeAbsolutJuvenile)).toEqual([
      "Pesado",
      "Pesado",
      "Pesado",
      "Pesado",
      "Pesado",
    ]);
  });

  it("rend null pour toute autre valeur", () => {
    for (const v of ["9", "36", "", null, undefined, "Absolut", "Absolut Leve", "leve"]) {
      expect(groupeAbsolutJuvenile(v), String(v)).toBeNull();
    }
  });

  it("couvre les neuf classes du référentiel, et Medio est lourd", () => {
    // La frontière est entre Leve et Medio : un Medio rangé en Leve ferait
    // attendre l'absolut léger après une catégorie lourde.
    expect(WEIGHT_CLASSES.map(groupeAbsolutJuvenile).every((g) => g !== null)).toBe(true);
    expect(groupeAbsolutJuvenile("Medio")).toBe("Pesado");
  });

  it("les scénarios de parité portent les deux issues et des valeurs rejetées", () => {
    const s = scenariosGroupeJuvenile();
    expect(s.some((x) => x.attendu === "Leve")).toBe(true);
    expect(s.some((x) => x.attendu === "Pesado")).toBe(true);
    expect(s.some((x) => x.attendu === null)).toBe(true);
    for (const x of s) expect(groupeAbsolutJuvenile(x.weightClass)).toBe(x.attendu);
  });
});

describe("la ceinture noire Adulte (AB5)", () => {
  it("est la famille des grades noirs en tranche Adulte, dans les deux vocabulaires", () => {
    for (const belt of ["black", "coral", "red"] as const) {
      for (const tranche of ["Adulte", "adult", "adulte", " ADULTE "]) {
        expect(estNoireAdulte(belt, tranche), `${belt} ${tranche}`).toBe(true);
      }
    }
  });

  it("n'inclut ni une noire Master, ni une autre ceinture adulte", () => {
    for (const tranche of [
      "Master 1",
      "Master 2",
      "Master 3",
      "Master 4",
      "Master 5+",
      "master_1_2",
    ]) {
      expect(estNoireAdulte("black", tranche), tranche).toBe(false);
    }
    expect(estNoireAdulte("brown", "Adulte")).toBe(false);
    expect(estNoireAdulte(null, "Adulte")).toBe(false);
    expect(estNoireAdulte("black", null)).toBe(false);
  });

  it("n'est vraie que sur 3 ceintures × 1 tranche du référentiel", () => {
    const vraies = BELT_RANK_ORDER.flatMap((b) => AGE_GROUPS.map((a) => [b, a] as const)).filter(
      ([b, a]) => estNoireAdulte(b, a),
    );
    expect(vraies).toEqual([
      ["black", "Adulte"],
      ["coral", "Adulte"],
      ["red", "Adulte"],
    ]);
  });
});

describe("le périmètre de l'absolut (AB4.2, AB6)", () => {
  it("la blanche est fermée partout", () => {
    for (const a of [...AGE_GROUPS, "adult", "juvenil"]) {
      expect(ouvertureAbsolut("white", a), a).toBe("fermee");
    }
  });

  it("U7 à U15 et les anciens codes enfants sont fermés", () => {
    for (const a of [
      "U7",
      "U9",
      "U11",
      "U13",
      "U15",
      "u11",
      "child",
      "mirim",
      "premirim",
      "infantil",
    ]) {
      expect(ouvertureAbsolut("grey", a), a).toBe("fermee");
      expect(ouvertureAbsolut("blue", a), a).toBe("fermee");
    }
  });

  it("le juvénile n'est ouvert qu'en bleue et violette", () => {
    for (const a of ["Juvénile", "juvenil"]) {
      expect(ouvertureAbsolut("blue", a)).toBe("ouverte");
      expect(ouvertureAbsolut("purple", a)).toBe("ouverte");
      expect(ouvertureAbsolut("white", a)).toBe("fermee");
      expect(ouvertureAbsolut("green", a)).toBe("fermee");
      expect(ouvertureAbsolut("brown", a)).toBe("fermee");
    }
  });

  it("Adulte et Masters sont ouverts, codes de la reprise compris", () => {
    for (const a of [
      "Adulte",
      "Master 1",
      "Master 2",
      "Master 3",
      "Master 4",
      "Master 5+",
      "adult",
      "master_1_2",
      "master_3_4",
      "master_5_plus",
    ]) {
      expect(ouvertureAbsolut("blue", a), a).toBe("ouverte");
      expect(ouvertureAbsolut("black", a), a).toBe("ouverte");
    }
  });

  it("une tranche inconnue reste inconnue", () => {
    expect(ouvertureAbsolut("blue", "Vétéran")).toBe("inconnue");
    expect(ouvertureAbsolut("blue", null)).toBe("inconnue");
  });

  it("un juvénile ouvert porte son groupe, et une classe illisible le rend inconnu", () => {
    expect(perimetreAbsolut({ belt: "blue", ageGroup: "Juvénile", weightClass: "Pena" })).toEqual({
      verdict: "ouverte",
      groupe: "Leve",
    });
    expect(perimetreAbsolut({ belt: "purple", ageGroup: "juvenil", weightClass: "6" })).toEqual({
      verdict: "ouverte",
      groupe: "Pesado",
    });
    expect(perimetreAbsolut({ belt: "blue", ageGroup: "Juvénile", weightClass: "36" })).toEqual({
      verdict: "inconnue",
      groupe: null,
    });
    expect(perimetreAbsolut({ belt: "white", ageGroup: "Juvénile", weightClass: "Pena" })).toEqual({
      verdict: "fermee",
      groupe: null,
    });
    expect(perimetreAbsolut({ belt: "brown", ageGroup: "Adulte", weightClass: "Pena" })).toEqual({
      verdict: "ouverte",
      groupe: null,
    });
  });
});

const couleur = (partiel: Partial<EntreeInscriptionsAbsolut> = {}): EntreeInscriptionsAbsolut => ({
  statut: "open",
  rouvert: false,
  noireAdulte: false,
  heureLimite: null,
  sources: [],
  maintenant: 1_000 * MIN,
  ...partiel,
});
const terminee = (ilYa: number, maintenant = 1_000 * MIN) => ({
  terminee: true,
  termineeLe: maintenant - ilYa * MIN,
});
const attendue = { terminee: false, termineeLe: null };

describe("l'échéance des inscriptions (AB1, T5.3)", () => {
  it("reste ouverte, sans échéance, tant qu'une source n'est pas terminée", () => {
    const etat = etatInscriptionsAbsolut(couleur({ sources: [terminee(60), attendue] }));
    expect(etat).toEqual({ statutEffectif: "open", t0: null, echeance: null });
  });

  it("se ferme 20 minutes après la DERNIÈRE source terminée : ouverte à 19:59, close à 20:00", () => {
    const t0 = 900 * MIN;
    const sources = [
      { terminee: true, termineeLe: t0 - 30 * MIN },
      { terminee: true, termineeLe: t0 },
    ];
    const a1959 = etatInscriptionsAbsolut(couleur({ sources, maintenant: t0 + 20 * MIN - 1_000 }));
    expect(a1959).toEqual({ statutEffectif: "open", t0, echeance: t0 + 20 * MIN });
    const a2000 = etatInscriptionsAbsolut(couleur({ sources, maintenant: t0 + 20 * MIN }));
    expect(a2000.statutEffectif).toBe("closed");
  });

  it("suspend le délai quand une source repasse « Attendu », et le relance pour 20 minutes pleines", () => {
    const suspendu = etatInscriptionsAbsolut(couleur({ sources: [terminee(15), attendue] }));
    expect(suspendu.echeance).toBeNull();
    const relance = etatInscriptionsAbsolut(couleur({ sources: [terminee(15), terminee(0)] }));
    expect(relance.echeance).toBe(1_000 * MIN + 20 * MIN);
    expect(relance.statutEffectif).toBe("open");
  });

  it("donne la même échéance à un absolut créé après T0", () => {
    const etat = etatInscriptionsAbsolut(couleur({ sources: [terminee(25)] }));
    expect(etat.statutEffectif).toBe("closed");
    expect(etat.echeance).toBe(1_000 * MIN - 5 * MIN);
  });

  it("ne ferme jamais seul un absolut rouvert (AB2.6)", () => {
    const etat = etatInscriptionsAbsolut(couleur({ rouvert: true, sources: [terminee(500)] }));
    expect(etat).toEqual({ statutEffectif: "open", t0: null, echeance: null });
  });

  it("la noire Adulte suit son heure limite, indépendante des sources, et jamais sans heure", () => {
    const sans = etatInscriptionsAbsolut(couleur({ noireAdulte: true, sources: [terminee(500)] }));
    expect(sans).toEqual({ statutEffectif: "open", t0: null, echeance: null });
    const avant = etatInscriptionsAbsolut(
      couleur({ noireAdulte: true, heureLimite: 1_010 * MIN, sources: [attendue] }),
    );
    expect(avant).toEqual({ statutEffectif: "open", t0: null, echeance: 1_010 * MIN });
    const apres = etatInscriptionsAbsolut(
      couleur({ noireAdulte: true, heureLimite: 990 * MIN, sources: [attendue] }),
    );
    expect(apres.statutEffectif).toBe("closed");
  });

  it("ne change ni un tableau généré ni un absolut annulé", () => {
    for (const statut of ["generated", "cancelled", "closed"] as const) {
      expect(
        etatInscriptionsAbsolut(couleur({ statut, sources: [terminee(500)] })).statutEffectif,
      ).toBe(statut);
    }
  });

  it("n'a aucune échéance sans source", () => {
    expect(etatInscriptionsAbsolut(couleur({ sources: [] })).echeance).toBeNull();
  });

  it("à la clôture, un seul inscrit actif annule, zéro ou deux closent (AB7.1)", () => {
    expect(statutALaCloture(0)).toBe("closed");
    expect(statutALaCloture(1)).toBe("cancelled");
    expect(statutALaCloture(2)).toBe("closed");
    expect(statutALaCloture(9)).toBe("closed");
  });

  it("les scénarios de parité portent les deux issues et restent fidèles à la règle", () => {
    const s = scenariosInscriptionsAbsolut();
    expect(s.some((x) => x.attendu.statutEffectif === "closed" && x.statut === "open")).toBe(true);
    expect(s.some((x) => x.attendu.statutEffectif === "open")).toBe(true);
    expect(s.some((x) => x.attendu.echeanceDans === null)).toBe(true);
    const ids = new Set(s.map((x) => x.id));
    expect(ids.size).toBe(s.length);
    const delaiEcoule = s.find((x) => x.id === "couleur.delai_ecoule");
    expect(delaiEcoule?.attendu).toEqual({ statutEffectif: "closed", echeanceDans: -1 });
    const dansLeDelai = s.find((x) => x.id === "couleur.dans_le_delai");
    expect(dansLeDelai?.attendu).toEqual({ statutEffectif: "open", echeanceDans: 1 });
  });
});

const generation = (partiel: Partial<EntreeGenerationAbsolut> = {}): EntreeGenerationAbsolut => ({
  ...couleur(),
  statut: "closed",
  sources: [terminee(30)],
  attendLesPoids: true,
  closedCause: "delai",
  inscritsActifs: 4,
  ...partiel,
});

describe("la garde de génération (AB1.1, R1)", () => {
  it("permet la génération quand tout est réuni", () => {
    expect(manquesDeGeneration(generation())).toEqual([]);
  });

  it("refuse un absolut annulé ou déjà généré, sans rien d'autre", () => {
    expect(manquesDeGeneration(generation({ statut: "cancelled", inscritsActifs: 1 }))).toEqual([
      "annule",
    ]);
    expect(manquesDeGeneration(generation({ statut: "generated" }))).toEqual(["deja_genere"]);
  });

  it("nomme les manques dans l'ordre de l'écran", () => {
    expect(
      manquesDeGeneration(
        generation({ statut: "open", closedCause: null, sources: [attendue], inscritsActifs: 1 }),
      ),
    ).toEqual(["inscriptions_ouvertes", "sources_non_terminees", "un_seul_inscrit"]);
  });

  it("un absolut « open » dont l'échéance est passée se génère (clôture constatée)", () => {
    expect(
      manquesDeGeneration(
        generation({ statut: "open", closedCause: null, sources: [terminee(21)] }),
      ),
    ).toEqual([]);
    expect(
      manquesDeGeneration(
        generation({ statut: "open", closedCause: null, sources: [terminee(19)] }),
      ),
    ).toEqual(["inscriptions_ouvertes"]);
  });

  it("une clôture anticipée ou manuelle permet la génération avant l'échéance", () => {
    for (const closedCause of ["anticipee", "manuelle"] as const) {
      expect(
        manquesDeGeneration(generation({ closedCause, sources: [terminee(2)] })),
        closedCause,
      ).toEqual([]);
    }
  });

  it("une clôture par délai dont l'échéance est encore à venir attend", () => {
    expect(
      manquesDeGeneration(generation({ closedCause: "delai", sources: [terminee(2)] })),
    ).toEqual(["delai_en_cours"]);
  });

  it("noire Adulte : une catégorie de poids en cours bloque si la garde R1 est active, et pas sinon", () => {
    const noire = generation({
      noireAdulte: true,
      heureLimite: 990 * MIN,
      closedCause: "heure_limite",
      sources: [terminee(40), attendue],
    });
    expect(manquesDeGeneration(noire)).toEqual(["sources_non_terminees"]);
    expect(manquesDeGeneration({ ...noire, attendLesPoids: false })).toEqual([]);
  });

  it("noire Adulte sans heure limite : le manque le dit", () => {
    expect(
      manquesDeGeneration(
        generation({ statut: "open", noireAdulte: true, heureLimite: null, closedCause: null }),
      ),
    ).toEqual(["heure_limite_non_definie"]);
  });

  it("moins de deux inscrits actifs bloque", () => {
    expect(manquesDeGeneration(generation({ inscritsActifs: 1 }))).toEqual(["un_seul_inscrit"]);
    expect(manquesDeGeneration(generation({ inscritsActifs: 0 }))).toEqual(["un_seul_inscrit"]);
  });
});

const entrees = (n: number): BracketEntry[] =>
  Array.from({ length: n }, (_, i) => ({ registrationId: `r${i + 1}`, clubId: `c${i + 1}` }));

const tableau = (n: number, thirdPlaceMode: "pool3" | "shared_bronze" = "shared_bronze") => {
  const r = generateBracket(entrees(n), "graine-absolut", { thirdPlaceMode });
  if (r.kind !== "bracket") throw new Error("tableau attendu");
  return r.fights;
};

describe("la répartition par parties (PL1.2)", () => {
  it("n'admet que 1, 2, 4 ou 8 tapis", () => {
    expect([1, 2, 4, 8].map(nombreDeTapisAdmis)).toEqual([true, true, true, true]);
    expect([0, 3, 5, 6, 7, 16].map(nombreDeTapisAdmis)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
    const f: GeneratedFight = tableau(8)[0]!;
    expect(() => tapisDuCombatAbsolut(f, 3, false)).toThrow(RangeError);
  });

  it("un tableau de 128 sur 8 tapis : 8 combats par tapis au premier tour", () => {
    const fights = tableau(128);
    const premier = fights.filter((f) => f.division === 7);
    expect(premier).toHaveLength(64);
    const parTapis = new Map<number, number>();
    for (const f of premier) {
      const t = tapisDuCombatAbsolut(f, 8, false);
      parTapis.set(t, (parTapis.get(t) ?? 0) + 1);
    }
    expect([...parTapis.entries()].sort((a, b) => a[0] - b[0])).toEqual(
      Array.from({ length: 8 }, (_, t) => [t, 8]),
    );
  });

  it("aucun athlète ne change de tapis tant que le tour compte au moins autant de combats que de tapis", () => {
    for (const n of [2, 4, 8]) {
      const fights = tableau(128);
      const parDivision = new Map<number, GeneratedFight[]>();
      for (const f of fights) {
        const l = parDivision.get(f.division) ?? [];
        l[f.indexInDivision] = f;
        parDivision.set(f.division, l);
      }
      for (const [division, combats] of parDivision) {
        if (division === 7 || combats.length < n) continue;
        const nourriciers = parDivision.get(division + 1)!;
        combats.forEach((c, i) => {
          const t = tapisDuCombatAbsolut(c, n, false);
          expect(
            tapisDuCombatAbsolut(nourriciers[2 * i]!, n, false),
            `${n} tapis, d${division}/${i}`,
          ).toBe(t);
          expect(
            tapisDuCombatAbsolut(nourriciers[2 * i + 1]!, n, false),
            `${n} tapis, d${division}/${i}`,
          ).toBe(t);
        });
      }
    }
  });

  it("les parties convergent 8 → 4 → 2 → 1 vers le tapis de finale", () => {
    const fights = tableau(128);
    const tapisDuTour = (d: number) =>
      [
        ...new Set(
          fights.filter((f) => f.division === d).map((f) => tapisDuCombatAbsolut(f, 8, false)),
        ),
      ].sort((a, b) => a - b);
    expect(tapisDuTour(4)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(tapisDuTour(3)).toEqual([0, 2, 4, 6]);
    expect(tapisDuTour(2)).toEqual([0, 4]);
    expect(tapisDuTour(1)).toEqual([0]);
  });

  it("deux tapis sur un tableau de 8 : premier tour 0-1 / 2-3, demi-finales séparées, finale au premier", () => {
    const fights = tableau(8);
    const t = (d: number, i: number) =>
      tapisDuCombatAbsolut(
        fights.find((f) => f.division === d && f.indexInDivision === i)!,
        2,
        false,
      );
    expect([t(3, 0), t(3, 1), t(3, 2), t(3, 3)]).toEqual([0, 0, 1, 1]);
    expect([t(2, 0), t(2, 1)]).toEqual([0, 1]);
    expect(t(1, 0)).toBe(0);
  });

  it("le combat pour la 3e place se joue sur le tapis de finale", () => {
    const fights = tableau(8, "pool3");
    const troisieme = fights.find((f) => f.type === "BraketFightPool3")!;
    expect(troisieme.division).toBe(2);
    for (const n of [2, 4, 8]) expect(tapisDuCombatAbsolut(troisieme, n, false)).toBe(0);
  });

  it("un tableau de trois se joue entièrement sur un seul tapis", () => {
    const fights = tableau(3);
    expect(fights.some((f) => f.type === "BraketFightRepechage3")).toBe(true);
    for (const f of fights) expect(tapisDuCombatAbsolut(f, 4, true)).toBe(0);
  });

  it("un seul tapis porte tout", () => {
    for (const f of tableau(16)) expect(tapisDuCombatAbsolut(f, 1, false)).toBe(0);
  });
});

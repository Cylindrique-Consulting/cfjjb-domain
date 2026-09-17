import { describe, expect, it } from "vitest";
import {
  faceAFace,
  foldScores,
  isSubmissionType,
  methodeVictoireDe,
  statistiquesCombattant,
  SUBMISSION_TYPES,
  type FightRecord,
  type FightScores,
  type ScoreEvent,
} from "../src/fight-stats";

const scores = (o: Partial<FightScores> = {}): FightScores => ({
  pointsA: 0,
  pointsB: 0,
  advantagesA: 0,
  advantagesB: 0,
  penaltiesA: 0,
  penaltiesB: 0,
  ...o,
});

const combat = (o: Partial<FightRecord> & { fightId: string }): FightRecord => ({
  state: "finished",
  registrationA: null,
  registrationB: null,
  winner: null,
  winMethod: null,
  ...o,
});

const gagne = (
  id: string,
  a: string,
  b: string,
  vainqueur: string,
  methode: FightRecord["winMethod"],
  reste: Partial<FightRecord> = {},
): FightRecord =>
  combat({
    fightId: id,
    registrationA: a,
    registrationB: b,
    winner: vainqueur,
    winMethod: methode,
    ...reste,
  });

function bilan(id: string, fights: readonly FightRecord[]) {
  const r = statistiquesCombattant(id, fights);
  if (!r.aDesCombats) throw new Error(`attendu : des combats pour ${id}`);
  return r;
}

describe("l'état vide n'est pas un objet de compteurs à zéro", () => {
  it("ne porte AUCUN compteur — la forme l'empêche, pas un commentaire", () => {
    const vide = statistiquesCombattant("ANA", []);
    expect(vide).toEqual({ aDesCombats: false });
    expect("combats" in vide).toBe(false);
    expect("soumissions" in vide).toBe(false);
    expect("victoires" in vide).toBe(false);
  });

  it("un combattant qui n'a que des byes n'a pas combattu", () => {
    const f = [
      combat({ fightId: "F1", registrationA: "ANA", winner: "ANA", winMethod: "bye" }),
      combat({ fightId: "F2", registrationB: "ANA", winner: "ANA", winMethod: "bye" }),
    ];
    expect(statistiquesCombattant("ANA", f)).toEqual({ aDesCombats: false });
  });

  it("un combat EN COURS ne crée pas de statistique, même avec des points au tableau", () => {
    const f = [
      combat({
        fightId: "F1",
        state: "in_progress",
        registrationA: "ANA",
        registrationB: "BOB",
        scores: scores({ pointsA: 6 }),
      }),
    ];
    expect(statistiquesCombattant("ANA", f)).toEqual({ aDesCombats: false });
  });

  it("un combat annulé non plus", () => {
    const f = [
      combat({
        fightId: "F1",
        state: "cancelled",
        registrationA: "ANA",
        registrationB: "BOB",
        winner: "ANA",
        winMethod: "points",
      }),
    ];
    expect(statistiquesCombattant("ANA", f)).toEqual({ aDesCombats: false });
  });

  it("ZÉRO SOUMISSION SE DIT, mais seulement de quelqu'un qui a combattu", () => {
    const r = bilan("ANA", [gagne("F1", "ANA", "BOB", "ANA", "points")]);
    expect(r.combats).toBe(1);
    expect(r.soumissions.total).toBe(0);
    expect(r.soumissions.plusRapideMs).toBeNull();
    expect(r.soumissions.medianeMs).toBeNull();
  });

  it("le face-à-face distingue « jamais rencontrés » de « 0 à 0 »", () => {
    const f = [gagne("F1", "ANA", "BOB", "ANA", "points")];
    expect(faceAFace("ANA", "CLE", f)).toEqual({ seSontRencontres: false });
    expect(faceAFace("ANA", "ANA", f)).toEqual({ seSontRencontres: false });
  });
});

describe("victoires, défaites, et la méthode rangée dans sa case", () => {
  const F: FightRecord[] = [
    gagne("F1", "ANA", "BOB", "ANA", "submission", { submissionType: "armbar" }),
    gagne("F2", "CLE", "ANA", "ANA", "points"),
    gagne("F3", "ANA", "DAN", "ANA", "wo"),
    gagne("F4", "ANA", "ELI", "ANA", "abandon"),
    gagne("F5", "FLO", "ANA", "FLO", "dq"),
    gagne("F6", "ANA", "GAB", "GAB", "decision"),
    combat({
      fightId: "F7",
      registrationA: "ANA",
      registrationB: "HUG",
      winner: null,
      winMethod: "double_wo",
    }),
  ];

  it("compte les combats terminés, victoires, défaites et sans-vainqueur", () => {
    const r = bilan("ANA", F);
    expect(r.combats).toBe(7);
    expect(r.victoires).toBe(4);
    expect(r.defaites).toBe(2);
    expect(r.sansVainqueur).toBe(1);
    expect(Object.values(r.victoiresParMethode).reduce((s, v) => s + v, 0)).toBe(4);
    expect(Object.values(r.defaitesParMethode).reduce((s, v) => s + v, 0)).toBe(2);
  });

  it("NE FOND PAS `wo` ET `abandon` : gagner sans combattre n'est pas gagner sur arrêt", () => {
    const r = bilan("ANA", F);
    expect(r.victoiresParMethode).toEqual({
      points: 1,
      soumission: 1,
      decision: 0,
      abandon: 1,
      disqualification: 0,
      forfait: 1,
    });
  });

  it("la méthode est celle du combat : au crédit du vainqueur, au débit du perdant", () => {
    expect(bilan("ANA", F).defaitesParMethode).toEqual({
      points: 0,
      soumission: 0,
      decision: 1,
      abandon: 0,
      disqualification: 1,
      forfait: 0,
    });
    expect(bilan("FLO", F).victoiresParMethode.disqualification).toBe(1);
  });

  it("`bye`, `double_wo`, `double_dq`, `double_blessure` et `designation` n'ont pas de case de méthode", () => {
    expect(methodeVictoireDe("bye")).toBeNull();
    expect(methodeVictoireDe("double_wo")).toBeNull();
    expect(methodeVictoireDe("double_dq")).toBeNull();
    expect(methodeVictoireDe("double_blessure")).toBeNull();
    expect(methodeVictoireDe("designation")).toBeNull();
    expect(methodeVictoireDe(null)).toBeNull();
    expect(methodeVictoireDe("submission")).toBe("soumission");
    expect(methodeVictoireDe("wo")).toBe("forfait");
    expect(methodeVictoireDe("abandon")).toBe("abandon");
    expect(methodeVictoireDe("dq")).toBe("disqualification");
  });

  it("une méthode non relevée se compte à part, jamais dans une case arbitraire", () => {
    const r = bilan("ANA", [gagne("F1", "ANA", "BOB", "ANA", null)]);
    expect(r.victoires).toBe(1);
    expect(r.victoiresSansMethode).toBe(1);
    expect(Object.values(r.victoiresParMethode).reduce((s, v) => s + v, 0)).toBe(0);
  });

  it("les adversaires sont comptés une fois, quel que soit le nombre de combats", () => {
    const r = bilan("ANA", F);
    expect(r.adversairesDistincts).toBe(7);
    expect(r.adversaires.get("BOB")).toEqual({ combats: 1, victoires: 1, defaites: 0 });
    expect(r.adversaires.get("FLO")).toEqual({ combats: 1, victoires: 0, defaites: 1 });
    expect(r.adversaires.get("HUG")).toEqual({ combats: 1, victoires: 0, defaites: 0 });
    expect(r.adversaires.get("ZOE")).toBeUndefined();
  });

  it("deux combats contre le même adversaire font UN adversaire", () => {
    const r = bilan("ANA", [
      gagne("F1", "ANA", "BOB", "ANA", "points"),
      gagne("F2", "BOB", "ANA", "BOB", "points"),
    ]);
    expect(r.adversairesDistincts).toBe(1);
    expect(r.adversaires.get("BOB")).toEqual({ combats: 2, victoires: 1, defaites: 1 });
  });
});

describe("un combat compté deux fois double un bilan", () => {
  const doublon = [
    gagne("F1", "ANA", "BOB", "ANA", "points", { scores: scores({ pointsA: 4 }) }),
    gagne("F1", "ANA", "BOB", "ANA", "points", { scores: scores({ pointsA: 4 }) }),
  ];

  it("le bilan ne compte qu'un combat", () => {
    const r = bilan("ANA", doublon);
    expect(r.combats).toBe(1);
    expect(r.victoires).toBe(1);
    expect(r.pointsMarques).toBe(4);
    expect(r.adversaires.get("BOB")).toEqual({ combats: 1, victoires: 1, defaites: 0 });
  });

  it("le face-à-face non plus", () => {
    const ff = faceAFace("ANA", "BOB", doublon);
    expect(ff.seSontRencontres && ff.combats).toBe(1);
    expect(ff.seSontRencontres && ff.victoiresA).toBe(1);
    expect(ff.seSontRencontres && ff.rencontres.length).toBe(1);
  });
});

describe("l'historique entre deux combattants", () => {
  const F: FightRecord[] = [
    gagne("F1", "ANA", "BOB", "ANA", "submission", { submissionType: "triangle" }),
    gagne("F2", "BOB", "ANA", "BOB", "points"),
    combat({
      fightId: "F3",
      registrationA: "ANA",
      registrationB: "BOB",
      winner: null,
      winMethod: "double_wo",
    }),
    gagne("F4", "ANA", "CLE", "ANA", "points"),
    gagne("F5", "BOB", "DAN", "BOB", "points"),
  ];

  it("ne retient que les combats où les DEUX figurent, chacun d'un côté", () => {
    const ff = faceAFace("ANA", "BOB", F);
    expect(ff).toMatchObject({
      seSontRencontres: true,
      combats: 3,
      victoiresA: 1,
      victoiresB: 1,
      sansVainqueur: 1,
    });
    expect(ff.seSontRencontres && ff.rencontres.map((r) => r.fightId)).toEqual(["F1", "F2", "F3"]);
  });

  it("est symétrique : inverser les deux inverse les colonnes, rien d'autre", () => {
    const direct = faceAFace("ANA", "BOB", F);
    const inverse = faceAFace("BOB", "ANA", F);
    expect(inverse).toMatchObject({ combats: 3, victoiresA: 1, victoiresB: 1, sansVainqueur: 1 });
    expect(direct.seSontRencontres && direct.victoiresA).toBe(
      inverse.seSontRencontres && inverse.victoiresB,
    );
  });

  it("rend la soumission observée, et rien pour les autres méthodes", () => {
    const ff = faceAFace("ANA", "BOB", F);
    const parCombat = new Map(
      (ff.seSontRencontres ? ff.rencontres : []).map((r) => [r.fightId, r]),
    );
    expect(parCombat.get("F1")).toEqual({
      fightId: "F1",
      vainqueur: "ANA",
      winMethod: "submission",
      submissionType: "triangle",
    });
    expect(parCombat.get("F2")?.submissionType).toBeNull();
  });

  it("un bye entre les deux n'est pas une rencontre", () => {
    const f = [
      combat({
        fightId: "F1",
        registrationA: "ANA",
        registrationB: "BOB",
        winner: "ANA",
        winMethod: "bye",
      }),
    ];
    expect(faceAFace("ANA", "BOB", f)).toEqual({ seSontRencontres: false });
  });
});

describe("le score EST la somme des deltas", () => {
  const journal: ScoreEvent[] = [
    { fightId: "F1", side: null, scope: null, delta: null },
    { fightId: "F1", side: "a", scope: "points", delta: 2 },
    { fightId: "F1", side: "a", scope: "points", delta: 3 },
    { fightId: "F1", side: "b", scope: "advantages", delta: 1 },
    { fightId: "F1", side: "b", scope: "penalties", delta: 1 },
    { fightId: "F1", side: "a", scope: "points", delta: -2 },
  ];

  it("annule ce qu'un `undo` a annulé — on ne filtre pas sur le genre d'événement", () => {
    expect(foldScores(journal).get("F1")).toEqual(
      scores({ pointsA: 3, advantagesB: 1, penaltiesB: 1 }),
    );
  });

  it("crée une entrée pour tout combat vu, même sans le moindre delta", () => {
    const plie = foldScores([{ fightId: "F9", side: null, scope: null, delta: null }]);
    expect(plie.has("F9")).toBe(true);
    expect(plie.get("F9")).toEqual(scores());
    expect(plie.get("F404")).toBeUndefined();
  });

  it("ne borne pas à zéro : un total négatif est un journal corrompu, pas un zéro", () => {
    const plie = foldScores([{ fightId: "F1", side: "a", scope: "points", delta: -2 }]);
    expect(plie.get("F1")?.pointsA).toBe(-2);
  });
});

describe("les points, du bon côté", () => {
  const journal: ScoreEvent[] = [
    { fightId: "F1", side: "a", scope: "points", delta: 4 },
    { fightId: "F1", side: "b", scope: "points", delta: 2 },
    { fightId: "F1", side: "a", scope: "advantages", delta: 1 },
    { fightId: "F1", side: "b", scope: "penalties", delta: 3 },
    { fightId: "F2", side: "a", scope: "points", delta: 6 },
    { fightId: "F2", side: "b", scope: "advantages", delta: 2 },
    { fightId: "F2", side: "a", scope: "penalties", delta: 1 },
  ];
  const plie = foldScores(journal);
  const F: FightRecord[] = [
    gagne("F1", "ANA", "BOB", "ANA", "points", { scores: plie.get("F1") }),
    gagne("F2", "CLE", "ANA", "CLE", "points", { scores: plie.get("F2") }),
  ];

  it("marqués et encaissés suivent le côté du combattant, combat par combat", () => {
    const ana = bilan("ANA", F);
    expect(ana.pointsMarques).toBe(4);
    expect(ana.pointsEncaisses).toBe(8);
    expect(ana.avantagesMarques).toBe(3);
    expect(ana.avantagesEncaisses).toBe(0);
  });

  it("une pénalité est portée par celui qui la SUBIT", () => {
    const ana = bilan("ANA", F);
    expect(ana.penalitesRecues).toBe(0);
    expect(ana.penalitesAdverses).toBe(4);
    const bob = bilan("BOB", F);
    expect(bob.penalitesRecues).toBe(3);
    expect(bob.penalitesAdverses).toBe(0);
    const cle = bilan("CLE", F);
    expect(cle.penalitesRecues).toBe(1);
  });

  it("un combat sans journal n'entre dans AUCUN total, et se compte", () => {
    const r = bilan("ANA", [
      gagne("F1", "ANA", "BOB", "ANA", "points", { scores: scores({ pointsA: 4 }) }),
      gagne("F2", "ANA", "CLE", "ANA", "points"),
    ]);
    expect(r.combats).toBe(2);
    expect(r.pointsMarques).toBe(4);
    expect(r.combatsSansJournal).toBe(1);
  });

  it("les combats des autres ne comptent pas dans les siens", () => {
    const r = bilan("ANA", [
      gagne("F1", "ANA", "BOB", "ANA", "points", { scores: scores({ pointsA: 4 }) }),
      gagne("F2", "CLE", "DAN", "CLE", "points", { scores: scores({ pointsA: 99 }) }),
    ]);
    expect(r.combats).toBe(1);
    expect(r.pointsMarques).toBe(4);
  });
});

describe("les soumissions portées", () => {
  it("les 17 types sont ceux de la contrainte de base, et `other` en fait partie", () => {
    expect(SUBMISSION_TYPES).toHaveLength(17);
    expect(isSubmissionType("armbar")).toBe(true);
    expect(isSubmissionType("other")).toBe(true);
    expect(isSubmissionType("clé de bras")).toBe(false);
    expect(isSubmissionType(null)).toBe(false);
  });

  it("`other` est une soumission VUE, un type absent ne l'est pas", () => {
    const r = bilan("ANA", [
      gagne("F1", "ANA", "BOB", "ANA", "submission", { submissionType: "other" }),
      gagne("F2", "ANA", "CLE", "ANA", "submission", { submissionType: null }),
      gagne("F3", "ANA", "DAN", "ANA", "submission", { submissionType: "armbar" }),
    ]);
    expect(r.soumissions.total).toBe(3);
    expect(r.soumissions.parType.get("other")).toBe(1);
    expect(r.soumissions.parType.get("armbar")).toBe(1);
    expect(r.soumissions.typeNonReleve).toBe(1);
  });

  it("une soumission SUBIE n'est pas une soumission portée", () => {
    const F = [
      gagne("F1", "ANA", "BOB", "BOB", "submission", { submissionType: "kimura" }),
      gagne("F2", "ANA", "CLE", "ANA", "submission", { submissionType: "triangle" }),
    ];
    const ana = bilan("ANA", F);
    expect(ana.soumissions.total).toBe(1);
    expect(ana.soumissions.parType.get("triangle")).toBe(1);
    expect(ana.soumissions.parType.get("kimura")).toBeUndefined();
    expect(ana.defaitesParMethode.soumission).toBe(1);
  });

  it("un abandon n'est pas une soumission", () => {
    const r = bilan("ANA", [gagne("F1", "ANA", "BOB", "ANA", "abandon")]);
    expect(r.soumissions.total).toBe(0);
    expect(r.victoiresParMethode.abandon).toBe(1);
    expect(r.victoiresParMethode.soumission).toBe(0);
  });
});

describe("le temps jusqu'à la soumission", () => {
  it("se prend sur LE combat soumis, et sur aucun autre", () => {
    const F = [
      gagne("F1", "ANA", "BOB", "BOB", "submission", {
        submissionType: "armbar",
        finishClockMs: 30_000,
      }),
      gagne("F2", "ANA", "CLE", "ANA", "submission", {
        submissionType: "triangle",
        finishClockMs: 120_000,
      }),
      gagne("F3", "ANA", "DAN", "ANA", "points", { finishClockMs: 5_000 }),
      gagne("F4", "ANA", "ELI", "ANA", "submission", {
        submissionType: "kimura",
        finishClockMs: 200_000,
      }),
    ];
    const r = bilan("ANA", F);
    expect(r.soumissions.total).toBe(2);
    expect(r.soumissions.tempsMesures).toBe(2);
    expect(r.soumissions.plusRapideMs).toBe(120_000);
    expect(r.soumissions.medianeMs).toBe(160_000);
  });

  it("rend une MÉDIANE, et non une moyenne : un combat qui traîne ne déplace pas le centre", () => {
    const F = [
      gagne("F1", "ANA", "BOB", "ANA", "submission", {
        submissionType: "armbar",
        finishClockMs: 20_000,
      }),
      gagne("F2", "ANA", "CLE", "ANA", "submission", {
        submissionType: "triangle",
        finishClockMs: 60_000,
      }),
      gagne("F3", "ANA", "DAN", "ANA", "submission", {
        submissionType: "kimura",
        finishClockMs: 400_000,
      }),
    ];
    const r = bilan("ANA", F);
    expect(r.soumissions.tempsMesures).toBe(3);
    expect(r.soumissions.medianeMs).toBe(60_000);
    expect(r.soumissions.medianeMs).not.toBe(160_000);
    expect(r.soumissions.plusRapideMs).toBe(20_000);
  });

  it("un temps NON RELEVÉ se compte comme tel, jamais comme zéro", () => {
    const r = bilan("ANA", [
      gagne("F1", "ANA", "BOB", "ANA", "submission", { submissionType: "armbar" }),
      gagne("F2", "ANA", "CLE", "ANA", "submission", {
        submissionType: "kimura",
        finishClockMs: null,
      }),
      gagne("F3", "ANA", "DAN", "ANA", "submission", {
        submissionType: "guillotine",
        finishClockMs: 90_000,
      }),
    ]);
    expect(r.soumissions.total).toBe(3);
    expect(r.soumissions.tempsMesures).toBe(1);
    expect(r.soumissions.tempsNonMesures).toBe(2);
    expect(r.soumissions.plusRapideMs).toBe(90_000);
    expect(r.soumissions.medianeMs).toBe(90_000);
  });

  it("aucun temps mesuré rend `null`, et non `0`", () => {
    const r = bilan("ANA", [
      gagne("F1", "ANA", "BOB", "ANA", "submission", { submissionType: "armbar" }),
    ]);
    expect(r.soumissions.total).toBe(1);
    expect(r.soumissions.tempsMesures).toBe(0);
    expect(r.soumissions.plusRapideMs).toBeNull();
    expect(r.soumissions.medianeMs).toBeNull();
  });

  it("une soumission à la première seconde est mesurée, pas absente", () => {
    const r = bilan("ANA", [
      gagne("F1", "ANA", "BOB", "ANA", "submission", {
        submissionType: "guillotine",
        finishClockMs: 0,
      }),
    ]);
    expect(r.soumissions.tempsMesures).toBe(1);
    expect(r.soumissions.tempsNonMesures).toBe(0);
    expect(r.soumissions.plusRapideMs).toBe(0);
  });
});

describe("l'ordre d'entrée ne change aucun compteur", () => {
  const F: FightRecord[] = [
    gagne("F1", "ANA", "BOB", "ANA", "submission", {
      submissionType: "armbar",
      finishClockMs: 60_000,
      scores: scores({ pointsA: 2 }),
    }),
    gagne("F2", "CLE", "ANA", "CLE", "points", { scores: scores({ pointsA: 7, penaltiesB: 2 }) }),
    gagne("F3", "ANA", "DAN", "ANA", "wo"),
    combat({
      fightId: "F4",
      registrationA: "ELI",
      registrationB: "ANA",
      winner: null,
      winMethod: "double_wo",
    }),
  ];

  it("rend le même bilan dans les 24 ordres d'entrée", () => {
    const attendu = statistiquesCombattant("ANA", F);
    for (const ordre of permutations([0, 1, 2, 3])) {
      const melange = ordre.map((i) => F[i] as FightRecord);
      expect(statistiquesCombattant("ANA", melange)).toEqual(attendu);
    }
  });
});

function permutations(xs: readonly number[]): number[][] {
  if (xs.length <= 1) return [[...xs]];
  const out: number[][] = [];
  for (let i = 0; i < xs.length; i++) {
    const reste = [...xs.slice(0, i), ...xs.slice(i + 1)];
    for (const p of permutations(reste)) out.push([xs[i] as number, ...p]);
  }
  return out;
}

describe("release B : les fins sans vainqueur et la désignation entre coéquipiers", () => {
  it("une double disqualification ou une double blessure compte comme disputée, sans vainqueur", () => {
    const r = bilan("ANA", [
      combat({
        fightId: "D1",
        registrationA: "ANA",
        registrationB: "BOB",
        winner: null,
        winMethod: "double_dq",
      }),
      combat({
        fightId: "D2",
        registrationA: "CLE",
        registrationB: "ANA",
        winner: null,
        winMethod: "double_blessure",
      }),
    ]);
    expect(r.combats).toBe(2);
    expect(r.sansVainqueur).toBe(2);
    expect(r.victoires).toBe(0);
    expect(r.defaites).toBe(0);
  });

  it("une désignation n'est pas un combat : elle n'entre pas au bilan (guide v1.2 §7.2)", () => {
    const f = [
      gagne("G1", "ANA", "BOB", "ANA", "points"),
      gagne("G2", "ANA", "CLE", "ANA", "designation"),
    ];
    expect(bilan("ANA", f).combats).toBe(1);
    expect(statistiquesCombattant("CLE", f)).toEqual({ aDesCombats: false });
  });
});

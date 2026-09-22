import {
  arbitragesEnAttente,
  doublerDansLeScenario,
  eliminerDansLeScenario,
  formatDuTableau,
  jouerDansLeScenario,
  natureDeLaFin,
  tableauDeScenario,
  type ArbitrageRequis,
  type EliminationDeScenario,
} from "./arbitrage";
import { estHorsGrille } from "./round-names";
import {
  appliquerLePlan,
  estDisqualifieDisciplinaire,
  estFinSansVainqueur,
  findFeederFight,
  isSlotImpossible,
  loserOf,
  planForfeit,
  pool3Of,
  repechage3Of,
  type PropagationFight,
} from "./bracket-propagation";
import type { ThirdPlaceMode } from "./enums";
import { METHODES_SANS_COMBAT } from "./fight-rest";

export type StatutDisciplinaire = "aucune" | "en_attente" | "validee";

export type EliminationDuJour = { statut: string; motif: string | null };

export type EligibiliteInscription = {
  registrationId: string;
  elimination: EliminationDuJour | null;
  aCombattu: boolean;
  checkInValide: boolean;
  disciplinaire: StatutDisciplinaire;
};

export type MotifVacance = "disqualification" | "disqualification_disciplinaire" | "blessure";

export type RangDePodium = 1 | 2 | 3;

export type PlaceOfficielle = {
  rang: RangDePodium;
  ordre: number;
  registrationId: string | null;
  motifVacance: MotifVacance | null;
};

export type PlaceSaisie = {
  rang: RangDePodium;
  registrationId: string | null;
  motifVacance: MotifVacance | null;
};

export type EntreeClassement = {
  fights: readonly PropagationFight[];
  thirdPlaceMode: ThirdPlaceMode;
  seulInscrit?: string | null;
  eligibilite?: readonly EligibiliteInscription[];
  classementSaisi?: readonly PlaceSaisie[] | null;
};

export type EtatClassement =
  | "en_cours"
  | "complet"
  | "terminee_sans_medaille"
  | "arbitrage_requis"
  | "disciplinaire_en_attente";

export type ClassementOfficiel = {
  etat: EtatClassement;
  places: PlaceOfficielle[];
  arbitrage: ArbitrageRequis | null;
  manquant: string[];
  motifSansMedaille: string | null;
};

export function libelleElimination(e: EliminationDuJour): string {
  if (e.motif === "overweight") return "hors poids";
  if (e.motif === "invalid_id") return "identité non valide";
  if (e.motif === "no_show" || e.statut === "no_show") return "absent";
  if (e.statut === "medical_withdrawal") return "raison médicale";
  if (e.statut === "withdrawn") return "forfait déclaré";
  return "éliminé au check-in";
}

export const LIBELLES_MOTIF_VACANCE: Record<MotifVacance, string> = {
  disqualification: "disqualification",
  disqualification_disciplinaire: "disqualification disciplinaire",
  blessure: "blessure des deux combattants",
};

export function estClassable(e: EligibiliteInscription): boolean {
  if (e.disciplinaire === "validee") return false;
  return e.aCombattu || e.elimination === null;
}

export function aCombattuDansLesCombats(
  fights: readonly PropagationFight[],
  registrationId: string,
): boolean {
  return fights.some(
    (f) =>
      (f.slotA === registrationId || f.slotB === registrationId) &&
      f.state === "finished" &&
      f.winMethod !== null &&
      !METHODES_SANS_COMBAT.includes(f.winMethod),
  );
}

type PlaceBrute = {
  rang: RangDePodium;
  registrationId: string | null;
  motifVacance: MotifVacance | null;
  source: PropagationFight | null;
  aChainer?: boolean;
};

type Contexte = {
  fights: PropagationFight[];
  elig: (r: string) => EligibiliteInscription;
  classable: (r: string) => boolean;
};

const pourvue = (
  rang: RangDePodium,
  registrationId: string | null,
  source: PropagationFight | null,
): PlaceBrute[] =>
  registrationId === null ? [] : [{ rang, registrationId, motifVacance: null, source }];

const vacante = (rang: RangDePodium, motifVacance: MotifVacance): PlaceBrute => ({
  rang,
  registrationId: null,
  motifVacance,
  source: null,
});

function combat(ctx: Contexte, division: number, indexInDivision: number): PropagationFight | null {
  return (
    ctx.fights.find(
      (f) =>
        f.type === "BraketFight" &&
        f.division === division &&
        f.indexInDivision === indexInDivision,
    ) ?? null
  );
}

const fini = (f: PropagationFight | null): f is PropagationFight =>
  f !== null && f.state === "finished";

function sansVainqueur(f: PropagationFight | null): boolean {
  return fini(f) && estFinSansVainqueur(f) && f.winner === null;
}

function victimeAnterieure(
  ctx: Contexte,
  f: PropagationFight,
  athlete: string,
): { registrationId: string; source: PropagationFight } | null {
  const cote = f.slotA === athlete ? "A" : f.slotB === athlete ? "B" : null;
  if (cote === null) return null;
  const nourricier = findFeederFight(ctx.fights, f, cote);
  if (!nourricier || nourricier.isBye || !fini(nourricier)) return null;
  if (nourricier.winner !== athlete) return null;
  const perdant = loserOf(nourricier);
  return perdant === null ? null : { registrationId: perdant, source: nourricier };
}

function recence(f: PropagationFight): number {
  if (f.type === "BraketFightPool3") return 1;
  if (f.type === "BraketFightRepechage3") return 1.5;
  if (f.division === 1) return f.indexInDivision >= 1 ? -1 : 0;
  if (f.division === 2 && f.indexInDivision >= 2) return 1.8;
  return f.division;
}

function dqDisciplinaireDans(f: PropagationFight, r: string): boolean {
  if (!fini(f)) return false;
  if (f.winMethod === "dq") return f.dqReason === "disciplinaire" && loserOf(f) === r;
  if (f.winMethod === "double_dq") {
    return (
      (f.slotA === r && f.dqReasonA === "disciplinaire") ||
      (f.slotB === r && f.dqReasonB === "disciplinaire")
    );
  }
  return false;
}

function disciplinairePendant(ctx: Contexte, r: string, f: PropagationFight | null): boolean {
  if (f === null || !dqDisciplinaireDans(f, r)) return false;
  return !ctx.fights.some(
    (x) => x.id !== f.id && (x.slotA === r || x.slotB === r) && x.winner !== r && !x.isBye,
  );
}

function placesDeLaDoubleFin(ctx: Contexte, rang: RangDePodium, f: PropagationFight): PlaceBrute[] {
  const nature = natureDeLaFin(f);
  if (nature === "technique" || nature === "blessure") {
    return [...pourvue(rang, f.slotA, f), ...pourvue(rang, f.slotB, f)];
  }
  if (nature === "disciplinaire") return [vacante(rang, "disqualification_disciplinaire")];
  if (nature === "mixte") {
    const technique = f.dqReasonA === "disciplinaire" ? f.slotB : f.slotA;
    return pourvue(rang, technique, f);
  }
  return [];
}

function quiOntCombattu(ctx: Contexte, rang: RangDePodium, f: PropagationFight): PlaceBrute[] {
  return [f.slotA, f.slotB]
    .filter((r): r is string => r !== null && ctx.elig(r).aCombattu && ctx.classable(r))
    .flatMap((r) => pourvue(rang, r, f));
}

function bronzeDeLaDemie(ctx: Contexte, demie: PropagationFight | null): PlaceBrute[] {
  if (!fini(demie) || demie.isBye) return [];
  if (sansVainqueur(demie)) return placesDeLaDoubleFin(ctx, 3, demie);
  if (demie.winMethod === "double_wo") return quiOntCombattu(ctx, 3, demie);
  if (demie.winner === null) return [];
  const perdant = loserOf(demie);
  if (perdant !== null) return pourvue(3, perdant, demie);
  const victime = victimeAnterieure(ctx, demie, demie.winner);
  return victime ? pourvue(3, victime.registrationId, victime.source) : [];
}

function bronzeDuCombatDe3e(
  ctx: Contexte,
  p3: PropagationFight,
  demies: readonly (PropagationFight | null)[],
): PlaceBrute[] {
  if (fini(p3)) {
    if (p3.winner !== null) return pourvue(3, p3.winner, p3);
    if (sansVainqueur(p3)) {
      if (p3.arbitrage !== null && p3.arbitrage !== undefined) {
        return [vacante(3, "disqualification")];
      }
      return placesDeLaDoubleFin(ctx, 3, p3);
    }
    if (p3.winMethod === "double_wo") return [vacante(3, "disqualification")];
  }
  for (const d of demies) {
    if (!fini(d) || d.winner === null) continue;
    const perdant = loserOf(d);
    if (perdant !== null && !ctx.classable(perdant)) {
      return [vacante(3, motifDInegibilite(ctx, perdant))];
    }
  }
  return [];
}

function motifDInegibilite(ctx: Contexte, r: string): MotifVacance {
  return ctx.elig(r).disciplinaire === "validee"
    ? "disqualification_disciplinaire"
    : "disqualification";
}

function bronzesOrdinaires(ctx: Contexte): PlaceBrute[] {
  const demies = [combat(ctx, 2, 0), combat(ctx, 2, 1)];
  const p3 = pool3Of(ctx.fights);
  if (p3) return bronzeDuCombatDe3e(ctx, p3, demies);
  return demies.flatMap((d) => bronzeDeLaDemie(ctx, d));
}

function perdantsDesQuarts(ctx: Contexte, i: 0 | 1): PlaceBrute[] {
  return [2 * i, 2 * i + 1].flatMap((k) => {
    const quart = combat(ctx, 3, k);
    if (!fini(quart) || quart.isBye || quart.winner === null) return [];
    return pourvue(3, loserOf(quart), quart);
  });
}

function quelquunACombattuDuCote(ctx: Contexte, i: 0 | 1): boolean {
  for (const f of ctx.fights) {
    if (f.type !== "BraketFight" || f.division < 2) continue;
    if (f.division === 2 && f.indexInDivision > 1) continue;
    const cote = Math.floor(f.indexInDivision / 2 ** (f.division - 2));
    if (cote !== i) continue;
    for (const r of [f.slotA, f.slotB]) {
      if (r !== null && ctx.elig(r).aCombattu) return true;
    }
  }
  return false;
}

function vainqueurDeFinale(ctx: Contexte, finale: PropagationFight | null): string | null {
  if (finale === null) return null;
  if (finale.state === "finished") return finale.winner;
  if (finale.state !== "cancelled") return null;
  const presents = [finale.slotA, finale.slotB].filter((r): r is string => r !== null);
  if (presents.length !== 1) return null;
  const seul = presents[0]!;
  return ctx.classable(seul) && ctx.elig(seul).aCombattu ? seul : null;
}

function vacanceDuBronzeDe(places: PlaceBrute[], r: string, motif: MotifVacance): PlaceBrute[] {
  const i = places.findIndex((p) => p.rang === 3 && p.registrationId === r);
  if (i < 0) return places;
  const copie = [...places];
  copie[i] = vacante(3, motif);
  return copie;
}

function placesDeux(ctx: Contexte): PlaceBrute[] {
  const finale = combat(ctx, 1, 0);
  if (!fini(finale)) return [];
  if (finale.winner !== null) {
    return [...pourvue(1, finale.winner, finale), ...pourvue(2, loserOf(finale), finale)];
  }
  if (estFinSansVainqueur(finale)) {
    const nature = natureDeLaFin(finale);
    if (nature === "disciplinaire") {
      return [
        vacante(1, "disqualification_disciplinaire"),
        vacante(2, "disqualification_disciplinaire"),
      ];
    }
    return [vacante(1, "disqualification"), ...placesDeLaDoubleFin(ctx, 2, finale)];
  }
  if (finale.winMethod === "double_wo") {
    return [vacante(1, "disqualification"), vacante(2, "disqualification")];
  }
  return [];
}

function placesTrois(ctx: Contexte): PlaceBrute[] {
  const finale = combat(ctx, 1, 0);
  const rep = repechage3Of(ctx.fights);
  const demie =
    ctx.fights.find(
      (f) => f.type === "BraketFight" && f.division === 2 && f.indexInDivision <= 1,
    ) ?? null;

  const bronze = (): PlaceBrute[] => {
    if (fini(demie) && sansVainqueur(demie)) return placesDeLaDoubleFin(ctx, 3, demie);
    if (!fini(rep)) return [];
    if (sansVainqueur(rep)) return placesDeLaDoubleFin(ctx, 3, rep);
    if (rep.winner !== null) {
      const perdant = loserOf(rep);
      if (perdant !== null) return pourvue(3, perdant, rep);
      const perdantDemie = fini(demie) && demie.winner !== null ? loserOf(demie) : null;
      if (perdantDemie !== null && !ctx.classable(perdantDemie)) {
        return [vacante(3, motifDInegibilite(ctx, perdantDemie))];
      }
      return [];
    }
    if (rep.winMethod === "double_wo") return quiOntCombattu(ctx, 3, rep);
    return [];
  };

  const champion = vainqueurDeFinale(ctx, finale);
  if (finale && champion !== null) {
    const perdant = finale.state === "finished" ? loserOf(finale) : null;
    const places = [...pourvue(1, champion, finale)];
    if (perdant !== null) {
      if (!ctx.classable(perdant) && disciplinairePendant(ctx, perdant, finale)) {
        const victime = victimeAnterieure(ctx, finale, champion);
        if (victime && ctx.classable(victime.registrationId)) {
          return [
            ...places,
            ...pourvue(2, victime.registrationId, victime.source),
            ...vacanceDuBronzeDe(
              bronze(),
              victime.registrationId,
              "disqualification_disciplinaire",
            ),
          ];
        }
        return [...places, vacante(2, "disqualification_disciplinaire"), ...bronze()];
      }
      return [...places, ...pourvue(2, perdant, finale), ...bronze()];
    }
    const cote = finale.slotA === champion ? "B" : "A";
    const nourricier = findFeederFight(ctx.fights, finale, cote);
    if (fini(nourricier) && nourricier.winMethod === "double_wo") {
      if (quiOntCombattu(ctx, 2, nourricier).length > 0)
        places.push(vacante(2, "disqualification"));
    }
    if (fini(nourricier) && sansVainqueur(nourricier) && natureDeLaFin(nourricier) === "blessure") {
      places.push(vacante(2, "blessure"));
    }
    return [...places, ...bronze()];
  }

  if (!fini(finale)) return bronze();

  if (estFinSansVainqueur(finale) && natureDeLaFin(finale) === "technique") {
    const champion = fini(rep) ? loserOf(rep) : null;
    return [
      ...pourvue(1, champion, rep),
      ...pourvue(2, finale.slotA, finale),
      ...pourvue(2, finale.slotB, finale),
    ];
  }

  if (finale.winMethod === "double_wo") {
    return [vacante(1, "disqualification"), ...quiOntCombattu(ctx, 2, finale), ...bronze()];
  }
  return bronze();
}

function placesQuatre(ctx: Contexte): PlaceBrute[] {
  const finale = combat(ctx, 1, 0);
  const rejouee = combat(ctx, 1, 1);
  const demies = [combat(ctx, 2, 0), combat(ctx, 2, 1)] as const;

  const [demie0, demie1] = demies;
  if (demie0 && demie1 && sansVainqueur(demie0) && sansVainqueur(demie1) && fini(rejouee)) {
    const places = [
      ...pourvue(1, rejouee.winner, rejouee),
      ...pourvue(2, loserOf(rejouee), rejouee),
    ];
    if (natureDeLaFin(demie0) === "technique") {
      for (const d of [demie0, demie1]) {
        places.push(...pourvue(3, d.slotA, d), ...pourvue(3, d.slotB, d));
      }
    } else {
      for (const k of [2, 3]) {
        const sup = combat(ctx, 2, k);
        if (fini(sup) && sup.winner !== null) places.push(...pourvue(3, loserOf(sup), sup));
      }
    }
    return places;
  }

  if (finale && sansVainqueur(finale) && natureDeLaFin(finale) !== "blessure" && fini(rejouee)) {
    const nature = natureDeLaFin(finale);
    const vainqueur = rejouee.winner;
    const perdant = loserOf(rejouee);
    if (nature === "technique") {
      return [
        ...pourvue(1, vainqueur, rejouee),
        ...pourvue(2, finale.slotA, finale),
        ...pourvue(2, finale.slotB, finale),
        ...pourvue(3, perdant, rejouee),
      ];
    }
    if (nature === "mixte") {
      return [
        ...pourvue(1, vainqueur, rejouee),
        ...placesDeLaDoubleFin(ctx, 2, finale),
        ...pourvue(3, perdant, rejouee),
      ];
    }
    const troisiemes = [rejouee.slotA, rejouee.slotB].flatMap((finaliste) => {
      if (finaliste === null) return [];
      const demie = demies.find((d) => fini(d) && loserOf(d) === finaliste) ?? null;
      const victime = demie ? victimeAnterieure(ctx, demie, finaliste) : null;
      return victime ? pourvue(3, victime.registrationId, victime.source) : [];
    });
    return [...pourvue(1, vainqueur, rejouee), ...pourvue(2, perdant, rejouee), ...troisiemes];
  }

  const champion = vainqueurDeFinale(ctx, finale);
  if (finale && champion !== null) {
    const i: 0 | 1 = finale.slotA === champion ? 0 : 1;
    const j: 0 | 1 = i === 0 ? 1 : 0;
    const perdant = finale.state === "finished" ? loserOf(finale) : null;
    const places = [...pourvue(1, champion, finale)];
    const eliminationSansCombat =
      perdant !== null && ctx.elig(perdant).elimination !== null && !ctx.elig(perdant).aCombattu;

    if (perdant !== null && !eliminationSansCombat) {
      if (!ctx.classable(perdant) && disciplinairePendant(ctx, perdant, finale)) {
        const victime = victimeAnterieure(ctx, finale, champion);
        const bronzes = bronzesOrdinaires(ctx);
        if (victime && ctx.classable(victime.registrationId)) {
          return [
            ...places,
            ...pourvue(2, victime.registrationId, victime.source),
            ...vacanceDuBronzeDe(bronzes, victime.registrationId, "disqualification_disciplinaire"),
          ];
        }
        return [...places, vacante(2, "disqualification_disciplinaire"), ...bronzes];
      }
      return [...places, ...pourvue(2, perdant, finale), ...bronzesOrdinaires(ctx)];
    }

    const demieI = demies[i];
    const demieJ = demies[j];
    if (demieJ && sansVainqueur(demieJ)) {
      const argent = fini(demieI) && demieI.winner !== null ? loserOf(demieI) : null;
      return [...places, ...pourvue(2, argent, demieI), ...placesDeLaDoubleFin(ctx, 3, demieJ)];
    }
    if (!quelquunACombattuDuCote(ctx, j)) {
      const argent = fini(demieI) && demieI.winner !== null ? loserOf(demieI) : null;
      return [...places, ...pourvue(2, argent, demieI), ...perdantsDesQuarts(ctx, i)];
    }
    places.push(vacante(2, "disqualification"));
    const p3 = pool3Of(ctx.fights);
    if (p3) return [...places, ...bronzeDuCombatDe3e(ctx, p3, demies)];
    return [
      ...places,
      ...bronzeDeLaDemie(ctx, demieI),
      ...(fini(demieJ) && demieJ.winMethod === "double_wo"
        ? quiOntCombattu(ctx, 3, demieJ)
        : bronzeDeLaDemie(ctx, demieJ)),
    ];
  }

  if (fini(finale) && finale.winMethod === "double_wo") {
    return [
      vacante(1, "disqualification"),
      ...quiOntCombattu(ctx, 2, finale),
      ...bronzesOrdinaires(ctx),
    ];
  }

  return demies.flatMap((d) => bronzeDeLaDemie(ctx, d));
}

function appliquerEligibilite(ctx: Contexte, places: PlaceBrute[]): PlaceBrute[] {
  const sortie: PlaceBrute[] = [];
  for (const p of places) {
    const r = p.registrationId;
    if (r === null || ctx.classable(r)) {
      sortie.push(p);
      continue;
    }
    const e = ctx.elig(r);
    if (e.disciplinaire === "validee") {
      sortie.push(
        disciplinairePendant(ctx, r, p.source)
          ? vacante(p.rang, "disqualification_disciplinaire")
          : { ...p, aChainer: true },
      );
      continue;
    }
    const adversaire =
      p.source && p.source.winner !== null && p.source.winner !== r ? p.source.winner : null;
    const victime = adversaire && p.source ? victimeAnterieure(ctx, p.source, adversaire) : null;
    const dejaPlace = (x: string) =>
      places.some((q) => q.registrationId === x) || sortie.some((q) => q.registrationId === x);
    if (victime && ctx.classable(victime.registrationId) && !dejaPlace(victime.registrationId)) {
      sortie.push(...pourvue(p.rang, victime.registrationId, victime.source));
    } else {
      sortie.push(vacante(p.rang, "disqualification"));
    }
  }
  return sortie;
}

function appliquerRemontees(ctx: Contexte, places: PlaceBrute[]): PlaceBrute[] {
  const out = places.map((p) => ({ ...p }));
  const aChainer = out
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.aChainer && p.registrationId !== null)
    .sort((x, y) => x.p.rang - y.p.rang);

  for (const { p, i } of aChainer) {
    const disqualifie = p.registrationId as string;
    const victimes = ctx.fights
      .filter((f) => fini(f) && !f.isBye && f.winner === disqualifie && loserOf(f) !== null)
      .sort((x, y) => recence(x) - recence(y))
      .map((f) => ({ registrationId: loserOf(f) as string, source: f }));

    let libre: number | null = i;
    out[i] = { ...out[i]!, registrationId: null, aChainer: false };
    for (const v of victimes) {
      if (libre === null) break;
      if (!ctx.classable(v.registrationId)) continue;
      const ancienne = out.findIndex((q) => q.registrationId === v.registrationId);
      const cible = out[libre]!;
      out[libre] = {
        rang: cible.rang,
        registrationId: v.registrationId,
        motifVacance: null,
        source: v.source,
      };
      libre = ancienne >= 0 ? ancienne : null;
      if (ancienne >= 0) out[ancienne] = { ...out[ancienne]!, registrationId: null };
    }
    if (libre !== null) {
      out[libre] = vacante(out[libre]!.rang, "disqualification_disciplinaire");
    }
  }
  return out.filter((p) => p.registrationId !== null || p.motifVacance !== null);
}

function normaliser(places: readonly PlaceBrute[]): PlaceOfficielle[] {
  const vus = new Set<string>();
  const uniques = places.filter((p) => {
    if (p.registrationId === null) return true;
    if (vus.has(p.registrationId)) return false;
    vus.add(p.registrationId);
    return true;
  });
  const tries = [...uniques].sort((a, b) => a.rang - b.rang);
  const ordres = new Map<RangDePodium, number>();
  return tries.map((p) => {
    const ordre = (ordres.get(p.rang) ?? 0) + 1;
    ordres.set(p.rang, ordre);
    return {
      rang: p.rang,
      ordre,
      registrationId: p.registrationId,
      motifVacance: p.registrationId === null ? p.motifVacance : null,
    };
  });
}

function lecteurDEligibilite(entree: EntreeClassement) {
  const table = new Map((entree.eligibilite ?? []).map((e) => [e.registrationId, e] as const));
  const elig = (r: string): EligibiliteInscription =>
    table.get(r) ?? {
      registrationId: r,
      elimination: null,
      aCombattu: aCombattuDansLesCombats(entree.fights, r),
      checkInValide: false,
      disciplinaire: estDisqualifieDisciplinaire(entree.fights, r) ? "validee" : "aucune",
    };
  return { elig, classable: (r: string) => estClassable(elig(r)), table };
}

const participantsDe = (fights: readonly PropagationFight[]): Set<string> => {
  const s = new Set<string>();
  for (const f of fights) {
    if (f.slotA) s.add(f.slotA);
    if (f.slotB) s.add(f.slotB);
  }
  return s;
};

function libelleManquant(f: PropagationFight): string {
  if (f.type === "BraketFightPool3") return "Combat pour la 3e place non terminé";
  if (f.type === "BraketFightRepechage3") return "2e demi-finale non terminée";
  if (f.division === 1 && f.indexInDivision === 0) return "Finale non terminée";
  // L'APPARTENANCE VIENT DE `round-names`, elle ne se réécrit plus ici. Le test
  // manuscrit qu'elle remplace avait divergé sur les deux bornes que la fonction
  // du noyau pose : le TYPE, et la division BASSE. `f.division <= 2 && (… ||
  // f.indexInDivision >= 2)` rangeait donc parmi les combats d'arbitrage le 3e
  // combat d'une POULE (division 0, index 2), et le Responsable lisait « Combats
  // d'arbitrage non terminés » sur une catégorie qui n'en a jamais eu. Défaut
  // ANTÉRIEUR à la nomenclature du 22/09/2026 : il n'attendait qu'un lecteur.
  if (estHorsGrille(f)) return "Combats d'arbitrage non terminés";
  if (f.division === 2) return "Demi-finale non terminée";
  return "Combats non terminés";
}

const resultat = (
  etat: EtatClassement,
  extra: Partial<Omit<ClassementOfficiel, "etat">> = {},
): ClassementOfficiel => ({
  etat,
  places: [],
  arbitrage: null,
  manquant: [],
  motifSansMedaille: null,
  ...extra,
});

export function classementOfficiel(entree: EntreeClassement): ClassementOfficiel {
  const { elig, classable } = lecteurDEligibilite(entree);
  const brut = entree.fights;

  if (brut.length === 0) {
    const seul = entree.seulInscrit ?? null;
    if (seul === null)
      return resultat("en_cours", { manquant: ["Aucun combat dans cette catégorie"] });
    const e = elig(seul);
    if (e.disciplinaire === "validee") {
      return resultat("terminee_sans_medaille", {
        motifSansMedaille: "Disqualifié(e) : disqualification disciplinaire. Aucune médaille.",
      });
    }
    if (e.elimination !== null) {
      return resultat("terminee_sans_medaille", {
        motifSansMedaille: `Disqualifié(e) : ${libelleElimination(e.elimination)}. Aucune médaille.`,
      });
    }
    if (e.disciplinaire === "en_attente") {
      return resultat("disciplinaire_en_attente", {
        manquant: ["Disqualification disciplinaire en attente de validation"],
      });
    }
    if (!e.checkInValide) {
      return resultat("en_cours", {
        manquant: ["Seul inscrit : check-in non validé (identité et pesée), pas de médaille avant"],
      });
    }
    return resultat("complet", { places: normaliser(pourvue(1, seul, null)) });
  }

  if (entree.classementSaisi) {
    const places = normaliser(
      entree.classementSaisi.map((p) =>
        p.registrationId !== null && !classable(p.registrationId)
          ? vacante(
              p.rang,
              elig(p.registrationId).disciplinaire === "validee"
                ? "disqualification_disciplinaire"
                : "disqualification",
            )
          : { ...p, source: null },
      ),
    );
    return resultat(
      places.some((p) => p.registrationId !== null) ? "complet" : "terminee_sans_medaille",
      { places },
    );
  }

  const attente = arbitragesEnAttente(brut, classable);
  if (attente.length > 0) {
    const premier = attente[0]!;
    return resultat("arbitrage_requis", { arbitrage: premier, manquant: [premier.regle.libelle] });
  }

  const participants = participantsDe(brut);
  const elimines = new Set([...participants].filter((r) => elig(r).elimination !== null));
  const fights = appliquerLePlan(brut, planForfeit(brut, elimines));

  const restants = fights.filter(
    (f) => !f.isBye && f.state !== "finished" && f.state !== "cancelled",
  );
  if (restants.length > 0) {
    return resultat("en_cours", { manquant: [...new Set(restants.map(libelleManquant))] });
  }

  if ([...participants].some((r) => elig(r).disciplinaire === "en_attente")) {
    return resultat("disciplinaire_en_attente", {
      manquant: ["Disqualification disciplinaire en attente de validation"],
    });
  }

  const ctx: Contexte = { fights, elig, classable };
  const format = formatDuTableau(fights);
  const brutes =
    format === "deux" ? placesDeux(ctx) : format === "trois" ? placesTrois(ctx) : placesQuatre(ctx);
  const places = normaliser(appliquerRemontees(ctx, appliquerEligibilite(ctx, brutes)));
  return resultat(
    places.some((p) => p.registrationId !== null) ? "complet" : "terminee_sans_medaille",
    { places },
  );
}

export function estTermineeSansMedaille(entree: EntreeClassement): boolean {
  const { elig, classable } = lecteurDEligibilite(entree);
  const fights = entree.fights;

  if (fights.length === 0) {
    const seul = entree.seulInscrit ?? null;
    if (seul === null) return false;
    const e = elig(seul);
    return e.disciplinaire === "validee" || e.elimination !== null;
  }

  if (entree.classementSaisi) return !entree.classementSaisi.some((p) => p.registrationId !== null);

  if (arbitragesEnAttente(fights, classable).length > 0) return false;

  const elimines = new Set([...participantsDe(fights)].filter((r) => elig(r).elimination !== null));
  const estElimine = (r: string) => elimines.has(r);
  const reste = fights.some(
    (f) =>
      !f.isBye &&
      f.state !== "finished" &&
      f.state !== "cancelled" &&
      ((f.slotA !== null && f.slotB !== null && !estElimine(f.slotA) && !estElimine(f.slotB)) ||
        (f.slotA === null && !isSlotImpossible(fights, f, "A", elimines)) ||
        (f.slotB === null && !isSlotImpossible(fights, f, "B", elimines))),
  );
  if (reste) return false;

  if ([...participantsDe(fights)].some((r) => elig(r).disciplinaire === "en_attente")) return false;

  const zone = participantsDe(fights.filter((f) => f.division <= 2));
  return ![...zone].some(classable);
}

export function medaillesDuClassement(places: readonly PlaceOfficielle[]): {
  or: number;
  argent: number;
  bronze: number;
} {
  const pourvues = places.filter((p) => p.registrationId !== null);
  return {
    or: pourvues.filter((p) => p.rang === 1).length,
    argent: pourvues.filter((p) => p.rang === 2).length,
    bronze: pourvues.filter((p) => p.rang === 3).length,
  };
}

export function libellePlaceVacante(place: Pick<PlaceOfficielle, "rang" | "motifVacance">): string {
  const rang = place.rang === 1 ? "1re" : `${place.rang}e`;
  const motif = place.motifVacance ? ` (${LIBELLES_MOTIF_VACANCE[place.motifVacance]})` : "";
  return `${rang} place vacante${motif}`;
}

export type ScenarioSansMedaille = {
  id: string;
  inscrits: number;
  thirdPlaceMode: "pool3" | "shared_bronze";
  seulInscrit: string | null;
  fights: PropagationFight[];
  eliminations: EliminationDeScenario[];
  classementSaisi: PlaceSaisie[] | null;
  attendu: boolean;
};

export function entreeDuScenario(s: ScenarioSansMedaille): EntreeClassement {
  const regs = new Set<string>();
  for (const f of s.fights) {
    if (f.slotA) regs.add(f.slotA);
    if (f.slotB) regs.add(f.slotB);
  }
  if (s.seulInscrit) regs.add(s.seulInscrit);
  const elims = new Map(s.eliminations.map((e) => [e.registrationId, e] as const));
  return {
    fights: s.fights,
    thirdPlaceMode: s.thirdPlaceMode,
    seulInscrit: s.seulInscrit,
    classementSaisi: s.classementSaisi,
    eligibilite: [...regs].map((r) => ({
      registrationId: r,
      elimination: elims.has(r)
        ? { statut: elims.get(r)!.statut, motif: elims.get(r)!.motif }
        : null,
      aCombattu: aCombattuDansLesCombats(s.fights, r),
      checkInValide: !elims.has(r),
      disciplinaire: estDisqualifieDisciplinaire(s.fights, r) ? "validee" : "aucune",
    })),
  };
}

export function scenariosTermineeSansMedaille(): ScenarioSansMedaille[] {
  const K = (d: number, i: number) => `${d}:${i}:BraketFight`;
  const absent = (r: string): EliminationDeScenario => ({
    registrationId: r,
    statut: "no_show",
    motif: "no_show",
  });
  const base = (
    id: string,
    inscrits: number,
    fights: PropagationFight[],
    attendu: boolean,
    extra: Partial<ScenarioSansMedaille> = {},
  ): ScenarioSansMedaille => ({
    id,
    inscrits,
    thirdPlaceMode: "shared_bronze",
    seulInscrit: null,
    fights,
    eliminations: [],
    classementSaisi: null,
    attendu,
    ...extra,
  });
  const deux = tableauDeScenario(2);
  const quatre = tableauDeScenario(4);
  const demiesDisciplinaires = doublerDansLeScenario(
    doublerDansLeScenario(quatre, K(2, 0), "disciplinaire"),
    K(2, 1),
    "disciplinaire",
  );
  const demiesMelangees = doublerDansLeScenario(
    doublerDansLeScenario(quatre, K(2, 0), "technique"),
    K(2, 1),
    "disciplinaire",
  );
  const quatreJoue = (() => {
    let t = jouerDansLeScenario(jouerDansLeScenario(quatre, K(2, 0), "A"), K(2, 1), "A");
    t = jouerDansLeScenario(t, K(1, 0), "A");
    return t;
  })();
  const cinq = tableauDeScenario(5);
  const cinqQuartEtAbsents = eliminerDansLeScenario(
    doublerDansLeScenario(cinq, K(3, 0), "technique"),
    new Set(["r2", "r3", "r4"]),
  );

  return [
    base("seul.absent", 1, [], true, { seulInscrit: "r1", eliminations: [absent("r1")] }),
    base("seul.present", 1, [], false, { seulInscrit: "r1" }),
    base(
      "deux.double_dq_disciplinaire",
      2,
      doublerDansLeScenario(deux, K(1, 0), "disciplinaire"),
      true,
    ),
    base("deux.double_dq_technique", 2, doublerDansLeScenario(deux, K(1, 0), "technique"), false),
    base("deux.double_dq_mixte", 2, doublerDansLeScenario(deux, K(1, 0), "mixte"), false),
    base(
      "deux.double_blessure_tirage_en_attente",
      2,
      doublerDansLeScenario(deux, K(1, 0), "blessure"),
      false,
    ),
    base("deux.double_forfait", 2, eliminerDansLeScenario(deux, new Set(["r1", "r2"])), true, {
      eliminations: [absent("r1"), absent("r2")],
    }),
    base("deux.un_absent", 2, eliminerDansLeScenario(deux, new Set(["r2"])), false, {
      eliminations: [absent("r2")],
    }),
    base(
      "trois.tous_absents",
      3,
      eliminerDansLeScenario(tableauDeScenario(3), new Set(["r1", "r2", "r3"])),
      true,
      {
        eliminations: [absent("r1"), absent("r2"), absent("r3")],
      },
    ),
    base("quatre.en_cours", 4, quatre, false),
    base("quatre.joue", 4, quatreJoue, false),
    base("quatre.demies_disciplinaires_classement_attendu", 4, demiesDisciplinaires, false),
    base("quatre.demies_disciplinaires_classement_vide", 4, demiesDisciplinaires, true, {
      classementSaisi: [],
    }),
    base("quatre.demies_melangees_classement_saisi", 4, demiesMelangees, false, {
      classementSaisi: [{ rang: 1, registrationId: "r1", motifVacance: null }],
    }),
    base(
      "quatre.un_seul_present",
      4,
      eliminerDansLeScenario(quatre, new Set(["r2", "r3", "r4"])),
      false,
      { eliminations: [absent("r2"), absent("r3"), absent("r4")] },
    ),
    base("cinq.quart_double_dq_et_absents", 5, cinqQuartEtAbsents, true, {
      eliminations: [absent("r2"), absent("r3"), absent("r4")],
    }),
  ];
}

import {
  doublerDansLeScenario,
  eliminerDansLeScenario,
  jouerDansLeScenario,
  tableauDeScenario,
  type NatureFinSansVainqueur,
} from "../src/arbitrage";
import {
  appliquerLePlan,
  estDisqualifieDisciplinaire,
  planArbitrage,
  planFinishSansVainqueur,
  type MotifDeDisqualification,
  type PropagationFight,
  type WinMethod,
} from "../src/bracket-propagation";
import {
  aCombattuDansLesCombats,
  classementOfficiel,
  type EligibiliteInscription,
  type EntreeClassement,
  type PlaceOfficielle,
  type StatutDisciplinaire,
} from "../src/podium-officiel";

export const K = (d: number, i: number, t: PropagationFight["type"] = "BraketFight") =>
  `${d}:${i}:${t}`;
export const P3 = K(2, 2, "BraketFightPool3");

export class Tableau {
  fights: PropagationFight[];
  elimines = new Set<string>();
  disciplinairesApres = new Set<string>();
  enAttente = new Set<string>();
  valides = new Set<string>();
  constructor(
    readonly n: number,
    readonly mode: "pool3" | "shared_bronze" = "shared_bronze",
  ) {
    this.fights = tableauDeScenario(n, mode);
  }
  combat(id: string): PropagationFight {
    const f = this.fights.find((x) => x.id === id);
    if (!f) throw new Error(`combat ${id} introuvable`);
    return f;
  }
  gagne(id: string, cote: "A" | "B", methode: WinMethod = "points"): this {
    this.fights = jouerDansLeScenario(this.fights, id, cote, methode, this.elimines);
    return this;
  }
  gagneParDq(id: string, cote: "A" | "B", motif: MotifDeDisqualification): this {
    this.gagne(id, cote, "dq");
    this.fights = this.fights.map((f) => (f.id === id ? { ...f, dqReason: motif } : f));
    return this;
  }
  doubleDq(id: string, motifA: MotifDeDisqualification, motifB: MotifDeDisqualification): this {
    this.fights = appliquerLePlan(
      this.fights,
      planFinishSansVainqueur(
        this.fights,
        id,
        { method: "double_dq", dqReasonA: motifA, dqReasonB: motifB },
        this.elimines,
      ),
    );
    return this;
  }
  double(id: string, nature: NatureFinSansVainqueur): this {
    this.fights = doublerDansLeScenario(this.fights, id, nature, this.elimines);
    return this;
  }
  absents(...regs: string[]): this {
    for (const r of regs) this.elimines.add(r);
    this.fights = eliminerDansLeScenario(this.fights, this.elimines);
    return this;
  }
  cascade(): this {
    this.fights = eliminerDansLeScenario(this.fights, this.elimines);
    return this;
  }
  arbitre(id: string, mode: "tirage" | "decision" | null, gagnant: "A" | "B" | null): this {
    const f = this.combat(id);
    const g = gagnant === null ? null : gagnant === "A" ? f.slotA : f.slotB;
    this.fights = appliquerLePlan(
      this.fights,
      planArbitrage(this.fights, id, { mode, gagnant: g }, this.elimines),
    );
    return this;
  }
  ajouterCombat(division: 1 | 2, index: number, a: string | null, b: string | null): this {
    this.fights = [
      ...this.fights,
      {
        id: K(division, index),
        division,
        indexInDivision: index,
        type: "BraketFight",
        slotA: a,
        slotB: b,
        isBye: false,
        state: "scheduled",
        winner: null,
        winMethod: null,
        needsArbitration: false,
        version: 0,
      },
    ];
    return this;
  }
  perdant(id: string): string {
    const f = this.combat(id);
    const p = f.winner === f.slotA ? f.slotB : f.slotA;
    if (!p) throw new Error(`pas de perdant en ${id}`);
    return p;
  }
  eligibilite(): EligibiliteInscription[] {
    const regs = new Set<string>();
    for (const f of this.fights) {
      if (f.slotA) regs.add(f.slotA);
      if (f.slotB) regs.add(f.slotB);
    }
    return [...regs].map((r) => {
      let disciplinaire: StatutDisciplinaire = "aucune";
      if (estDisqualifieDisciplinaire(this.fights, r) || this.disciplinairesApres.has(r)) {
        disciplinaire = "validee";
      }
      if (this.enAttente.has(r)) disciplinaire = "en_attente";
      return {
        registrationId: r,
        elimination: this.elimines.has(r) ? { statut: "no_show", motif: "no_show" } : null,
        aCombattu: aCombattuDansLesCombats(this.fights, r),
        checkInValide: !this.elimines.has(r),
        disciplinaire,
      };
    });
  }
  entree(): EntreeClassement {
    return { fights: this.fights, thirdPlaceMode: this.mode, eligibilite: this.eligibilite() };
  }
  classement() {
    return classementOfficiel(this.entree());
  }
}

export function compact(places: readonly PlaceOfficielle[]): string[] {
  return places.map((p) =>
    p.registrationId !== null
      ? `${p.rang}:${p.registrationId}`
      : `${p.rang}:vacante(${p.motifVacance})`,
  );
}

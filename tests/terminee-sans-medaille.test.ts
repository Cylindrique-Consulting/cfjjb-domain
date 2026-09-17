import { describe, expect, it } from "vitest";
import {
  arbitragesEnAttente,
  proposerCombatsSupplementaires,
  scenariosFinSansVainqueur,
} from "../src/arbitrage";
import type { PropagationFight } from "../src/bracket-propagation";
import {
  classementOfficiel,
  entreeDuScenario,
  estClassable,
  estTermineeSansMedaille,
  scenariosTermineeSansMedaille,
  type EntreeClassement,
} from "../src/podium-officiel";
import { Tableau } from "./aides-classement";

type Statut = "present" | "absent_avant" | "absent_apres" | "dq_tech" | "dq_disc";
const STATUTS: Statut[] = ["present", "absent_avant", "absent_apres", "dq_tech", "dq_disc"];

function* combinaisons(n: number): Generator<Statut[]> {
  const total = STATUTS.length ** n;
  for (let k = 0; k < total; k++) {
    const out: Statut[] = [];
    let x = k;
    for (let i = 0; i < n; i++) {
      out.push(STATUTS[x % STATUTS.length]!);
      x = Math.floor(x / STATUTS.length);
    }
    yield out;
  }
}

const ordre = (f: PropagationFight) =>
  f.type === "BraketFightPool3" ? -1 : f.type === "BraketFightRepechage3" ? 1.5 : f.division;

function jouer(n: number, mode: "pool3" | "shared_bronze", statuts: Statut[]): EntreeClassement[] {
  const statutDe = (r: string) => statuts[Number(r.slice(1)) - 1]!;
  if (n === 1) {
    const s = statuts[0]!;
    const elimine = s === "absent_avant" || s === "absent_apres";
    return [
      {
        fights: [],
        thirdPlaceMode: mode,
        seulInscrit: "r1",
        eligibilite: [
          {
            registrationId: "r1",
            elimination: elimine ? { statut: "no_show", motif: "no_show" } : null,
            aCombattu: false,
            checkInValide: !elimine,
            disciplinaire: "aucune",
          },
        ],
      },
    ];
  }

  const t = new Tableau(n, mode);
  const etats: EntreeClassement[] = [t.entree()];
  const avant = t.fights
    .flatMap((f) => [f.slotA, f.slotB])
    .filter((r): r is string => r !== null && statutDe(r) === "absent_avant");
  if (avant.length > 0) t.absents(...new Set(avant));
  etats.push(t.entree());

  const dqUtilisee = new Set<string>();
  let classementSaisi: EntreeClassement["classementSaisi"] = null;
  for (let garde = 0; garde < 40; garde++) {
    const attente = arbitragesEnAttente(t.fights, (r) =>
      estClassable(t.eligibilite().find((e) => e.registrationId === r)!),
    );
    if (attente.length > 0) {
      const a = attente[0]!;
      if (a.resolution === "tirage" || a.resolution === "decision") {
        t.arbitre(a.fightId, a.resolution, "A");
      } else if (a.resolution === "combats") {
        const proposition = proposerCombatsSupplementaires(t.fights, t.combat(a.fightId));
        const concernes = t.fights.filter(
          (f) =>
            f.winner === null &&
            f.state === "finished" &&
            (f.winMethod === "double_dq" || f.winMethod === "double_blessure") &&
            f.division <= 2 &&
            !f.arbitrage,
        );
        for (const f of concernes) t.arbitre(f.id, null, null);
        for (const c of proposition?.combats ?? []) {
          t.ajouterCombat(c.division, c.indexInDivision, c.slotA, c.slotB);
        }
      } else {
        classementSaisi = [];
        etats.push({ ...t.entree(), classementSaisi });
        break;
      }
      etats.push(t.entree());
      continue;
    }

    const jouable = t.fights
      .filter((f) => !f.isBye && f.state === "scheduled" && f.slotA !== null && f.slotB !== null)
      .sort((x, y) => ordre(y) - ordre(x) || x.indexInDivision - y.indexInDivision)[0];
    if (!jouable) {
      const avantCascade = JSON.stringify(t.fights);
      t.cascade();
      if (JSON.stringify(t.fights) === avantCascade) break;
      etats.push(t.entree());
      continue;
    }
    const [a, b] = [jouable.slotA!, jouable.slotB!];
    const dq = (r: string) =>
      !dqUtilisee.has(r) && (statutDe(r) === "dq_tech" || statutDe(r) === "dq_disc");
    const motif = (r: string) => (statutDe(r) === "dq_disc" ? "disciplinaire" : "technique");
    if (dq(a) && dq(b)) {
      t.doubleDq(jouable.id, motif(a), motif(b));
      dqUtilisee.add(a).add(b);
    } else if (dq(a)) {
      t.gagneParDq(jouable.id, "B", motif(a));
      dqUtilisee.add(a);
    } else if (dq(b)) {
      t.gagneParDq(jouable.id, "A", motif(b));
      dqUtilisee.add(b);
    } else {
      t.gagne(jouable.id, "A");
    }
    etats.push(t.entree());

    const apres = [a, b].filter((r) => statutDe(r) === "absent_apres" && !t.elimines.has(r));
    if (apres.length > 0) {
      t.absents(...apres);
      etats.push(t.entree());
    }
  }
  return etats;
}

describe("le prédicat « terminée sans médaillé » est le miroir du moteur", () => {
  for (const n of [1, 2, 3, 4, 5]) {
    for (const mode of ["shared_bronze", "pool3"] as const) {
      it(`n=${n}, ${mode} : toutes les combinaisons, à chaque état`, () => {
        let verifies = 0;
        let sansMedaille = 0;
        for (const statuts of combinaisons(n)) {
          for (const entree of jouer(n, mode, statuts)) {
            const moteur = classementOfficiel(entree);
            const predicat = estTermineeSansMedaille(entree);
            if (predicat !== (moteur.etat === "terminee_sans_medaille")) {
              throw new Error(
                `divergence n=${n} ${mode} [${statuts.join(",")}] : prédicat ${predicat}, moteur ${moteur.etat} ${JSON.stringify(moteur.places)}\n${JSON.stringify(entree.fights.map((f) => [f.id, f.slotA, f.slotB, f.state, f.winMethod, f.winner, f.dqReasonA, f.dqReasonB, f.dqReason, f.arbitrage]))}`,
              );
            }
            const parRang = [1, 2, 3].map((r) => moteur.places.filter((p) => p.rang === r).length);
            expect(parRang[0]).toBeLessThanOrEqual(1);
            expect(parRang[1]).toBeLessThanOrEqual(2);
            expect(parRang[2]).toBeLessThanOrEqual(4);
            const nommes = moteur.places.flatMap((p) =>
              p.registrationId ? [p.registrationId] : [],
            );
            expect(new Set(nommes).size).toBe(nommes.length);
            for (const r of nommes) {
              const e = entree.eligibilite?.find((x) => x.registrationId === r);
              if (e) expect(estClassable(e), `${r} placé alors qu'inéligible`).toBe(true);
            }
            if (predicat) sansMedaille++;
            verifies++;
          }
        }
        expect(verifies).toBeGreaterThan(0);
        if (n >= 2) expect(sansMedaille).toBeGreaterThan(0);
      });
    }
  }
});

describe("les scénarios exportés pour la sonde SQL", () => {
  it("chaque scénario « sans médaillé » répond ce qu'il annonce, au prédicat et au moteur", () => {
    const scenarios = scenariosTermineeSansMedaille();
    expect(scenarios.length).toBeGreaterThanOrEqual(12);
    for (const s of scenarios) {
      const entree = entreeDuScenario(s);
      expect(estTermineeSansMedaille(entree), s.id).toBe(s.attendu);
      expect(classementOfficiel(entree).etat === "terminee_sans_medaille", s.id).toBe(s.attendu);
    }
    expect(scenarios.some((s) => s.attendu)).toBe(true);
    expect(scenarios.some((s) => !s.attendu)).toBe(true);
  });

  it("les scénarios de règles couvrent chaque ligne de la table", () => {
    const ids = new Set(scenariosFinSansVainqueur().map((s) => s.regle));
    expect(ids.has("designe_indisponible")).toBe(true);
    expect(ids.size).toBeGreaterThan(30);
  });
});

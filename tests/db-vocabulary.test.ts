import { describe, expect, it } from "vitest";
import {
  CODES_AGE_NON_TRADUISIBLES,
  estCoherentEnfant,
  limiteRefusMessage,
  resolveAgeGroup,
  resolveWeightClass,
  resolveWeightLimit,
} from "../src/db-vocabulary";
import {
  AGE_GROUPS,
  getFightDurationSeconds,
  getMaxWeightKg,
  WEIGHT_CLASSES,
} from "../src/referential";

/** Les 18 codes d'âge non nuls réellement présents en production (mesuré 17/08/2026). */
const CODES_PROD = [
  "adult",
  "master_1_2",
  "master",
  "master_3_4",
  "juvenil",
  "u11",
  "u15",
  "u13",
  "u9",
  "master_5_plus",
  "infantil",
  "mirim",
  "u7",
  "master2",
  "infantiljuvenil",
  "child",
  "premirim",
  "master1",
] as const;

describe("la conversion est TOTALE sur les codes de production", () => {
  it("chaque code rend soit un AgeGroup valide, soit null — jamais autre chose", () => {
    for (const code of CODES_PROD) {
      const r = resolveAgeGroup(code);
      if (r === null) continue;
      expect(
        (AGE_GROUPS as readonly string[]).includes(r),
        `« ${code} » rend « ${r} », qui n'appartient pas à AGE_GROUPS`,
      ).toBe(true);
    }
  });

  it("les douze codes vivants et non ambigus sont traduits", () => {
    expect(resolveAgeGroup("adult")).toBe("Adulte");
    expect(resolveAgeGroup("juvenil")).toBe("Juvénile");
    expect(resolveAgeGroup("u7")).toBe("U7");
    expect(resolveAgeGroup("u15")).toBe("U15");
    expect(resolveAgeGroup("master_1_2")).toBe("Master 1");
    expect(resolveAgeGroup("master_3_4")).toBe("Master 3");
    expect(resolveAgeGroup("master_5_plus")).toBe("Master 5+");
    expect(resolveAgeGroup("master1")).toBe("Master 1");
    expect(resolveAgeGroup("master2")).toBe("Master 2");
  });

  it("les codes ambigus et éteints rendent null, SCIEMMENT", () => {
    // Aucun ne désigne une tranche unique. Leur inventer une correspondance
    // ajouterait du risque sur des enfants, pour une donnée que le jour J ne
    // rencontrera jamais (aucun depuis 2022, sauf `master` depuis 2023).
    for (const code of CODES_AGE_NON_TRADUISIBLES) {
      expect(resolveAgeGroup(code), code).toBeNull();
    }
  });

  it("un libellé du vocabulaire NEUF est rendu tel quel", () => {
    // La colonne portera les deux langues simultanément : codes sur les lignes
    // reprises, libellés sur les nouvelles. Traduire aveuglément corromprait les
    // secondes.
    for (const g of AGE_GROUPS) expect(resolveAgeGroup(g), g).toBe(g);
    for (const w of WEIGHT_CLASSES) expect(resolveWeightClass(w), w).toBe(w);
  });
});

describe("l'indice de poids et ses aberrations", () => {
  it("traduit l'indice 0-based", () => {
    expect(resolveWeightClass("0")).toBe("Galo");
    expect(resolveWeightClass("3")).toBe("Leve");
    expect(resolveWeightClass("8")).toBe("Pesadissimo");
  });

  it("refuse les valeurs aberrantes mesurées en production", () => {
    // "9" est hors bornes (le référentiel a 9 entrées, 0 à 8) ; les autres sont
    // des kilos ou des restes d'un import plus ancien.
    for (const v of ["9", "36", "500", "-30", "-62", "inconnu", ""]) {
      expect(resolveWeightClass(v), v).toBeNull();
    }
  });
});

describe("LE DÉFAUT D'ORIGINE : un enfant pesé au barème adulte", () => {
  it("aucun code enfant n'est classé adulte, et réciproquement", () => {
    // `isChildAgeGroup` est un `startsWith("U")` SENSIBLE À LA CASSE : le code
    // `u11` rendait FAUX, partait dans les tables adultes, et la limite rendue
    // était celle d'un homme adulte — mesuré 70,0 kg au lieu de 36,2.
    for (const code of CODES_PROD) {
      const r = resolveAgeGroup(code);
      if (r === null) continue;
      expect(estCoherentEnfant(code, r), `${code} → ${r}`).toBe(true);
    }
  });

  it("la limite d'un U11 n'est PAS celle d'un adulte", () => {
    const enfant = resolveWeightLimit({
      discipline: "gi",
      storedAgeGroup: "u11",
      gender: "male",
      storedWeightClass: "2",
    });
    const adulte = resolveWeightLimit({
      discipline: "gi",
      storedAgeGroup: "adult",
      gender: "male",
      storedWeightClass: "2",
    });
    expect(enfant.ok && adulte.ok).toBe(true);
    if (enfant.ok && adulte.ok) {
      expect(enfant.maxKg).not.toBe(adulte.maxKg);
      // La borne exacte importe peu ici ; ce qui importe est qu'un enfant ne se
      // voie pas opposer un plafond d'adulte, qui le laisserait passer toujours.
      expect(enfant.maxKg!).toBeLessThan(adulte.maxKg!);
    }
  });

  it("le passage brut par getMaxWeightKg LÈVE, et c'est ce qu'on remplace", () => {
    // Preuve que la conversion n'est pas décorative : sans elle, l'indice brut
    // fait lever la fonction du référentiel.
    expect(() => getMaxWeightKg("gi", "Adulte", "male", "3" as never)).toThrow();
    expect(
      resolveWeightLimit({
        discipline: "gi",
        storedAgeGroup: "adult",
        gender: "male",
        storedWeightClass: "3",
      }).ok,
    ).toBe(true);
  });
});

describe("les refus sont motivés et affichables", () => {
  it("chaque motif a un message qui ne montre aucun code", () => {
    for (const r of [
      "age_inconnu",
      "classe_inconnue",
      "genre_manquant",
      "combinaison_absente",
    ] as const) {
      const m = limiteRefusMessage(r);
      expect(m.length).toBeGreaterThan(20);
      expect(m).not.toContain("_");
    }
  });

  it("un genre manquant refuse au lieu de supposer", () => {
    // `competition_registrations.gender` est NULL sur les 131 215 lignes : deviner
    // « homme » doublerait presque la limite pour une femme.
    const r = resolveWeightLimit({
      discipline: "gi",
      storedAgeGroup: "adult",
      gender: null,
      storedWeightClass: "3",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.raison).toBe("genre_manquant");
  });

  it("« sans limite » est un SUCCÈS, pas un refus", () => {
    // Les catégories les plus lourdes n'ont pas de plafond. Confondre les deux
    // ferait afficher « je ne sais pas » là où la réponse est « aucune limite ».
    const r = resolveWeightLimit({
      discipline: "gi",
      storedAgeGroup: "adult",
      gender: "male",
      storedWeightClass: "8",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.maxKg).toBeNull();
  });

  it("un code inconnu refuse avec le bon motif", () => {
    for (const [code, raison] of [
      ["mirim", "age_inconnu"],
      ["adult", "classe_inconnue"],
    ] as const) {
      const r = resolveWeightLimit({
        discipline: "gi",
        storedAgeGroup: code,
        gender: "male",
        storedWeightClass: raison === "classe_inconnue" ? "500" : "3",
      });
      expect(r.ok, `${code}/${raison}`).toBe(false);
      if (!r.ok) expect(r.raison).toBe(raison);
    }
  });
});

describe("POURQUOI LA CONVERSION DOIT ÊTRE FINE : les durées de combat", () => {
  it("un master ne combat pas la durée d'un adulte", () => {
    // Le poids ne le verrait PAS : les masters retombent sur les barèmes adultes,
    // donc une conversion grossière « tous les masters → Adulte » serait
    // indétectable côté balance. Les DURÉES la démentent, et un combat deux fois
    // trop long n'est pas un détail d'affichage.
    const adulte = getFightDurationSeconds("black", "Adulte", "gi");
    const m1 = getFightDurationSeconds("black", resolveAgeGroup("master_1_2")!, "gi");
    const m3 = getFightDurationSeconds("black", resolveAgeGroup("master_3_4")!, "gi");
    expect(adulte).not.toBeNull();
    expect(m1).not.toBeNull();
    expect(m1).not.toBe(adulte);
    expect(m3).not.toBe(adulte);
  });

  it("chaque code vivant désigne une tranche RÉELLE des tables de durée", () => {
    // `getFightDurationSeconds` ne lève pas : il rend `null`, et un `?? 300` en
    // aval le transforme en une durée d'apparence normale. Un âge mal converti
    // serait donc invisible en production.
    //
    // On assère « AU MOINS UNE ceinture donne une durée », et pas une ceinture
    // précise : deux rédactions précédentes ont échoué en présumant un couple
    // ceinture × âge qui n'existe pas. Une bleue en U7 n'existe pas (les enfants
    // n'ont pas de bleue), et une BLANCHE en U7 non plus — en U7 seules la grise et
    // la jaune ont une durée. Les `null` étaient justes ; c'étaient les tests qui
    // étaient faux. Cette formulation prouve ce qui compte : la tranche convertie
    // est une clé réelle de la table.
    const CEINTURES = [
      "white",
      "grey",
      "yellow",
      "orange",
      "green",
      "blue",
      "purple",
      "brown",
      "black",
    ] as const;
    for (const code of [
      "adult",
      "juvenil",
      "u7",
      "u9",
      "u11",
      "u13",
      "u15",
      "master_1_2",
      "master_3_4",
      "master_5_plus",
    ] as const) {
      const g = resolveAgeGroup(code);
      expect(g, code).not.toBeNull();
      const durees = CEINTURES.map((b) => getFightDurationSeconds(b, g!, "gi")).filter(
        (d): d is number => d !== null,
      );
      expect(
        durees.length,
        `${code} → ${g} : aucune ceinture ne donne de durée, la tranche n'existe pas dans les tables`,
      ).toBeGreaterThan(0);
    }
  });
});

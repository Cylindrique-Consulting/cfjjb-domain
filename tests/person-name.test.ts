import { describe, expect, it } from "vitest";
import {
  EXEMPLES_DE_NOMS,
  formatFirstName,
  formatLastName,
  formatPersonName,
  formatStoredFullName,
} from "../src/person-name";

describe("formatLastName", () => {
  it("écrit le nom de famille tout en capitales", () => {
    expect(formatLastName("Dupont")).toBe("DUPONT");
    expect(formatLastName("dupont")).toBe("DUPONT");
    expect(formatLastName("DUPONT")).toBe("DUPONT");
  });

  it("garde les accents, les particules et les apostrophes", () => {
    expect(formatLastName("Bénichou")).toBe("BÉNICHOU");
    expect(formatLastName("lê")).toBe("LÊ");
    expect(formatLastName("de la Fontaine")).toBe("DE LA FONTAINE");
    expect(formatLastName("N'Diaye")).toBe("N'DIAYE");
  });

  it("n'invente rien sur le vide", () => {
    expect(formatLastName("")).toBe("");
    expect(formatLastName(null)).toBe("");
    expect(formatLastName(undefined)).toBe("");
  });
});

describe("formatFirstName", () => {
  it("met une capitale initiale et le reste en minuscules", () => {
    expect(formatFirstName("JEAN")).toBe("Jean");
    expect(formatFirstName("jean")).toBe("Jean");
    expect(formatFirstName("jEAN")).toBe("Jean");
    expect(formatFirstName("Jean")).toBe("Jean");
  });

  it("garde les accents", () => {
    expect(formatFirstName("ÉMILE")).toBe("Émile");
    expect(formatFirstName("émile")).toBe("Émile");
    expect(formatFirstName("CHLOÉ")).toBe("Chloé");
  });

  it("capitalise chaque membre d'un prénom composé", () => {
    expect(formatFirstName("JEAN-PIERRE")).toBe("Jean-Pierre");
    expect(formatFirstName("marie claire")).toBe("Marie Claire");
    expect(formatFirstName("d'artagnan")).toBe("D'Artagnan");
  });

  it("reconnaît l'apostrophe typographique comme l'apostrophe droite", () => {
    expect(formatFirstName("n’golo")).toBe("N’Golo");
    expect(formatFirstName("N’GOLO")).toBe("N’Golo");
  });

  it("ne touche pas aux blancs : c'est formatPersonName qui retire ceux des bords", () => {
    expect(formatFirstName("jean  pierre")).toBe("Jean  Pierre");
  });

  it("est idempotent", () => {
    expect(formatFirstName(formatFirstName("JEAN-LUC"))).toBe("Jean-Luc");
  });

  it("n'invente rien sur le vide", () => {
    expect(formatFirstName("")).toBe("");
    expect(formatFirstName(null)).toBe("");
    expect(formatFirstName(undefined)).toBe("");
  });
});

describe("formatPersonName", () => {
  it("compose « Prénom NOM » par défaut", () => {
    expect(formatPersonName("JEAN", "Dupont")).toBe("Jean DUPONT");
    expect(formatPersonName("jean", "dupont")).toBe("Jean DUPONT");
  });

  it("compose « NOM Prénom » sur demande", () => {
    expect(formatPersonName("Emilie", "baretge", "last-first")).toBe("BARETGE Emilie");
  });

  it("omet une partie vide et retire les blancs des bords", () => {
    expect(formatPersonName("Jean", "")).toBe("Jean");
    expect(formatPersonName("", "Dupont")).toBe("DUPONT");
    expect(formatPersonName(" jean ", " dupont ")).toBe("Jean DUPONT");
    expect(formatPersonName(null, undefined)).toBe("");
  });
});

describe("formatStoredFullName", () => {
  it("lit le premier mot comme le prénom, le reste comme le nom", () => {
    expect(formatStoredFullName("EMILIE BARETGE")).toBe("Emilie BARETGE");
    expect(formatStoredFullName("jean dupont")).toBe("Jean DUPONT");
    expect(formatStoredFullName("marie de la fontaine")).toBe("Marie DE LA FONTAINE");
  });

  it("un seul mot est un prénom", () => {
    expect(formatStoredFullName("JEAN")).toBe("Jean");
  });

  it("n'invente rien sur le vide", () => {
    expect(formatStoredFullName("   ")).toBe("");
    expect(formatStoredFullName(null)).toBe("");
  });
});

describe("EXEMPLES_DE_NOMS, la liste de parité avec le SQL", () => {
  it("chaque exemple s'affiche comme il le déclare", () => {
    for (const e of EXEMPLES_DE_NOMS) {
      expect(formatFirstName(e.prenom), e.prenom).toBe(e.prenomAffiche);
      expect(formatLastName(e.nom), e.nom).toBe(e.nomAffiche);
    }
  });

  it("couvre les cas que le SQL doit reproduire", () => {
    const prenoms = EXEMPLES_DE_NOMS.map((e) => e.prenom).join("|");
    const noms = EXEMPLES_DE_NOMS.map((e) => e.nom).join("|");
    expect(prenoms).toMatch(/[a-z]-[a-z]|[A-Z]-[A-Z]/i);
    expect(prenoms).toContain(" ");
    expect(prenoms).toContain("'");
    expect(prenoms).toContain("’");
    expect(prenoms).toMatch(/[ÉÈÊ]/);
    expect(noms).toMatch(/[éèêç]/);
    expect(noms).toContain(" ");
  });

  it("chaque affichage attendu est un point fixe : le réappliquer ne change rien", () => {
    for (const e of EXEMPLES_DE_NOMS) {
      expect(formatFirstName(e.prenomAffiche)).toBe(e.prenomAffiche);
      expect(formatLastName(e.nomAffiche)).toBe(e.nomAffiche);
    }
  });
});

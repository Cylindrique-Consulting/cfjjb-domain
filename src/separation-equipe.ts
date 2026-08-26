import type { BracketEntry, GeneratedFight } from "./bracket-generator";

/**
 * LA SÉPARATION D'ÉQUIPE, VÉRIFIÉE PLUTÔT QUE SOUHAITÉE (CYL-517).
 *
 * ┌─ POURQUOI CE MODULE EXISTE ───────────────────────────────────────────────┐
 * │ Le placement d'équipe du noyau est une RÉPARATION PONDÉRÉE : les           │
 * │ contraintes `meme-equipe-premier-tour` et `meme-equipe-meme-moitie`        │
 * │ portent un `tier` et un `weight`, elles MINIMISENT les rencontres sans     │
 * │ jamais refuser un tableau. C'est le bon comportement pour un placement —   │
 * │ un tirage doit toujours sortir — mais cela ne dit PAS si la règle a été    │
 * │ tenue.                                                                     │
 * │                                                                            │
 * │ Or « deux combattants d'une même équipe ne se rencontrent pas au premier   │
 * │ tour » est une règle de compétition, pas une préférence esthétique. Elle   │
 * │ doit être CONSTATABLE sur le tableau produit, sinon personne ne saura      │
 * │ jamais qu'elle a été enfreinte — et surtout pas le club concerné, qui le   │
 * │ découvrira au bord du tapis.                                              │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * CE MODULE NE TIRE RIEN ET NE RÉPARE RIEN. Il regarde un tableau déjà tiré et
 * dit ce qui s'y trouve. Séparer le constat du placement est ce qui permet de
 * le vérifier après N'IMPORTE QUEL chemin — première génération, régénération
 * d'une catégorie, ajout tardif — sans dépendre de la façon dont il a été
 * obtenu.
 */

/** Deux combattants de la même entité, appariés dans un combat réellement tiré. */
export type RencontreInterne = {
  readonly division: number;
  readonly indexInDivision: number;
  /** L'entité partagée : identifiant de sous-équipe, ou de club à défaut. */
  readonly entiteId: string;
  readonly registrationA: string;
  readonly registrationB: string;
};

/** Une entité qu'aucun placement ne peut séparer, faute de place. */
export type EntiteSurchargee = {
  readonly entiteId: string;
  readonly effectif: number;
};

export type VerdictSeparation = {
  /** Vide quand la règle est tenue. */
  readonly rencontres: readonly RencontreInterne[];
  /**
   * Les entités dont l'effectif REND la règle intenable, quel que soit le
   * placement. Les nommer sépare « le tirage a mal fait » de « la règle ne
   * pouvait pas être tenue » -- deux constats qui appellent deux gestes
   * différents, et qu'un simple compte de violations confondrait.
   */
  readonly surchargees: readonly EntiteSurchargee[];
};

/**
 * L'ENTITÉ DE RATTACHEMENT : la sous-équipe si elle existe, le club sinon.
 *
 * Un combattant sans club ne se rattache à rien — il ne peut donc pas
 * « rencontrer son équipe », et on ne l'invente pas une entité pour le plaisir
 * de le compter.
 */
function entiteDe(e: BracketEntry): string | null {
  return e.teamId ?? e.clubId ?? null;
}

/**
 * Combien de combattants d'une même entité un tableau peut-il séparer.
 *
 * DEUX, et c'est de l'arithmétique, pas un réglage : au premier tour, chaque
 * combattant occupe un côté d'un combat. Trois combattants d'une même entité
 * dans une catégorie en mettent forcément deux face à face quelque part dès
 * que le tableau se resserre -- mais au PREMIER TOUR, la règle reste tenable
 * tant qu'ils sont assez peu pour occuper des combats distincts. C'est cette
 * borne-là que la fédération a fixée à deux par sous-équipe.
 */
export const MAX_PAR_ENTITE = 2;

/**
 * Le tableau tenu respecte-t-il la séparation d'équipe ?
 *
 * On ne regarde que les combats dont les DEUX côtés sont connus : aux tours
 * suivants, les emplacements sont vides au moment du tirage, et y chercher une
 * rencontre reviendrait à prédire des résultats.
 */
export function verifierSeparationDEquipe(
  fights: readonly GeneratedFight[],
  entries: readonly BracketEntry[],
): VerdictSeparation {
  const parInscription = new Map<string, string>();
  const effectifs = new Map<string, number>();

  for (const e of entries) {
    const entite = entiteDe(e);
    if (entite === null) continue;
    parInscription.set(e.registrationId, entite);
    effectifs.set(entite, (effectifs.get(entite) ?? 0) + 1);
  }

  const rencontres: RencontreInterne[] = [];
  for (const f of fights) {
    if (f.isBye || f.slotA === null || f.slotB === null) continue;
    const a = parInscription.get(f.slotA);
    const b = parInscription.get(f.slotB);
    if (a === undefined || a !== b) continue;
    rencontres.push({
      division: f.division,
      indexInDivision: f.indexInDivision,
      entiteId: a,
      registrationA: f.slotA,
      registrationB: f.slotB,
    });
  }

  const surchargees: EntiteSurchargee[] = [...effectifs.entries()]
    .filter(([, n]) => n > MAX_PAR_ENTITE)
    .map(([entiteId, effectif]) => ({ entiteId, effectif }))
    // Ordre STABLE : deux appels sur les mêmes données doivent rendre la même
    // liste, sinon un rapport de génération changerait d'une exécution à
    // l'autre sans qu'aucune donnée n'ait bougé.
    .sort((x, y) => y.effectif - x.effectif || x.entiteId.localeCompare(y.entiteId));

  return { rencontres, surchargees };
}

/** Raccourci de lecture : la règle est-elle tenue sur ce tableau ? */
export function separationTenue(verdict: VerdictSeparation): boolean {
  return verdict.rencontres.length === 0;
}

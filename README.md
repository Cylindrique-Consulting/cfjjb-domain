# @cfjjb/domain

Noyau métier de la Confédération Française de Jiu-Jitsu Brésilien : référentiel des
catégories, générateur de tableaux, planning des tatamis, besoins en médailles.

**TypeScript pur.** Aucune IO, aucun React, aucun client de base de données, aucune
dépendance de production. Le package se consomme en source : les applications qui
l'utilisent le transpilent elles-mêmes.

## Pourquoi ce package existe

Le référentiel des poids et des durées de combat était **recopié à l'identique dans
deux dépôts**, avec en tête un commentaire demandant de « garder les deux côtés
synchrones » à la main. Deux listes de grades finissent toujours par diverger, et la
divergence est muette : un planning trie les catégories dans un ordre, l'éligibilité
dans un autre, et personne ne voit rien.

Le jour de compétition étant un outil séparé, la propagation d'un tableau doit tourner
**à l'identique** dans le navigateur (hors ligne) et sur le serveur. C'est ici — et
seulement ici — que cette identité peut être _prouvée_ : les deux exécutions sont deux
simulations d'un même test pur.

## Consommateurs

| Dépôt                   | Rôle                                                                         |
| ----------------------- | ---------------------------------------------------------------------------- |
| `cfjjb-platform`        | plateforme fédération / club / licencié, migrations, source unique du schéma |
| `cfjjb-competition-day` | PWA des postes du jour J (pointage, pesée, medido, marque, podium)           |

Épinglé par tag, jamais par branche :

```json
"@cfjjb/domain": "github:Cylindrique-Consulting/cfjjb-domain#v0.1.0"
```

Une montée de version est donc toujours une PR explicite chez le consommateur, jamais
un effet de bord d'un `pnpm install`.

## Ce que ce package ne contient pas, et pourquoi

**Les types Supabase générés.** Ce dépôt est public : y mettre `database.generated.ts`
publierait la carte complète du schéma d'une base qui porte les données de 90 000
personnes, dont des mineurs. La RLS reste la frontière de sécurité, mais on n'offre pas
la carte.

À la place, `src/enums.ts` déclare **à la main** les seules unions dont les algorithmes
ont besoin (`BeltDb`, `GenderDb`, `DisciplineDb`, `ThirdPlaceMode`).

**Le garde-fou de dérive vit dans `cfjjb-platform`**, et c'est le seul endroit possible :
c'est le seul dépôt où coexistent ces contrats et les types générés. Un test y vérifie
l'identité structurelle **dans les deux sens** — une valeur ajoutée à l'enum Postgres
comme une valeur retirée d'ici casse sa CI.

> Ne jamais modifier un type de `src/enums.ts` sans faire tourner la suite de
> `cfjjb-platform`. C'est la seule règle de ce dépôt qui ne peut pas être vérifiée
> depuis ce dépôt.

## Le format d'une catégorie : élimination directe ou poule

`competitions.bracket_mode` accepte `'pools'` depuis juin 2026, et **aucun code ne
lisait cette colonne** : une compétition enregistrée « Poules » produisait une
élimination directe, en silence. Le moteur manquant vit maintenant ici.

| Module                      | Rôle                                                                   |
| --------------------------- | ---------------------------------------------------------------------- |
| `src/competition-format.ts` | le vocabulaire de la colonne, et la table de formats par tranche d'âge |
| `src/pool-generator.ts`     | le round-robin (méthode du cercle), plafonné à 6                       |
| `src/pool-ranking.ts`       | le classement de poule et son tuple de départage                       |
| `src/category-draw.ts`      | l'aiguillage, et le compte-rendu de repli                              |

> **Décision produit du 21/08/2026.** Le moteur est livré et testé, mais **aucun
> format par défaut ne l'active** : `DEFAULT_FORMAT_BY_AGE_GROUP` rend `single_elim`
> pour les douze tranches d'âge. La fédération activera catégorie par catégorie.
> `tests/competition-format.test.ts` gèle ce défaut : une bascule involontaire casse
> la CI au lieu de changer le format de vraies compétitions.

Trois points valent d'être connus avant d'y toucher :

- **Le plafond n'est pas cosmétique.** Une poule coûte C(n,2) combats : 15 à six,
  **120 à seize**, contre 15 pour une élimination à seize. Au-delà de six, le format
  se replie en élimination directe, et le repli est **rapporté** (`DrawFallback`) —
  un repli muet ferait commander le mauvais nombre de médailles.
- **Deux tailles n'admettent aucun ordre sans enchaînement**, n = 3 et n = 4 : ce
  n'est pas une faiblesse du générateur, c'est démontré par énumération exhaustive
  dans la suite. Le tampon de repos du planning est ce qui compense, et la poule le
  dit (`PoolWarning`) plutôt que de le masquer.
- **Les combats de poule sont des lignes de combat ordinaires** (`division = 0`,
  `indexInDivision` = ordre de passage). C'est ce qui évite un cas particulier dans
  la TV, l'écran opérateur, le planning et le journal.

## La capacité d'une compétition, et son dimensionnement

`competitions` n'a **aucune notion de capacité** : elle porte `tatami_count` (un
entier 1..99, déclaré), des horaires, et rien qui dise combien de gens tiennent dans
la journée. Deux modules purs comblent ce trou.

| Module            | Rôle                                                                        |
| ----------------- | --------------------------------------------------------------------------- |
| `src/capacity.ts` | capacité CALCULÉE (jamais saisie) et taux de remplissage                    |
| `src/sizing.ts`   | projection virtuelle des inscriptions, médailles et recommandation de tapis |

**La capacité se dérive, elle ne se saisit pas.** Un plafond saisi est un chiffre que
personne ne recalcule quand la compétition change ; il vieillit en silence et reste
affiché.

```
combats     = tatamis × heures exploitables ÷ (durée moyenne + espacement)
combattants = combats ÷ ratio combats-par-combattant
```

Trois points valent d'être connus :

- **Le format pèse plus que l'effectif.** Une poule de quatre coûte SIX combats pour
  quatre combattants (1,5 chacun), une élimination directe en coûte TROIS (0,75).
  Basculer une tranche d'âge en poule divise la capacité par deux, à tatamis
  constants. `explainCapacity` rend les termes du calcul un par un, pour que cette
  chute soit lisible à l'écran plutôt que prise pour un bug.
- **`computeFillRate` rend `null` quand la capacité est nulle, jamais `0`.** Un zéro
  se lit comme un fait mesuré (« la compétition est vide ») alors que l'information
  réelle est « on ne sait pas ». À l'écran, `null` s'affiche « - ».
- **Le numérateur est EXACTEMENT `isActiveBracketStatus`** (`registered`, `validated`,
  `paid`) : le taux répond à « à quel point les tapis sont-ils remplis », et les tapis
  sont remplis par les combattants que le générateur placera. Or
  `competition_registration_counts.total` compte « tout sauf retiré », donc **inclut
  les pré-inscrits et les absents** — le brancher sur le numérateur double-compterait
  le pipeline commercial dans une mesure d'occupation physique. Les pré-inscrits
  s'affichent séparément, et `tests/capacity.test.ts` verrouille la non-dérive des
  deux ensembles : élargir l'un des deux échoue sur le **nom** du statut absorbé.

**Le panneau de dimensionnement doit marcher AVANT la génération.** `computeMedalNeed`
est alimenté par des catégories, c'est-à-dire par des lignes de `competition_categories`
qui n'existent qu'après le tirage. `projectCategories` rejoue donc les étapes 1 à 3 du
générateur — sélection, regroupement par tuple, tirage — **sans une seule écriture**.

Et `recommendTatamiCount` **exécute réellement** `planCategories` puis
`computeTatamiSchedule` pour chaque nombre de tapis candidat. Aucune estimation
parallèle n'est écrite : une formule fermée (« charge totale divisée par la durée de
journée ») donnerait un nombre plausible et faux — elle ignorerait le LPT, l'ordre
intra-tapis et le fait qu'une catégorie ne se coupe pas en deux — et serait libre de
diverger du planning au premier changement de l'un ou de l'autre.

## Pureté, vérifiée et non recommandée

`eslint.config.mjs` interdit `node:*`, `fs`, `path`, `crypto`, `react`, `react-dom`,
`@supabase/*`, `next*`, ainsi que `fetch` et `localStorage`. La CI casse à la première
transgression — la valeur du package tient entièrement à cette pureté, elle ne peut donc
pas reposer sur la vigilance.

## Développer

```bash
pnpm install
pnpm typecheck && pnpm lint && pnpm test
pnpm format
```

Un module ajouté ici doit être **exporté par `src/index.ts` et par la carte `exports` du
`package.json`** : sans les deux, un consommateur ne le voit pas.

## Publier une version

```bash
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test
# bump "version" dans package.json, commit
git tag v0.2.0 && git push --tags
```

Puis, chez **chaque** consommateur, une PR qui change le tag et fait passer sa suite.
Ordre impératif quand la version accompagne un changement de schéma : la migration doit
être **vérifiée en production** (objet contrôlé par son nom, pas par le nom du fichier)
_avant_ le bump — c'est le bump qui autorise le code consommateur à compiler, donc il ne
doit jamais précéder la réalité de la base.

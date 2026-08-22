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

## L'absolut et les équipes A/B/C

Deux lots dont le **schéma** vit dans `cfjjb-platform` (PR #756 et #754) et dont la
**règle** est pure, donc ici.

| Module                     | Rôle                                                               |
| -------------------------- | ------------------------------------------------------------------ |
| `src/absolut-seeding.ts`   | l'ordre des graines d'un absolut, et sa contrainte de séparation   |
| `src/squad-composition.ts` | l'auto-composition des équipes A/B/C passé le délai de composition |

**Les deux règles s'expriment dans le pipeline de `seeding-plan.ts`**, jamais à côté.
L'ordre par place source est une règle d'étape 1 (`source-place`) ; « pas de
retrouvailles au premier tour » est une contrainte d'étape 3 sur une nouvelle clé de
séparation (`source-category`), exactement de la même famille que l'anti-club. Un
second placement écrit en parallèle aurait sa propre notion de bye et sa propre façon
de compter les paires, et les deux divergeraient sans que rien ne les confronte.

Quatre points valent d'être connus avant d'y toucher :

- **Un absolut se classe, il ne se tire pas au sort.** `ABSOLUT_SEEDING_PLAN` n'active
  aucune règle qui consomme le tirage : deux graines de compétition différentes rendent
  le même absolut. C'est ce qui rend le tirage contestable sur les places plutôt que sur
  une graine.
- **La séparation coûte des places, et le prix est mesuré.** Elle est au palier 0, donc
  plus forte que l'anti-club : sur le cas à trois catégories sources, la réparation
  déplace la tête de série n° 1 et lui retire son bye pour défaire l'appariement
  interdit. La consigne classe la séparation comme une exigence, pas comme une
  préférence ; le test l'affirme au lieu de le taire.
- **Une source unique reste un rejeu.** Un absolut alimenté par une seule catégorie
  _est_ le podium de cette catégorie : ses finalistes doivent se rencontrer. La sortie le
  montre plutôt que de laisser croire à une séparation.
- **Au-delà de trois combattants d'un club dans une catégorie, les lettres tournent**
  (A, B, C, A…). Refuser de composer rendrait à un club la capacité de bloquer la
  génération, c'est-à-dire exactement ce que le délai ferme vient de lui retirer.

**L'auto-composition ne dépend pas de l'ordre de lecture.** Chaque inscription reçoit
une clé de tirage dérivée de `(graine de compétition, identifiant)` : un flux unique
consommé dans l'ordre des lignes aurait été déterministe _sur le papier_ et faux en
pratique, puisqu'une lecture PostgREST ne garantit aucun ordre. La suite rejoue la même
population dans cinquante ordres différents et exige une seule composition.

> **Mesure qui corrige une intuition.** « Répartir les combattants d'un club maximise
> leur séparation » est vrai comme intention et faux comme mécanisme jusqu'à un certain
> effectif : à trois ou moins, les lettres sont toutes différentes, donc les contraintes
> d'équipe ne voient **aucune** paire et toute la séparation vient de l'anti-club, actif
> sans la moindre lettre. À quatre, une paire apparaît mais l'anti-club la sépare encore
> seul (mesuré sur cinq graines). C'est à partir de **cinq** que la lettre récupère de la
> séparation que l'anti-club ne tient plus. La lettre reste, en deçà, ce qu'elle est
> aussi : une **étiquette** affichée sur le tableau et sur la TV.

### Qui a le droit d'inscrire, de désister, de clore

`src/capabilities.ts` porte trois verbes d'absolut. Ils ne sont **liés à aucun tapis** :
un absolut est un quadruplet ceinture × âge × genre × discipline, donc une catégorie.
`tatamiBound: false` n'y est pas un périmètre vide, c'est un périmètre sans objet, et
c'est le mécanisme que la matrice utilise déjà pour la balance et la jauge.

| Verbe            | Postes                       | Pourquoi                                                                            |
| ---------------- | ---------------------------- | ----------------------------------------------------------------------------------- |
| `absolut.enter`  | `podium`, `day_commissioner` | l'inscription se prend sur place, au micro, dans la minute qui suit la remise       |
| `absolut.cancel` | `podium`, `day_commissioner` | inverse exact de l'inscription, et réparable : on reprend en créant une ligne neuve |
| `absolut.close`  | `day_commissioner`           | sans retour, et la conséquence tombe sur des tapis que le poste podium ne voit pas  |

**La clôture ne suit pas ses deux voisines, et c'est la seule décision de ce lot.** Elle
n'est manuelle que pour les **ceintures noires** (les couleurs se ferment seules quand
toutes leurs sources ont médaillé), aucun verbe de l'union ne la défait, et elle
déclenche la génération du tableau puis son **insertion dans le programme d'un tapis**,
ce qui décale des combats déjà annoncés. La matrice traite déjà les deux moitiés de
cette question dans le même sens : `fight.reopen` retire le geste au poste qui exécute
et le laisse aux commissaires, `fight.move` n'appartient qu'au commissaire de journée
parce qu'il porte sur des tapis que le demandeur ne voit pas. Clore un absolut cumule
les deux traits.

> **Divergence assumée avec la spécification.** `docs/spec/patch-absolut` (RG-A07 et sa
> matrice d'habilitations § 3.1) donne la clôture manuelle au commissaire de podium
> autant qu'au commissaire de journée. On la lui retire ici : une interface trop stricte
> se voit au premier essai et se corrige en une ligne, une clôture prise trop tôt par un
> bénévole ne se rattrape pas. À trancher côté produit si l'usage dit l'inverse.

## Les statistiques de combat, et ce qui ne s'en dérive pas

`src/fight-stats.ts` tire du journal de scoring (`competition_fight_events`) et de
l'état de combat (`competition_fight_states`) tout ce qui s'en tire honnêtement :
bilan, adversaires, victoires par méthode, points marqués et encaissés, avantages,
pénalités, soumissions, face-à-face.

**La technique derrière un point ne s'en tire pas.** `+3` est un passage de garde, et
c'est sûr. Mais `+2` est un renversement **ou** une amenée au sol **ou** un
genou-ventre : trois gestes, une seule valeur. Une statistique intitulée « balayages »
construite sur les `+2` est donc fausse pour une part **inconnue** de ses lignes, et
personne ne peut dire laquelle — un chiffre plausible, affiché avec autorité, qu'aucune
relecture ne peut infirmer sans remonter à chaque combat. Les seuls libellés autorisés
pour les points sont les **valeurs**. La seule technique enregistrée est
`submissionType`, parce qu'elle a été **observée**.

`tests/statistiques-honnetes.test.ts` verrouille cette règle par un balayage de source,
jumeau de celui de `cfjjb-platform`. Le jumeau n'est pas un doublon : le verrou de la
plateforme ne lit que `app`, `lib` et `components`, et ce package est consommé depuis
`node_modules` — il ne lui est donc **jamais** passé sous les yeux. Il lit la source par
`import.meta.glob` et non par `node:fs`, que la règle de pureté interdit ici, tests
compris.

Quatre points valent d'être connus avant d'y toucher :

- **L'état vide est de première classe.** La bascule vers le nouvel outil est nette,
  sans reprise de l'historique : toute statistique vaut zéro pour les 90 000 licenciés
  jusqu'à la première compétition jouée dessus. `{ aDesCombats: false }` ne porte
  **aucun** compteur, donc aucun écran ne peut afficher « 0 soumission » à quelqu'un qui
  n'a jamais combattu. C'est la forme qui l'empêche, pas un commentaire — même
  raisonnement que `computeFillRate`, qui rend `null` et non `0`.
- **Le temps jusqu'à la soumission n'est pas dans le journal**, et c'est mesuré :
  `day_fight_finish` insère son événement `finish` **sans** `fight_clock_ms`. Le prendre
  sur le dernier événement scoré donnerait l'instant du dernier point — et zéro pour
  toute soumission portée sans qu'un point ait été marqué, c'est-à-dire le cas courant.
  `finishClockMs` est donc fourni par l'appelant, ou absent, et l'absence se compte
  (`tempsNonMesures`) au lieu de valoir zéro.
- **Le pliage du journal ne filtre pas sur `kind`**, jumeau exact de `jour_j_fold_scores` :
  `undo` et `score_correction` portent un delta **négatif** de même `(side, scope)`, donc
  ne garder que `score` / `advantage` / `penalty` recompterait chaque point annulé.
- **Un combat compté deux fois double un bilan.** Les combats d'un athlète se lisent en
  deux requêtes (`registration_a`, puis `registration_b`) dont l'union se fait par
  concaténation côté appelant : le dédoublonnage par `fightId` est dans le module, pas
  dans la discipline de l'appelant.

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

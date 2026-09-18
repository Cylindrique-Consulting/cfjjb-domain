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

## Règlement de référence

Réponses du client du 15/09/2026 (T1.1, T1.2, R7) : il n'existe pas d'autre document
que ceux-ci, et c'est sur eux que ce package s'aligne.

| Sujet                              | Référence                                                           |
| ---------------------------------- | ------------------------------------------------------------------- |
| règles sportives, tableau de trois | **IBJJF Rules Book 6.1** (juin 2024)                                |
| durées de combat                   | IBJJF 6.1, General Competition Guidelines art. 1.3, sauf U7 = 3 min |
| repos entre deux combats           | IBJJF 6.1, GCG art. 1.4                                             |
| classements équipe et club         | article 3 du règlement officiel CFJJB 2024                          |
| points de placement                | guide des points v1.2                                               |
| tout le reste                      | les tickets et les réponses du 15/09/2026                           |

`REGLEMENT_DE_REFERENCE` (`src/referential.ts`) porte la version appliquée, pour la citer
à l'écran. La copie publique du fichier IBJJF porte « VERSION 6.2 » dans son colophon
alors que sa page de titre et sa date sont celles de la 6.1 : c'est la **6.1** qui fait
foi.

**Seul écart de durée avec les versions précédentes** : Master 2 violette, marron et
noire passent de 6 à 5 minutes (v0.15.0). Le règlement CFJJB 5.2 et le Manuel du format
2021, cités par d'anciens commentaires, ne font plus référence.

## Release A (v0.15.0)

Première des releases successives du chantier « compétition de test » (A : durées,
nomenclature, tableau de trois, repos ; B : moteur de podium ; C : planificateur avec
repos ; D : score de placement).

| Module                       | Ce qu'il apporte                                                            |
| ---------------------------- | --------------------------------------------------------------------------- |
| `src/referential.ts`         | Master 2 violette, marron, noire à 5 min ; `REGLEMENT_DE_REFERENCE`         |
| `src/round-names.ts`         | `nomDuTour` : T1…T4, QF, DF, F, 3e ; forme longue ; en-tête de colonne      |
| `src/fight-rest.ts`          | « a disputé un combat », multiplicateur et fin de repos (sans consommateur) |
| `src/bracket-propagation.ts` | trous #1 et #3 du tableau de trois ; cascade sans filtre de type            |

Le mot « Repêchage » ne sort plus d'aucun libellé : à trois inscrits, le combat
« perdant de la 1re demi-finale contre le 3e » est une **demi-finale** (« DF »). Le type
interne `BraketFightRepechage3` est conservé.

## Points, niveaux et saison sportive (v0.16.0)

`src/points.ts` porte le barème du guide des points v1.2 et de l'article 3 du règlement
CFJJB 2024, tel que le client l'a arrêté les 15 et 16/09/2026. La plateforme en stocke
le résultat sur chaque résultat officiel ; la fonction SQL `ranking_points_calcul` en
est la jumelle, et un test de parité de la plateforme rejoue les deux.

| Règle                    | Valeur                                                                 |
| ------------------------ | ---------------------------------------------------------------------- |
| catégorie de poids       | 9 / 3 / 1 (chaque 3e d'un tableau à deux bronzes reçoit 1)             |
| Absolut, individuel      | 13,5 / 4,5 / 1,5                                                       |
| niveau de la compétition | Open ×1, Majeure ×2, Championnat national ×4, hors classement ×0       |
| équipes et clubs         | 9 / 3 / 1 par médaille, absolut compris, **sans** coefficient          |
| un seul inscrit (3.4)    | aucun point, ni individuel, ni équipe, ni club                         |
| deux de la même équipe   | aucun point d'équipe ni de club (3.5), points individuels acquis       |
| arrondi                  | deux décimales, au plus loin de zéro (`round(numeric, 2)` de Postgres) |
| saison sportive          | du 1er août au 31 juillet, lue sur la date de la compétition           |

Quatre points valent d'être connus avant d'y toucher :

- **Tout est en centièmes entiers.** 13,5 vaut 1350, un coefficient ×2 vaut 200. Un
  flottant rendrait 28,999… pour 29, et deux totaux égaux pourraient se départager
  par une erreur d'arrondi.
- **Les jeunes marquent comme les adultes** (R2 du 16/09) : enfants U7 à U15 et
  juvéniles. Le calcul ne reçoit pas la tranche d'âge, donc aucune exclusion ne peut
  s'y glisser. `isChildAgeCategory` ne bouge pas : elle sert à d'autres règles.
- **L'ancien coefficient libre se lit comme un niveau** (R3 du 16/09) : 3 → Open,
  4 → Majeure, 5 → Championnat national ; 0 → hors classement. C'est une lecture, pas
  une réécriture : `niveauEffectif` préfère toujours un niveau explicite.
- **Les Masters regroupés restent regroupés dans un profil de classement.**
  `trancheDeProfil` rend « Master 1/2 » pour `master_1_2`, là où `resolveAgeGroup`
  rend « Master 1 » (exact pour les poids et les durées, faux pour un classement, qui
  fusionnerait deux profils).

## Release B (v0.17.0)

Moteur de podium, doubles disqualifications et arbitrage (lot L5 ; réponses du client
du 15/09/2026 : PO3, DQ1, SB3, PO4.5 ; IBJJF Rules Book 6.1, General Competition
Guidelines art. 2.3.1, 2.4.1 à 2.4.3, 4.2 à 4.4).

| Module                       | Ce qu'il apporte                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------ |
| `src/podium-officiel.ts`     | `classementOfficiel` (remplace `computePodium`), `estTermineeSansMedaille`, libellés       |
| `src/arbitrage.ts`           | `REGLES_FIN_SANS_VAINQUEUR`, `arbitrageRequisPour`, combats supplémentaires, scénarios     |
| `src/bracket-propagation.ts` | `double_dq`, `double_blessure`, `designation` ; `planFinishSansVainqueur`, `planArbitrage` |
| `src/fight-rest.ts`          | la désignation entre coéquipiers n'est pas un combat disputé                               |
| `src/fight-stats.ts`         | fins sans vainqueur nommées ; une désignation n'entre pas au bilan                         |
| `src/capabilities.ts`        | `fight.arbitrate`, `category.ranking_enter`, `arbitration.fights_create` (Responsable)     |

**Rupture assumée (0.x)** : `computePodium` et le type `Podium` sont retirés. Leur seul
consommateur est le module Jour J, qui passe au classement officiel dans la même vague.

### Le classement officiel

`classementOfficiel({ fights, thirdPlaceMode, seulInscrit, eligibilite, classementSaisi })`
rend un état (`en_cours`, `complet`, `terminee_sans_medaille`, `arbitrage_requis`,
`disciplinaire_en_attente`) et des places `{ rang, ordre, registrationId, motifVacance }` :
0 ou 1 or, 0 à 2 argents, 0 à 4 bronzes.

- **Éligibilité** : ne sont jamais classés le disqualifié disciplinaire et l'éliminé au
  check-in qui n'a pas combattu. La disqualification technique est une défaite ; l'absent
  qui a combattu garde sa place. Le seul inscrit n'a l'or qu'au check-in validé.
- **Places vacantes** : une ligne « Xe place vacante (motif) » seulement quand une place
  que le règlement attribue est retirée à un athlète inéligible, ou quand la règle dit
  « la place reste vacante ». Jamais pour une place que le format ne prévoit pas.
- **Remontées** : T2.3 (la place d'un inéligible sans combat revient à l'athlète battu plus
  tôt par son adversaire), T2.4 B (double forfait en demi-finale), 2.4.1 (double
  disqualification en demi-finale, avant les demies, place de demie sans qualifié), 2.4.2
  (finale), 2.4.3 (disqualification disciplinaire validée après combat : chaîne des battus).
- **Catégorie à deux** (règle CFJJB DQ1.5) : double technique, les deux 2es ; double
  disciplinaire, ni classement ni médaille ; mixte, le technique 2e seul.
- Le tableau est lu **comme la cascade de forfait l'aura soldé** : un combat dont un côté
  est structurellement impossible est un forfait que le serveur prononce. La cascade est en
  jeu dès qu'un athlète est éliminé **ou** qu'une fin sans vainqueur reste sans vainqueur
  (DQ1.2 : « passage sans adversaire » même quand personne n'est éliminé), miroir du
  périmètre de `jour_j_forfait_cascade`.

Tant que le lot L7 n'existe pas, une disqualification disciplinaire saisie à la table vaut
« validée » (`estDisqualifieDisciplinaire`, miroir SQL `jour_j_disqualifie_disciplinaire`) ;
l'entrée `disciplinaire: "en_attente"` est déjà le point de branchement.

### « Terminée sans médaillé »

`estTermineeSansMedaille` est un prédicat simple, miroir exact de
`jour_j_categorie_terminee_sans_medaille` : tout est joué, aucun arbitrage n'attend, et
aucun athlète classable n'a atteint la zone des médailles (combats de division 1 et 2).
L'équivalence avec l'état du moteur est prouvée exhaustivement sur les tableaux de 1 à 5
inscrits, à chaque état intermédiaire (`tests/terminee-sans-medaille.test.ts`).

### Arbitrage requis

Une double disqualification ou un arrêt pour double blessure à égalité parfaite ne désigne
aucun vainqueur. `REGLES_FIN_SANS_VAINQUEUR` dit, par format (deux, trois, au moins quatre),
tour et nature (technique, disciplinaire, mixte, blessure), si la suite est automatique ou
si le Responsable doit saisir un tirage au sort, une décision, un classement ou créer des
combats supplémentaires (hors grille : finale rejouée en division 1 index 1, demies
supplémentaires en division 2 index 2 et 3). Quand la règle désigne un athlète
indisponible, elle devient « classement ». Le combat pour la 3e place (mode `pool3`, absent
du règlement IBJJF) demande une décision du Responsable (le 3e désigné, ou personne), sauf
en double disqualification disciplinaire où la 3e place reste vacante. Chaque règle cite sa
source :

- « IBJJF Rules Book 6.1 (juin 2024), General Competition Guidelines art. 2.4.1 » ou « 2.4.2 » ;
- « IBJJF Rules Book 6.1 (juin 2024), règles d'arbitrage art. 2 (tirage au sort) » ;
- « Règle CFJJB (réponse DQ1.5 du 15/09/2026) » ;
- « Règle CFJJB (réponse DQ1.4 du 15/09/2026, cas non écrit) ».

La table a un second exemplaire en SQL (`jour_j_fin_sans_vainqueur_arbitrage`) : la
plateforme importe `scenariosFinSansVainqueur()` et `scenariosTermineeSansMedaille()` et
exige la même réponse dans `pnpm db:validate`.

## Repos au lancement et placement (v0.18.0)

`src/repos-jour-j.ts` consomme la règle de `src/fight-rest.ts` sans la modifier : un
combat disputé ouvre un repos d'une durée de combat de la catégorie à venir, deux avant
une finale (IBJJF Rules Book 6.1, GCG art. 1.4).

| Export                            | Rôle                                                                         |
| --------------------------------- | ---------------------------------------------------------------------------- |
| `finReelleDuCombatDispute`        | fin réelle d'un combat terminé : arrêt du chrono, sinon fin enregistrée      |
| `etatDuRepos`                     | repos requis, écoulé et restant d'un athlète à un instant donné              |
| `reposDuCombat`                   | une seule alerte pour un combat : côtés encore en repos, fin la plus tardive |
| `rangApresRepos`                  | rang du combat suivant dans la file de son tapis après le repos              |
| `SCENARIOS_FIN_DE_REPOS`          | cas de fin de repos rejoués par les exemplaires SQL et par le faux serveur   |
| `SCENARIOS_PLACEMENT_APRES_REPOS` | cas de placement rejoués par l'exemplaire SQL                                |

Le placement ne recule jamais un combat vers l'avant, ne franchit que des combats prêts
(en cours, ou visibles au check-in avec les contrôles validés des deux côtés, sans athlète
encore en repos ni engagé dans un autre combat), et s'arrête devant le premier combat qui
attend son résultat ou qui appartient à une autre journée de la compétition.
Le début estimé à un rang est l'instant présent plus la durée pleine des combats prêts
placés devant, sans battement.

## Estimateur des heures de passage (v0.19.0)

Réponses du client du 15/09/2026 (TB1, TB2, TB4, T9.1, T9.3, T12.1, T12.5, T12.6).

| Module                       | Ce qu'il apporte                                                           |
| ---------------------------- | -------------------------------------------------------------------------- |
| `src/estimateur-horaires.ts` | `estimerLesHoraires`, `ecartDeRythmeMinutes`, `couleurDEcart`, le plancher |

Un seul calcul d'heure sert tous les écrans : tableau de bord, check-in, prochains combats,
ordre des combats, planning, tableaux, vue publique, et le refus d'un déplacement qui placerait
un combat avant sa source.

- **File réelle** de chaque tatami, dans son ordre de passage ; un combat soldé n'y est plus.
- **Durée réglementaire plus espacement** entre deux combats d'un tatami.
- **Repos** des athlètes, tous tatamis et compétitions liées confondus : la règle est celle de
  `fight-rest.ts` (une durée, deux avant une finale), comptée depuis la fin réelle ou estimée du
  combat précédent. Un combat aux adversaires inconnus attend la fin estimée de ses combats
  sources, supposés disputés.
- **Ancrage** : tant qu'un tatami n'a rien lancé dans la journée, il part de
  max(maintenant, début prévu).
- **Plancher** : jamais avant l'heure prévue de la catégorie moins 90 minutes, pour
  l'affichage seulement (`PLANCHER_AFFICHAGE_MS`).
- **« À présent »** : le prochain combat à lancer d'un tatami, journée commencée, heure atteinte.
- **Enchaînement** : sur un même tatami physique, les combats non soldés d'une compétition
  précédente passent devant (option `enchainement`).
- **Jamais de réordonnancement** : si le prochain combat attend un repos, le tatami attend.

L'écart de rythme d'un tatami vaut fin estimée − (fin prévue d'origine + effet des ajouts et
retraits), arrondi à la minute ; sa couleur suit quatre seuils fixes : ≤ −10 bleu, −9 à +9
vert, +10 à +30 orange, au-delà rouge.

Le calcul est pur : l'instant courant est un paramètre, mêmes entrées, même sortie. Une source
rangée après son dépendant ne bloque rien : la contrainte est ignorée et signalée
(`dependanceIgnoree`).

## Release v0.20.0 : les absoluts

Règles de l'absolut (réponses du client du 15/09/2026 : AB1 à AB7, T2.5, T4.3, T5.1 à
T5.3, PL1.2 ; relance R1 du 16/09/2026).

| Module                  | Ce qu'il apporte                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------- |
| `src/absolut-regles.ts` | périmètre (noire Adulte, juvénile Leve / Pesado), échéance, garde de génération, tapis, scénarios |
| `src/capabilities.ts`   | `absolut.generate`, `close_early`, `reopen`, `ungenerate`, `deadline_set` (Responsable)           |

- **Une source est terminée** quand son podium est confirmé, ou qu'elle est terminée sans
  médaillé. La remise des médailles n'est jamais exigée.
- **Échéance dérivée** (`etatInscriptionsAbsolut`) : 20 minutes
  (`DELAI_INSCRIPTION_ABSOLUT_MINUTES`) après la dernière source terminée, pour tout absolut
  qualifié par une médaille, noires Masters et juvéniles compris ; heure limite de la
  compétition pour la ceinture noire Adulte (`estNoireAdulte`) ; aucune pour un absolut
  rouvert. Une source qui repasse « Attendu » suspend le délai.
- **Clôture** : un seul inscrit actif annule l'absolut (`statutALaCloture`).
- **Génération** (`manquesDeGeneration`) : inscriptions closes, toutes les sources
  terminées (noire Adulte selon `attendLesPoids`, vrai par défaut), au moins deux inscrits.
- **Juvéniles** : bleue et violette seulement, en deux absoluts « Leve » (Galo à Leve) et
  « Pesado » (Medio à Pesadissimo), `groupeAbsolutJuvenile` et `perimetreAbsolut`.
- **Tapis par parties** (`tapisDuCombatAbsolut`) : 1, 2, 4 ou 8 tapis ; un combat reste sur
  le tapis de ses combats nourriciers tant que le tour compte au moins autant de combats que
  de tapis ; finale et combat pour la 3e place sur le premier tapis choisi ; tableau de trois
  sur un seul tapis.

Chaque règle a un miroir SQL : la plateforme rejoue `scenariosInscriptionsAbsolut()` et
`scenariosGroupeJuvenile()` dans `pnpm db:validate`. L'annulation forcée d'un tableau déjà
commencé et l'annulation définitive d'un absolut ne sont pas des verbes de la matrice : elles
sont réservées aux responsables désignés, connectés avec leur compte personnel.

## Release C (v0.21.0) : le planning au combat

Ordonnanceur au niveau du combat, répartition d'une catégorie sur plusieurs tatamis,
enchaînement des compétitions d'un événement et contrôles de publication (lot L12,
tickets PL1, PL2, PL3 ; réponses du client des 11 et 15/09/2026 ; relance BR3.4 du 18/09).

| Module                             | Ce qu'il apporte                                                                  |
| ---------------------------------- | --------------------------------------------------------------------------------- |
| `src/ordonnanceur-planning.ts`     | `planifierCombats` : tatami, journée, heure prévue et rang par combat             |
| `src/repartition-tatamis.ts`       | proposition 1 / 2 / 4 / 8, découpage par parties, convergence, libellés           |
| `src/enchainement-competitions.ts` | `planifierLEvenement` : Gi puis No-Gi, athlètes communs, conflits                 |
| `src/controles-de-planning.ts`     | refus, bloquants, avertissements à confirmer, statut et publication automatique   |
| `src/ordre-sportif.ts`             | ordre âge › genre › ceinture › poids, absoluts en fin de tranche, sans discipline |

### L'ordonnanceur

`planifierCombats` remplace `computeTatamiSchedule`, qui enchaînait les combats bout à bout :
à trois inscrits et 5 minutes de combat, il plaçait la finale **6 minutes** après la seconde
demi-finale, contre **15 minutes** aujourd'hui (5 de combat + 10 de repos).

- **Une file par tatami et par journée.** Les catégories y passent dans l'ordre du planning
  (`rangDePlanning`), les combats d'une catégorie dans l'ordre de `categoryRunningOrder` :
  tours les plus profonds d'abord, 2e demi-finale d'un tableau de trois après la 1re, combat
  pour la 3e place puis finale en dernier.
- **Repos** : la règle est celle de `fight-rest.ts` (`multiplicateurDeRepos`), comptée depuis la
  fin nominale du combat source — une durée de combat de la catégorie à venir jusqu'aux
  demi-finales, deux avant toute finale. Un combat bye ne prend pas de place dans la file et
  n'ouvre aucun repos.
- **Intercalation** : si le tour en cours de la catégorie en cours n'est pas encore autorisé,
  l'ordonnanceur prend un autre combat **du même tour**, puis un combat autorisé des catégories
  suivantes du même tatami, dans l'ordre du planning. Il ne franchit jamais une frontière de
  tour : une demi-finale ne remonte pas devant un quart. Un tatami n'attend que si aucun combat
  n'est autorisé, et le combat placé porte alors `intercale`.
- **Espacement** : 60 secondes par défaut, réglable ; il sépare deux combats d'un tatami et ne
  s'ajoute pas au repos.
- **Athlètes** : les identifiants portés par `combats[].athletes` sont ceux du **licencié**, les
  mêmes dans toutes les compétitions de l'événement. C'est ce qui fait mordre le repos d'une
  compétition sur l'autre ; avec des identifiants d'inscription, la contrainte ne joue pas.
- **Rang** : la file du jour J suit exactement l'ordre croissant des heures prévues, le rang 1
  étant le combat prévu le plus tôt.

Le calcul est pur et déterministe : mêmes entrées, même plan. Une source impossible à placer
ne bloque pas le plan, elle est ignorée et signalée (`dependanceIgnoree`), comme dans
l'estimateur.

### La répartition d'une catégorie

`proposerLaRepartition` propose un nombre de tatamis selon l'effectif — 1 jusqu'à 16, 2 de 17 à
32, 4 de 33 à 64, 8 au-delà — plafonné au plus grand de 1, 2, 4, 8 qui tient dans la compétition.
**Jamais 3** : avec trois tatamis, une catégorie de 40 va sur 2 et le troisième reste libre pour
d'autres catégories. Poules, tableaux de trois et catégories à deux inscrits ne sont jamais
réparties. Le responsable accepte, modifie (`valeursAdmises`) ou refuse (`tatamisApresArbitrage`,
un refus ramène à 1). L'alternative d'un cran (2 jusqu'à 16, 4 de 17 à 32) est rendue par
`alternativeSuggeree`, à proposer quand l'alerte de déséquilibre vise le tatami de la catégorie.

`partiesDuCombat` découpe le tableau selon ses branches. Un combat du tour de division `d`
(2^(d-1) combats) appartient à la partie `floor(index × p / 2^(d-1))` tant que son tour compte au
moins `p` combats : aucun athlète ne change de tatami avant la convergence. Quand un tour compte
moins de combats que de parties, chacun réunit les parties deux à deux — à 8 parties, quarts sur
4 tatamis, demi-finales sur 2, finale sur 1. `repartirLesCombats` choisit alors, parmi les
tatamis réunis, celui qui **finit le plus tard** (`chargeParTatami`, égalité tranchée par le plus
petit numéro) ; `tatamiParCombat` impose un autre tatami des parties réunies, et refuse tout
autre. Sans charge connue, le choix retombe sur le premier des tatamis réunis, c'est-à-dire
exactement `tapisDuCombatAbsolut` : la console absolut du jour J et le planning disent la même
chose, et un test de parité le vérifie sur 1, 2, 4 et 8 tapis.

Libellés : `libelleDesTatamis` rend « Tatami 3 », « Tatamis 1 et 2 » (jamais « 1 à 2 »),
« Tatamis 1 à 4 » et « Tatamis 1, 3, 5 et 7 » ; `libelleDePartie` rend « Partie 1/4 » et rien
pour une catégorie sur un seul tatami. Un combat de convergence n'a pas de partie : il porte le
nom de son tour (`nomDuTour`).

### L'enchaînement des compétitions d'un événement

Gi, No-Gi, Kids Gi et Kids No-Gi sont quatre compétitions distinctes d'un même événement. Seule
la première compétition d'une journée porte une heure saisie ; `planifierLEvenement` fait partir
chaque suivante de la **fin prévue de la précédente**, tous tatamis libérés, et le repos des
athlètes communs est tenu combat par combat : la compétition suivante n'est pas décalée en bloc,
c'est le combat de l'athlète commun qui recule. Une heure saisie qui ferait empiéter une
compétition sur la précédente est acceptée mais signalée
(`chevauchement_de_competitions`).

Au planning, le vainqueur n'est pas connu : un athlète est réputé occupé de la première à la
dernière heure prévue de sa catégorie, finale comprise. Deux occupations qui se chevauchent sont
une **double convocation**. Le repos, lui, se juge sur le premier combat réel de l'athlète
(`premierCombatMs`) : un plan qui fait passer l'athlète commun plus tard dans sa catégorie est
correct, même si sa catégorie ouvre plus tôt.

### Les contrôles avant publication

`controlerLePlanning` rend des constats de trois gravités, `verdictDePublication` en tire le droit
de publier, et chaque constat porte une **clé stable** : une retouche annule la validation mais
`confirmationsConservees` garde les confirmations des avertissements qu'elle ne touche pas.

| Constat                         | Gravité       | Ce qui le déclenche                                               |
| ------------------------------- | ------------- | ----------------------------------------------------------------- |
| `source_apres_dependant`        | refus         | source rangée après son dépendant, par rang ou par heure          |
| `double_convocation`            | bloquant      | deux catégories du même jour se disputent le même licencié        |
| `repos_insuffisant`             | avertissement | moins d'une durée de combat (deux avant une finale) de repos      |
| `depassement_de_journee`        | avertissement | un tatami finit après l'heure de fin de sa journée                |
| `desequilibre_de_tatami`        | avertissement | un tatami finit plus de 60 min après la moyenne des autres        |
| `chevauchement_de_competitions` | avertissement | une compétition commence avant la fin prévue de la précédente     |
| `repartition_non_examinee`      | avertissement | une proposition de répartition à plus d'un tatami jamais tranchée |

Un refus et un bloquant ne se lèvent par aucune confirmation ; un avertissement exige une
confirmation explicite. Le déséquilibre de Charléty Adultes (Tatami 1 vers 21:41, les autres
avant 19:20, journée jusqu'à 22:30) donne un avertissement de déséquilibre sur le Tatami 1 et
aucun dépassement.

`statutDePlanning` nomme brouillon, validé, publié et modifié après publication ;
`publicationAutomatique` dit à la tâche planifiée de publier un planning validé à l'échéance,
d'alerter si le planning est encore en brouillon, et de ne rien faire après une retouche — la
republication est manuelle.

Qui fait quoi : l'identifiant de poste partagé du jour J **n'ouvre pas** l'outil de préparation
(`peutConsulterAvantPublication` est faux). Un responsable désigné sur la fiche, avec son compte
personnel, consulte et valide ; un compte fédéral autorisé à modifier les compétitions consulte,
génère, retouche, valide et publie.

### Ce que la release C ne fait pas encore

`planCategories`, `assignCategoriesToDays` et `computeTatamiSchedule` restent exportés : la
plateforme et le module s'appuient encore dessus, et leur reprise se fait dans leur propre PR. La
journée d'une catégorie est une **entrée** de `planifierCombats` ; `dureeIncompressibleSecondes`
donne la durée minimale d'une catégorie, attentes de repos comprises, pour que la répartition par
journée cesse de la sous-estimer.

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

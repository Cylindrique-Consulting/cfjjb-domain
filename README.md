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
- **La séparation coûte des places, et le prix est mesuré.** Depuis v0.35.0, elle passe
  après l'équipe (dernier palier, guide v1.3 §7), mais reste active : sans coéquipiers en
  jeu, sur le cas à trois catégories sources placé par médaille, la réparation déplace la
  tête de série n° 1 et lui retire son bye pour défaire l'appariement interdit. Le test
  l'affirme au lieu de le taire.
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
| `src/round-names.ts`         | `nomDuTour` : T1…T4, QF, DF, F, 3e, NDF, NF ; forme longue ; en-tête ; tri  |
| `src/fight-rest.ts`          | « a disputé un combat », multiplicateur et fin de repos (sans consommateur) |
| `src/bracket-propagation.ts` | trous #1 et #3 du tableau de trois ; cascade sans filtre de type            |

**Les combats d'arbitrage ont leur propre nom** (retour client du 22/09/2026). Une finale rejouée
porte la division de la finale et une demi-finale supplémentaire celle des demi-finales : sans
leur index, `nomDuTour` les nommait « Finale » et « Demi-finale », comme les combats qu'elles
remplacent. `EntreeNomDuTour` accepte donc un `indexInDivision` **optionnel** : un appelant qui
nomme une colonne ne le passe pas, un appelant qui l'oublie nomme le tour comme avant. Passé sur
une coordonnée hors grille (`estHorsGrille`, descendue ici depuis `arbitrage.ts` et réexportée
par lui), le tour devient « Nouvelle finale » (`NF`) ou « Nouvelle demi-finale » (`NDF`, colonne
« Nouvelles demi-finales »). `comparerHorsGrille` les range par division décroissante puis par
index, soit leur ordre de passage : c'est la règle que `arbitragesRequis` et
`day_arbitrage_combats_creer` écrivaient déjà chacun de leur côté.

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
indisponible, elle devient « classement ». Un quart de finale exempté (bye) ne désigne
personne : de ce côté, le seul perdant de quart va directement en finale (v0.32.0).
Le combat pour la 3e place (mode `pool3`, absent
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
| `src/repartition-tatamis.ts`       | proposition 1 à 8 (1, 2, 4, 8 avant v0.34.0), découpage, convergence, libellés    |
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
- **Ordre dans un tour** (depuis v0.24.0, assoupli en v0.34.0) : les combats d'un même tour
  passent dans l'ordre du tableau, du haut vers le bas. S'il attend la fin d'un repos, ou un
  combat source placé sur un autre tatami, le premier combat restant du tour laisse passer une
  autre catégorie du tatami ; seulement si aucune ne peut commencer, un autre combat de son tour,
  prêt à l'heure où le tatami se libère, passe devant lui (ORD.10 B, voir v0.34.0). Deux tours ne
  sont jamais mélangés : une demi-finale ne remonte pas devant un quart.
- **Intercalation** : pendant cette attente, l'ordonnanceur fait passer le premier combat
  autorisé des catégories suivantes du même tatami, dans l'ordre du planning ; ce combat porte
  `intercale`. Si aucune n'a de combat autorisé, le tatami attend, puis lance le premier combat
  de tête qui le devient.
- **Espacement** : 120 secondes par défaut depuis v0.34.0 (60 avant), réglable ; il sépare deux
  combats d'un tatami et ne s'ajoute pas au repos.
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
32, 4 de 33 à 64, 8 au-delà — plafonné au nombre de tatamis de la compétition. Jusqu'à v0.33.0,
le plafond était le plus grand de 1, 2, 4, 8 qui tient dans la compétition, jamais 3 ; depuis
v0.34.0, tout nombre de 1 à 8 est admis (REP.1 A) et une catégorie de 40 sur trois tatamis en
reçoit 3. Poules, tableaux de trois et catégories à deux inscrits ne sont jamais
réparties. Le responsable accepte, modifie (`valeursAdmises`) ou refuse (`tatamisApresArbitrage`,
un refus ramène à 1). L'alternative d'un cran (2 jusqu'à 16, 4 de 17 à 32) est rendue par
`alternativeSuggeree`, à proposer quand l'alerte de déséquilibre vise le tatami de la catégorie.

`partiesDuCombat` découpe le tableau selon ses branches (à 3, 5, 6 ou 7 parties, par morceaux
entiers : voir v0.34.0). Un combat du tour de division `d`
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
seul recule ce qui attend l'athlète commun. Un combat de cet athlète placé en tête de son tour
laisse d'abord passer une autre catégorie du tatami ; s'il n'y en a pas, le combat suivant de son
tour passe devant lui (ORD.10 B, depuis v0.34.0 ; de v0.24.0 à v0.33.0, le tatami attendait et
tout le tableau reculait). Une heure saisie qui ferait empiéter une
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
| `repos_insuffisant`             | bloquant      | moins d'une durée de combat (deux avant une finale) de repos      |
| `depassement_de_journee`        | avertissement | un tatami finit après l'heure de fin de sa journée                |
| `desequilibre_de_tatami`        | avertissement | un tatami finit plus de 60 min après la moyenne des autres        |
| `chevauchement_de_competitions` | avertissement | une compétition commence avant la fin prévue de la précédente     |
| `repartition_non_examinee`      | avertissement | une proposition de répartition à plus d'un tatami jamais tranchée |

Un refus et un bloquant ne se lèvent par aucune confirmation ; un avertissement exige une
confirmation explicite. Le repos insuffisant était un avertissement jusqu'à v0.33.0 ; il bloque
la publication depuis v0.34.0 (RPS.3 B). Le déséquilibre de Charléty Adultes (Tatami 1 vers 21:41, les autres
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

## Release D (v0.22.0) : le score de placement

`src/score-de-placement.ts` calcule ce que le guide des points v1.2 appelle le score de
placement : la priorité d'un athlète avant qu'un tableau ne soit tiré. Le module est pur,
donc le même calcul vaut en salle (absolut) et sur la plateforme (catégories de poids) —
c'est la seule façon de tenir le §6.2, qui demande aux résultats du jour d'actualiser le
score qui départage l'absolut, alors que le module tourne sur une pile de gymnase.

| Ce qui entre                                      | Ce qui sort                                                          |
| ------------------------------------------------- | -------------------------------------------------------------------- |
| résultats officiels du licencié (trois saisons)   | contribution de chaque résultat, avec ses trois pourcentages         |
| profil visé (discipline, sexe, tranche, ceinture) | score général, score Absolut, score direct                           |
| graine du tableau                                 | rang sportif #1…#N, tous distincts, et la raison de chaque départage |

- **Parts de saison** : saison visée 100 %, N-1 50 %, N-2 25 %, au-delà 0 %. Une saison
  va du 1er août au 31 juillet (`bornesSaisonSportive`).
- **Contribution** = points × part de saison × part d'âge × part de ceinture. Les facteurs
  se multiplient, jamais ne s'additionnent.
- **Arrondi** : les contributions sont calculées exactement, le score est arrondi une seule
  fois à deux décimales, et l'ordre se fait sur cette valeur (§3.2, « aucune décimale
  cachée »). Trois contributions de 0,125 donnent 0,38, non 0,39.
- **Masters regroupés** (BR3.7, proposition A) : un groupe compte comme **un seul niveau**,
  valable pour **chacune** de ses tranches. « Master 3/4 » vaut donc 100 % vers Master 3 et
  vers Master 4, et 50 % vers Master 1 comme vers Master 2. Le nombre de remontées se compte
  dans l'échelle de la saison du résultat (`groupesMasterDeLaSaison`) : regroupée jusqu'en
  2025-26, séparée ensuite. Un entier unique par tranche ne peut pas exprimer cette
  couverture, d'où l'intervalle de `NIVEAUX_MASTER_COUVERTS`.
- **Ceintures** (BR3.8, proposition A) : le « juste en dessous » du §5 se lit sur l'échelle
  de la tranche visée — enfants blanche, grise, jaune, orange, verte ; Juvénile et au-delà
  blanche, bleue, violette, marron, noire. Toute ceinture d'enfant compte comme une blanche
  vers un tableau Juvénile ou Adulte, et corail et rouge comptent comme une noire. L'échelle
  continue des onze grades produisait une quatrième règle, qui n'était aucune des options
  posées au client : elle refusait 50 % de la blanche vers la bleue (cinq crans d'écart) et
  accordait 100 % à une verte d'enfant vers une bleue de juvénile.
- **Ceinture plus haute que le tableau** : cas en principe impossible. Le résultat n'est pas
  compté et ressort dans `ScoreDePlacement.ecartes`, pour le rapport de génération.
- **Départage** (BR3.4 C, réponse du client) : score général puis score direct ;
  pour un absolut, score Absolut puis général puis direct (§6, jamais additionnés) ; puis les
  critères du classement national du §2.2 appliqués aux résultats qui composent le score
  (points de Championnat national, de Majeures, puis or, argent, bronze) ; puis un tirage
  reproductible à partir de la graine du tableau. **Chaque athlète reçoit un rang distinct** :
  deux athlètes ne peuvent pas occuper la même graine. `RangSportif.departage` dit lequel des
  trois étages a tranché, ce qu'attend la légende du §9.1. Depuis la v0.25.0, un absolut en
  compte un quatrième, avant le tirage : voir plus bas.

Le calcul n'est encore branché sur aucune génération de tableau : `BracketEntry.rank` n'est
alimenté par personne et l'étape `protected-ranking` de `seeding-plan.ts` reste éteinte. C'est
conforme à BR3.9, dont la proposition A laisse le tirage actuel en service jusqu'à la mise en
service du placement par rang.

## Release v0.23.0 : la disqualification disciplinaire

Vocabulaire et droits de la sanction disciplinaire (réponses du client du 11/09/2026 :
DQ2.1 à DQ2.13, T3.1, T5.2, T13.2, T21.2 ; IBJJF Rules Book 6.1 et 7.1, GCG 2.4.2 et
2.4.3).

| Module                            | Ce qu'il apporte                                                                              |
| --------------------------------- | --------------------------------------------------------------------------------------------- |
| `src/sanctions-disciplinaires.ts` | articles 6.1.x (libellé et texte), moments, origines, statuts, refus, libellés public / staff |
| `src/capabilities.ts`             | `sanction.validate`, `refuse`, `pronounce`, `cancel` (Responsable, hors tapis)                |

- **Un cycle de vie porté par l'ATHLÈTE, pas par le combat** : `en_attente`, `validee`,
  `refusee`, `annulee`. `competition_fight_states` sait dire « ce combat s'est terminé par
  une disqualification disciplinaire » ; elle ne sait pas dire « cette sanction attend la
  validation du Responsable » (DQ2.6).
- **Trois valeurs, et l'attente en est une** : `statutDisciplinaireDeLaSanction` traduit le
  statut dans le vocabulaire de `classementOfficiel`, qui rend déjà l'état
  `disciplinaire_en_attente`. Un refus et une annulation valent « aucune » : ils RENDENT à
  l'athlète sa place (DQ2.8, DQ2.13).
- **Deux libellés, selon qui regarde** : `libellePublicDeSanction()` rend
  « Disqualification » seule, sans paramètre — le motif n'a aucun chemin vers l'écran
  externe ni les vues publiques (DQ2.11, T13.2) ; `libelleStaffDeSanction` dit l'état de la
  décision.
- **Les articles, avec leur texte** : le client a répondu A à DQ2.10, « Liste reprenant
  l'article 6.1 + commentaire libre facultatif ». Les six articles sont ceux du règlement
  officiel CFJJB 2024, page 23 (« 6.1 Fautes disciplinaires »), numérotés comme dans le
  règlement IBJJF 2024. `libelleCodeSanction` rend le numéro et un libellé court, un par
  bouton (« Article 6.1.4 : Comportement offensant ou irrespectueux ») ;
  `texteArticleSanction` rend la phrase complète du règlement, recopiée mot pour mot. Le
  libellé court résume, le texte complet fait foi.
- **Les quatre verbes ne sont pas bornés à un tapis** : une faute commise sur le tatami 3
  exclut aussi de la compétition No-Gi du même événement (IBJJF Rules Book 7.1). Ce que la
  matrice ne sait pas dire — prononcer hors combat et annuler exigent un compte PERSONNEL,
  pas un identifiant de poste partagé (T21.1) — reste une garde serveur.

## Release v0.24.0 : l'ordre strict du tableau dans un tour

`planifierCombats` ne fait plus passer un combat d'un tour devant un autre combat du même tour.
Aucun export n'est ajouté ni retiré : seul l'ordre des combats change.

- **Avant** (v0.21.0 à v0.23.0) : quand le combat suivant d'un tour ne pouvait pas encore
  commencer, parce qu'un de ses athlètes était en repos ou que son combat source, sur un autre
  tatami, n'était pas encore placé, l'ordonnanceur faisait passer un autre combat prêt du
  **même tour** avant de regarder les autres catégories du tatami.
- **Maintenant** : seul le premier combat restant du tour est candidat. S'il ne peut pas
  commencer, une **autre catégorie** du tatami passe pendant l'attente ; s'il n'y en a pas, le
  tatami attend. Les combats d'un tour passent toujours du haut vers le bas du tableau.

Pourquoi : le client n'a jamais demandé de permuter deux combats d'un même tour, c'était un
choix fait pendant le développement de la release C. Décision du 18/09/2026 : proposer au client
l'ordre strict (question PL3.9, option B). C'est la lettre de ses réponses T7.1 et TR1.1, qui
font passer pendant un repos « des combats d'autres catégories du même tatami ». Pour le jour J,
le client a écarté en DQ4.2 le recul automatique d'un combat en repos derrière le prochain
combat prêt : le planning préparé suit désormais la même règle.

Ce que cela change, en combats de 5 minutes séparés de 60 secondes :

| Cas                                                                              | Avant                                                                  | Maintenant                                                                                                     |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Tableau de 5 inscrits seul sur son tatami, 1er tour à 09:00                      | 2e demi-finale 09:06, 1re 09:12, finale 09:27                          | 1re demi-finale 09:10 (fin du repos), 2e 09:16, finale 09:31                                                   |
| Le même, suivi sur le tatami d'une catégorie de 4 inscrits                       | demi-finales du 5 à 09:06 et 09:12, l'autre catégorie à 09:18 et 09:24 | l'autre catégorie passe à 09:06 et 09:24, les demi-finales du 5 à 09:12 et 09:18 ; fin 09:44 dans les deux cas |
| Gi finie à 13:59, No-Gi à 14:00, athlète commun au 1er combat d'un tableau de 16 | combat 2 à 14:00, combat 1 à 14:06, finale 15:33                       | combat 1 à 14:04, finale 15:37 ; avec une autre catégorie sur le tatami, elle passe à 14:00                    |

- **Tableau complet, sans athlète engagé ailleurs dans la journée** : les deux ordres sont
  identiques.
- **Tableaux à exempts** : sur un tatami seul, de 2 à 64 inscrits, seuls 5, 9, 17 et 33
  inscrits diffèrent. Ils n'ont qu'un combat réel au premier tour, et son vainqueur est attendu
  au premier combat du tour suivant. La finale est prévue un repos moins l'espacement plus tard :
  4 minutes en combats de 5 minutes.
- **Athlète commun à deux compétitions qui se suivent** : quand il ouvre le tableau, le
  décalage vaut au plus son repos moins l'espacement.
- **Pas d'interblocage entre tatamis** : une source précède toujours son dépendant dans
  `categoryRunningOrder`. Parmi les combats restants d'une catégorie, celui qui vient le premier
  dans cet ordre a donc toutes ses sources placées, et il est en tête de la file de son tatami :
  un tatami au moins peut toujours avancer. Un test le vérifie sur 200 affectations quelconques
  des combats à 2, 3 ou 4 tatamis, sans aucune `dependanceIgnoree`.

## Release v0.25.0 : le départage propre à l'absolut

Décision du 18/09/2026 : question AB7.6, option C. Pour un absolut, `ordonnerPourTableau`
ne passe plus directement des critères du classement national au tirage au sort : l'absolut
garde entre les deux l'ordre qui lui est propre, celui que le client a demandé en BR3.3 et
que `ABSOLUT_SEEDING_PLAN` applique déjà.

L'ordre complet d'un absolut (`ordonnerPourTableau(scores, { absolut: true, graine })`) :

1. score Absolut, puis score général (résultats du jour compris), puis score direct (§6) ;
2. les critères retenus pour les catégories de poids (BR3.4 C), calculés sur les résultats
   qui composent le score : points de Championnat national, puis de Majeures, puis nombre
   d'or, d'argent, de bronze ;
3. **la place obtenue le jour même dans la catégorie de poids** : or, puis argent, puis
   bronze ; les ceintures noires Adulte inscrites sans médaille viennent après tous les
   médaillés ;
4. **la catégorie de poids la plus lourde** ;
5. le tirage au sort, reproductible à partir de la graine du tableau.

Une catégorie de poids garde son ordre : score général, score direct, critères, tirage. Les
étapes 3 et 4 n'existent que pour un absolut.

| Ce qui change                                           | Détail                                                                                                                |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `scoreDePlacement(licenseeId, resultats, cible, jour?)` | 4e paramètre **optionnel**, `ParcoursDuJour` : `sourcePlace` et `sourceWeightClass`, comme dans `AbsolutRegistration` |
| `ScoreDePlacement.jour?`                                | champ **optionnel**, `PlaceDuJour` : la place et le rang de poids lus (`placeDuJourDe`)                               |
| `RangSportif.departage`                                 | nouvelle valeur `"jour"` : la place du jour ou la catégorie la plus lourde a tranché                                  |
| `compareSourcePlaceThenWeight` (`seeding-plan.ts`)      | la comparaison de l'étape `source-place`, désormais exportée et partagée                                              |

- **Une seule définition, celle du plan de tirage de l'absolut.** L'étape `source-place` de
  `seeding-plan.ts` et l'ordre du score de placement appellent la même fonction,
  `compareSourcePlaceThenWeight` ; le rang de poids est celui de `sourceWeightRank`
  (`absolut-seeding.ts`). Un test vérifie qu'à scores égaux l'ordre de l'absolut est
  exactement celui de `absolutSeedOrder`.
- **Catégorie la plus lourde** : rang dans `WEIGHT_CLASSES`, de Galo à Pesadissimo, lu dans
  les deux vocabulaires de la colonne (nom écrit par la plateforme ou indice hérité de l'ETL).
  Les absoluts juvéniles « Leve » et « Pesado » regroupent des catégories de cette même
  échelle ; le nom de l'absolut lui-même (« Absolut Leve ») n'est pas une catégorie de poids.
- **Quand les données du jour manquent** :
  - place absente (`sourcePlace` nul ou non fourni) : l'athlète passe après tous ceux qui
    ont une place, comme une ceinture noire Adulte inscrite sans médaille ;
  - catégorie absente ou illisible : elle compte comme la plus légère, jamais comme la plus
    lourde ;
  - pas de paramètre `jour` pour un athlète : les deux à la fois, place absente et catégorie
    inconnue. L'appelant fournit donc `jour` à **tous** les inscrits de l'absolut : un
    athlète oublié serait classé comme un inscrit sans médaille ;
  - pas de paramètre `jour` pour personne : les étapes 3 et 4 ne départagent personne, et
    l'ordre est exactement celui de la v0.24.0, tirage compris (mêmes groupes d'ex aequo,
    même graine, donc même tirage).
- **Catégories de poids** : `jour` est ignoré quand `absolut` vaut `false`. L'aperçu du
  score de placement de la plateforme ordonne avec `absolut: false` : son résultat ne change
  pas. Un consommateur qui traduit `departage` en libellé doit prévoir `"jour"` avant
  d'ordonner un absolut.
- **Rien d'autre ne bouge** : le score (général, Absolut, direct), les agrégats du §2.2 et
  `ABSOLUT_SEEDING_PLAN` sont inchangés.

Le calcul n'est toujours branché sur aucun tirage (BR3.9) : c'est l'ordre que prendra un
absolut le jour où le placement par rang sera mis en service. En attendant,
`generateAbsolutBracket` tire l'absolut par place source puis catégorie la plus lourde, sans
score.

## Release v0.26.0 : le placement par rang sportif

Le score de placement (v0.22.0, v0.25.0) devient une manière de **placer** un tableau. Le
générateur ne change pas de comportement par défaut : le placement par rang n'agit que si
l'appelant le demande, c'est-à-dire, côté plateforme et module, sur une compétition dont
l'interrupteur « placement par rang » est activé (décision du 18/09/2026 : désactivé par
défaut, BR3.9 option A pour toutes les autres compétitions).

| Ce qui s'ajoute                                            | Rôle                                                                                                            |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| étape `rang-sportif` (`seeding-plan.ts`)                   | ordonne les graines par `BracketEntry.rank` croissant ; une inscription sans rang passe en dernier, avec alerte |
| `SeedingPlan.reparation: "rang-voisin"`                    | la séparation des coéquipiers au rang voisin (BR3.6, proposition B), à la place de la réparation libre          |
| `RANG_SPORTIF_SEEDING_PLAN` (`placement-par-rang.ts`)      | le plan d'une catégorie de poids : rang, puis même équipe au premier tour                                       |
| `ABSOLUT_RANG_SPORTIF_SEEDING_PLAN` (`absolut-seeding.ts`) | le plan d'un absolut : rang, puis même catégorie source, puis même entité (équipe, sinon club)                  |
| `generateAbsolutBracket(…, { placement })`                 | `"place-source"` (défaut, inchangé) ou `"rang-sportif"` ; `AbsolutRegistration.rank` porte le rang              |
| `BracketResult.echanges`                                   | qui a été échangé avec qui, et pour quelle contrainte : le rapport de génération les nomme                      |
| `figerLePlacement`, `critereQuiDepartage`                  | l'instantané d'un tableau (rang, trois scores, critère qui a départagé, contributions) et la légende (BR3.5 B)  |
| `resultatPourPlacementDepuisLaBase`                        | une ligne de `competition_results` lue en base devient un `ResultatPourPlacement`, ou `null`                    |
| `placerLesInscrits`, `placementPourLaBase`                 | le rang de chaque inscription d'un tableau (clé : l'inscription), et la charge qu'écrit la base                 |

- **La disposition est celle de `seedPositions`** : #1 contre le dernier, #1 et #2 dans deux
  moitiés opposées, les byes aux mieux classés. Aucun tirage n'est consommé : le hasard ne
  tranche plus que les égalités parfaites, dans `ordonnerPourTableau`, à partir de la graine
  du tableau.
- **La séparation au rang voisin** ne regarde que le premier tour. Pour chaque rencontre entre
  deux athlètes d'une même entité, le moins bien classé des deux est échangé avec l'athlète de
  rang le plus proche qui évite la rencontre ; à écart égal, le moins bien classé d'abord.
  L'échange est refusé s'il crée une autre rencontre interdite, s'il sort #1 ou #2 de sa
  moitié, ou s'il touche un exempté (un bye ne change jamais de main). Une rencontre que rien
  ne peut éviter reste en place, et l'appelant la signale comme aujourd'hui. Depuis la v0.31.0,
  l'absolut sépare aussi ses coéquipiers entre les deux moitiés du tableau (voir plus bas).
- **Le critère qui départage** chaque rang est lu sur l'ordre rendu par `ordonnerPourTableau` :
  score Absolut, général ou direct selon la première valeur qui diffère du rang précédent,
  sinon critères du classement national, place et catégorie du jour, tirage. La légende ne
  mentionne que le score direct, les critères, le jour et le tirage ; la colonne du score
  direct n'apparaît que s'il a servi (guide v1.2 §9.1).
- **Rien d'autre ne bouge** : `DEFAULT_SEEDING_PLAN`, `SQUAD_SEEDING_PLAN` et
  `ABSOLUT_SEEDING_PLAN` sont inchangés, et `SeedingOutcome.echanges` vaut `[]` pour eux.

## Release v0.28.0 : les personnes seules au planning

Une catégorie à un seul inscrit n'a aucun combat, et les deux calculs du planning l'écartent.
Elle doit pourtant **figurer au planning**, sans occuper de place sur un tatami ni décaler
les heures de fin, à un horaire proche des catégories de poids du même âge et de la même
ceinture, pour que les inscriptions de l'absolut correspondant puissent se clore à temps
(demande du 21/09/2026). Elle s'y signale par un astérisque, comme sur le planning de l'IBJJF.

| Ce qui s'ajoute                                     | Rôle                                                                        |
| --------------------------------------------------- | --------------------------------------------------------------------------- |
| `referencesDesPersonnesSeules` (`personnes-seules`) | la catégorie de référence de chaque personne seule, dont elle prend l'heure |
| `ecartAvecLaReference`                              | l'écart comparé : discipline, âge, ceinture, genre, poids, puis la suivante |
| `estPersonneSeule`                                  | une catégorie à un seul inscrit qui n'est pas un absolut (lui est annulé)   |
| `MARQUE_PERSONNE_SEULE`                             | l'astérisque, le même sur tous les écrans                                   |

- **Le planning n'est pas recalculé.** Le noyau ne donne pas d'heure : il désigne la
  référence, et chaque écran lui prend son heure de début dans ses propres données (heure
  prévue, heure estimée, ce que le poste a le droit de voir).
- **Même âge et même ceinture d'abord**, le même genre de préférence, puis le poids le plus
  proche ; à écart égal, la catégorie suivante dans l'ordre sportif. Sans aucune catégorie
  de même âge et de même ceinture, la tranche et la ceinture les plus proches.
- **Ni un absolut, ni une autre personne seule, ni une catégorie sans combat** ne servent de
  référence. Sans référence possible, la personne seule n'a pas d'horaire.

## Release v0.29.0 : la convention d'affichage des noms

Tous les noms de famille en capitales, tous les prénoms avec une capitale initiale et le reste
en minuscules (demande du 21/09/2026). La plateforme appliquait déjà cette règle avec son
propre module ; le module du jour J ne l'appliquait pas. Elle vit désormais ici, une seule
fois, pour les deux applications.

| Ce qui s'ajoute (`person-name`) | Rôle                                                                       |
| ------------------------------- | -------------------------------------------------------------------------- |
| `formatLastName`                | le nom de famille tout en capitales, accents compris                       |
| `formatFirstName`               | une capitale initiale sur chaque membre d'un prénom composé                |
| `formatPersonName`              | « Prénom NOM », ou « NOM Prénom » pour une liste triée par nom             |
| `formatStoredFullName`          | un nom complet stocké d'un seul tenant, premier mot lu comme prénom        |
| `EXEMPLES_DE_NOMS`              | la liste sur laquelle la plateforme vérifie la parité de ses fonctions SQL |

- **Affichage seulement.** La saisie d'origine reste en base ; chaque écran, export ou lecture
  publique applique la règle au moment de nommer quelqu'un.
- **Les membres d'un prénom composé** sont séparés par un tiret, un blanc ou une apostrophe,
  droite ou typographique : « jean-pierre » donne « Jean-Pierre », « n’golo » donne « N’Golo ».
- **Même comportement que le module que la plateforme utilisait**, à une exception près :
  l'apostrophe typographique sépare désormais les membres d'un prénom, comme l'apostrophe droite.

## Release v0.30.0 : la double blessure dans un tableau de trois

Question du client du 21/09/2026 : dans un tableau de trois, les deux combattants de la 2e
demi-finale se blessent à égalité parfaite. `trois.demie.blessure` demandait au Responsable une
« suite retenue », et aucun choix ne donnait le podium du règlement : « personne » laissait les
deux blessés sans médaille, un nom envoyait un blessé en finale.

| Règle                   | Avant                   | Maintenant                                         |
| ----------------------- | ----------------------- | -------------------------------------------------- |
| `trois.demie.blessure`  | décision du Responsable | automatique (General Competition Guidelines 2.4.1) |
| `trois.finale.blessure` | décision du Responsable | tirage au sort (règles d'arbitrage art. 2)         |

- **L'une ou l'autre demi-finale** : aucun des deux blessés ne va en finale, ils sont 3es.
  L'athlète restant passe la suite sans adversaire et il est champion : le vainqueur de la 1re
  demi-finale si l'accident survient en 2e, le 3e combattant s'il survient en 1re. La 2e place
  reste vacante, avec le motif `blessure` (« 2e place vacante (blessure des deux combattants) »).
- **Finale** : tirage au sort fait devant les athlètes, comme pour les finales des autres
  formats. Le perdant du tirage est 2e, le perdant de la 2e demi-finale 3e.
- **La cascade ne change pas** : une fin sans vainqueur dont la règle n'attend aucun arbitrage
  rend déjà impossible l'emplacement qu'elle devait remplir.
- **`MotifVacance` gagne la valeur `blessure`.** La plateforme doit l'accepter
  (`jour_j_places_valides`) avant qu'un consommateur confirme un podium qui la porte. Le second
  exemplaire de la table (`jour_j_fin_sans_vainqueur_arbitrage`) change dans la même PR que
  l'épingle : la sonde de parité de `db:validate` compare les deux.

## Release v0.31.0 : deux coéquipiers d'un absolut ne se rencontrent qu'en finale

Un absolut compte au plus deux inscrits par entité (l'équipe de la saison, le club à défaut :
l'appelant la passe dans `clubId`). Jusqu'ici, rien ne les empêchait d'être dans la même moitié
du tableau : placées par rang, la séparation ne regardait que le premier tour ; placées par
médaille, elle s'arrêtait au quart de tableau, qui n'est une moitié que dans un tableau de huit.
Deux coéquipières se retrouvaient donc en demi-finale (recette du 21/09/2026 : #1 et #5
d'INFINITY, venues de deux clubs, dans un absolut de six).

| Ce qui change                      | Rôle                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------ |
| contrainte `meme-club-meme-moitie` | ajoutée aux deux plans de l'absolut, au dernier palier : l'entité par moitié         |
| `reparation: "rang-voisin"`        | après le premier tour, une seconde passe sépare les moitiés quand le plan le demande |

- **Au dernier palier.** Éviter au premier tour une revanche de catégorie source, puis une
  rencontre entre coéquipiers, passe avant : un échange qui sépare les moitiés n'est retenu que
  s'il améliore le score du plan, palier par palier, donc sans jamais ajouter une rencontre
  interdite au premier tour. Quand une revanche y est inévitable (quatre inscrits sur six venus
  de la même catégorie, deux exemptés), elle reste, et la séparation des moitiés se fait autour.
- **Placement par rang : au rang voisin, et un exempté garde son exemption.** La moins bien
  classée des deux change de moitié avec l'athlète de rang le plus proche dans l'autre moitié
  (un exempté avec un exempté, un combattant avec un combattant) ; à défaut, son combat entier
  change de moitié avec le combat voisin ; à défaut, la mieux classée des deux tente les mêmes
  gestes. #1 et #2 restent dans deux moitiés, et aucune exemption ne change de main.
- **Ce qui reste impossible reste en place** : deux coéquipiers qui se rencontrent au premier tour
  parce que tous les autres inscrits sont exemptés, le tableau de trois, ou une séparation qui
  créerait une revanche de catégorie source au premier tour. Mesuré en placement par rang sur
  4 200 tableaux de 4 à 24 inscrits avec une ou deux paires : 0,7 % gardent une paire dans la
  même moitié.
- **Placement par médaille** : la réparation libre tient la nouvelle contrainte comme les autres.
  Deux coéquipiers de catégories différentes finissent toujours dans deux moitiés.
- **Rien d'autre ne bouge** : les plans des catégories de poids (`DEFAULT_SEEDING_PLAN`,
  `SQUAD_SEEDING_PLAN`, `RANG_SPORTIF_SEEDING_PLAN`) n'ont pas de contrainte de moitié active,
  et leur tableau est inchangé.

## Release v0.32.0 : quatre demi-finalistes disqualifiés, un quart de finale exempté

Recette du 21/09/2026, absolut « Bleue - Adulte - Homme » à sept inscrits : les deux
demi-finales finissent en double disqualification technique. L'article 2.4.1 des General
Competition Guidelines (IBJJF 6.1) demande des demi-finales supplémentaires entre les athlètes
battus en quart de finale par les quatre disqualifiés. L'un d'eux était exempté de quart : il n'a
battu personne. `athletesDesignes` rend `null` pour ce quart, et un désigné manquant faisait
basculer la règle en « classement » (« L'athlète que la règle désigne est indisponible ») : le
Responsable devait saisir le podium à la main.

| Cas                                                       | Avant            | Maintenant                                                     |
| --------------------------------------------------------- | ---------------- | -------------------------------------------------------------- |
| un quart exempté, l'autre quart du même côté disputé      | classement saisi | le seul perdant de quart de ce côté va directement en finale   |
| un quart exempté de chaque côté                           | classement saisi | finale directe entre les deux perdants de quart                |
| aucun quart disputé d'un côté (tableau de quatre, de six) | classement saisi | classement saisi, libellé `LIBELLE_COTE_SANS_PERDANT_DE_QUART` |
| perdant de quart indisponible (absent, disciplinaire)     | classement saisi | inchangé                                                       |

- **Un quart exempté ne désigne personne** (`quartDispute`) : ce n'est ni un désigné manquant ni
  un désigné indisponible. Chaque côté du tableau doit garder au moins un quart disputé, sinon la
  finale n'a pas de candidat de ce côté et le Responsable saisit le classement.
- **Pas de combat à un seul athlète.** `proposerCombatsSupplementaires` ne propose une demi-finale
  supplémentaire que pour un côté qui a deux perdants de quart ; l'athlète seul de son côté est
  placé d'emblée dans la finale (division 1 index 1, côté A pour la 1re moitié, B pour la 2e).
  Les libellés et les conséquences suivent : « Demi-finale supplémentaire », « Finale entre le
  vainqueur de la demi-finale supplémentaire et le seul perdant de quart de l'autre côté du
  tableau », « Finale entre les seuls perdants de quart de chaque côté du tableau ».
- **Le podium ne change pas** : les quatre disqualifiés techniques sont 3es, le perdant d'une
  demi-finale supplémentaire n'a pas de médaille (en disciplinaire, il est 3e). La finale se joue
  comme toute finale hors grille.

La table a son exemplaire SQL : la plateforme réémet `jour_j_fin_sans_vainqueur_arbitrage` et
`day_arbitrage_combats_creer` (les combats attendus) dans la PR qui épingle cette version, sous la
sonde de parité de `db:validate` (deux scénarios à sept inscrits, un à huit inscrits dont un quart
exempté de chaque côté, un à six inscrits dont un côté sans quart).

## Release v0.33.0 : les combats d'arbitrage ont leur nom et leur ordre

Une finale rejouée porte la division de la finale, une demi-finale supplémentaire celle des
demi-finales. `nomDuTour` ne lisant que la division, elle les nommait « Finale » et
« Demi-finale », mot pour mot comme les combats qu'elles remplacent : deux « Finale » dans une
catégorie, et plus rien ne disait laquelle avait été jouée. Le client l'a signalé le 22/09/2026,
capture à l'appui, avec un second grief : dans la section « Combats d'arbitrage » de l'écran des
tableaux, la nouvelle finale se dessinait ENTRE les deux nouvelles demi-finales qui la nourrissent
(« combat n° 18, combat n° 20, combat n° 19 »).

| Ce qui change                     | Rôle                                                                  |
| --------------------------------- | --------------------------------------------------------------------- |
| `EntreeNomDuTour.indexInDivision` | OPTIONNEL : sans lui, le tour se nomme exactement comme avant         |
| « Nouvelle finale » / `NF`        | division 1, index 1 et au-delà                                        |
| « Nouvelle demi-finale » / `NDF`  | division 2, index 2 et au-delà ; colonne « Nouvelles demi-finales »   |
| `estHorsGrille`                   | descendue d'`arbitrage.ts`, qui la réexporte : aucun import à changer |
| `comparerHorsGrille(indexDe)`     | division décroissante puis index, soit l'ordre de passage             |

- **L'index est optionnel, et c'est ce qui rend le lot sûr.** Un appelant qui nomme une COLONNE
  ne le passe pas (une colonne n'a pas d'index) et rend le nom d'avant ; un appelant qui l'oublie
  aussi. Les deux consommateurs le passent surface par surface, sans big bang. Le balayage de
  vrais tirages de 2 à 64 inscrits vérifie qu'aucune coordonnée produite par le générateur ne
  bascule dans la nouvelle branche.
- **`estHorsGrille` change de maison, pas de règle.** Elle descend dans `round-names.ts` parce que
  c'est la nomenclature qui doit la lire : la laisser dans `arbitrage.ts` aurait fait entrer tout
  le règlement des fins sans vainqueur dans les écrans qui ne nomment qu'un tour.
- **Un test d'appartenance écrit à la main est supprimé, et il avait divergé.** `libelleManquant`
  (`podium-officiel.ts`) testait `f.division <= 2 && (… || f.indexInDivision >= 2)`, sans les deux
  bornes que pose `estHorsGrille` : le type, et la division basse. Le 3e combat d'une POULE
  (division 0, index 2) y tombait, et le Responsable lisait « Combats d'arbitrage non terminés »
  sur une catégorie qui n'a jamais eu d'arbitrage. Défaut antérieur à cette version : il devient
  corrigeable parce que `estHorsGrille` est désormais importable sans faire entrer tout le
  règlement des fins sans vainqueur.
- **L'ordre ne dépend d'aucun numéro d'appel.** `comparerHorsGrille` reprend la règle que
  `arbitragesEnAttente` écrivait déjà ici, et `day_arbitrage_combats_creer` côté plateforme :
  elle vaut donc aussi pour l'arbre public et la feuille imprimée, qui ne lisent pas la file d'un
  tapis. ⚠ Un rang affiché ne se déduit jamais de l'index brut : une demi-finale supplémentaire
  seule peut porter l'index 3 sans qu'il existe d'index 2 (cf. v0.32.0).

Aucun changement de schéma : les deux consommateurs n'ont qu'à épingler le tag.

## Release v0.34.0 : le générateur de planning suit l'ordre des ceintures, la hiérarchie des tatamis, et répartit sur 1 à 8 tatamis

Réponses du client du 25/09/2026 au questionnaire du générateur de planning ; l'identifiant de
chaque décision est donné entre parenthèses. Le noyau pose les règles, la plateforme les branche
dans sa propre PR.

| Module                            | Ce qu'il apporte                                                                   |
| --------------------------------- | ---------------------------------------------------------------------------------- |
| `src/priorite-de-planning.ts`     | `trierPourLeDepart` et sa clé ; `rangTatamiPrioritaire`, la liste du §8            |
| `src/hierarchie-tatamis.ts`       | `rangsDeQualiteParDefaut` : les tatamis par paires depuis les deux bouts           |
| `src/affectation-par-liste.ts`    | `affecterParListe` : un tatami libéré prend la catégorie suivante de la file       |
| `src/scenario-journees.ts`        | `repartirParScenario` : « ibjjf » (par défaut) ou « gi-samedi »                    |
| `src/repartition-tatamis.ts`      | 1 à 8 tatamis par catégorie, tableau coupé par morceaux entiers                    |
| `src/ordonnanceur-planning.ts`    | rotation de 2 minutes, combat suivant du tour qui passe devant, repos de confort   |
| `src/controles-de-planning.ts`    | `repos_insuffisant` bloque la publication                                          |
| `src/objectifs-du-planning.ts`    | `evaluerLaJournee`, `comparerLesPlans` : l'ordre du §18 et la marge de 5 minutes   |
| `src/convergence-des-branches.ts` | derniers tours sur le tatami de la finale, fins de branches rapprochées            |
| `src/continuite-des-tatamis.ts`   | `controlerLaContinuite` : un combat hors de sa branche, une finale sans ses demies |

### L'ordre de départ

`cleDeDepart` compare, dans cet ordre (le plus petit part le premier) :

1. les Kids d'abord (JRS.4 A ; « les Kids passent toujours en premier sur une compétition ») ;
2. le Gi puis le No-Gi : Kids Gi, Kids No-Gi, puis Gi, puis No-Gi (SEP.4 A, JRS.4 A) ;
3. chez les Kids, l'âge, U7 d'abord (ORD.6 B) ; ailleurs, les juvéniles avant les adultes et
   les Masters (ORD.5 C) ;
4. hors Kids, la vague de ceinture : bleues et noires (corail et rouge comprises), puis violettes
   et marrons, puis blanches (ORD.1 A). Les Masters passent dans la vague de leur ceinture, comme
   les adultes (ORD.4 A) ;
5. les noires adultes en tête de leur vague ;
6. la plus longue durée prévue, nombre de combats multiplié par le créneau (ORD.7 B) ;
7. le poids, du plus léger au plus lourd (ORD.11 B).

Le sexe n'entre pas dans la clé ; l'identifiant départage. `rangSportifDeCategorie` reste l'ordre
d'affichage.

### Qui prend les meilleurs tatamis

`rangTatamiPrioritaire` rend le rang de la liste du §8 : noire, marron, violette puis bleue
adultes (1 à 4), les mêmes en Masters (5 à 8), blanche adulte (9), blanche Master (10), juvéniles
(11), Kids (12) ; corail et rouge comptent comme la noire. `rangsDeQualiteParDefaut` classe les
tatamis par paires (ORD.2 A) : sur 8, 1 et 8 ont le rang 1, puis 2 et 7, 3 et 6, 4 et 5 ; avec un
nombre impair, le tatami central est seul au dernier rang.

`affecterParListe` suit la file de `trierPourLeDepart` sans jamais la doubler (ORD.8 A). À
l'heure où des tatamis se libèrent, les catégories de tête qui y tiennent ensemble forment un lot,
et la liste du §8 lui répartit les meilleurs tatamis (ORD.1 A). Sur 6 tatamis à 9 h, deux noires
adultes et quatre bleues : les noires prennent les tatamis 1 et 6, les bleues 2, 5, 3 et 4 ; le
premier tatami libéré prend la violette qui suit. Une catégorie répartie qui demande plus de
tatamis qu'il n'y en a de libres prend ceux qui se libèrent le plus tôt, et commence quand le
dernier d'entre eux se libère : une catégorie suivante ne la double pas.

### Les scénarios de journées

| Scénario                    | Premier jour                                  | Second jour              |
| --------------------------- | --------------------------------------------- | ------------------------ |
| `ibjjf` (défaut)            | Gi de couleur hors Kids, juvéniles et Masters | Kids, blanches Gi, No-Gi |
| `ibjjf`, sans Gi de couleur | ceintures de couleur hors Kids (No-Gi seule…) | blanches et Kids         |
| `gi-samedi`                 | tout le Gi hors Kids, blanches comprises      | Kids et No-Gi            |

JRS.8 B, JRS.2 A. Une compétition sans aucune ceinture de couleur hors Kids (Kids seuls) reste
entière le premier jour ; une compétition d'un jour aussi. Rien n'est reporté d'une journée pleine
vers l'autre (JRS.7 A) : le dépassement se signale, et la CFJJB déplace des catégories.

### La répartition sur 1 à 8 tatamis

`NOMBRES_DE_TATAMIS_ADMIS` vaut 1 à 8 (REP.1 A) et ne suit plus `TAPIS_ADMIS_ABSOLUT`, qui reste
à 1, 2, 4 ou 8 tant que la génération d'un absolut en SQL n'est pas alignée.
`plafondDeRepartition` rend le nombre de tatamis de la compétition, huit au plus ; les seuils de
`proposerLaRepartition` ne changent pas.

`partiesDuCombat` coupe le tableau par morceaux entiers (REP.4 A) : `2^k` unités, `2^k` étant la
plus petite puissance de deux qui atteint le nombre de parties, et les dernières unités réunies
deux à deux.

| Parties | Découpage                      |
| ------- | ------------------------------ |
| 3       | un quart, un quart, une moitié |
| 5       | deux huitièmes, trois quarts   |
| 6       | quatre huitièmes, deux quarts  |
| 7       | six huitièmes, un quart        |

Un combat qui ne couvre qu'une partie reste sur son tatami, sans convergence : chaque branche
reste intacte jusqu'à son regroupement. Le tatami qui reçoit la moitié a deux fois plus de
combats ; il finit plus tard et peut lever l'avertissement de déséquilibre. À 1, 2, 4 et 8
parties, le découpage est celui d'avant, combat par combat.

### L'ordonnanceur

- **Rotation de 2 minutes par défaut** (DUR.1 A). `DEFAULT_BUFFER_SECONDS` passe de 60 à 120
  secondes et `ESPACEMENT_PAR_DEFAUT_SECONDES` en est l'alias : ordonnanceur, enchaînement des
  compétitions, capacité, dimensionnement et planning par catégorie lisent la même constante.
- **Le combat suivant du même tour passe devant** (ORD.10 B), seulement quand aucune catégorie
  du tatami ne peut commencer à l'heure où il se libère, et seulement pour un combat prêt à cette
  heure-là. Les files sont lues dans l'ordre du planning, puis les combats dans l'ordre du
  tableau ; deux tours ne se mélangent jamais. Un combat qui devrait lui-même attendre ne passe
  pas : le tatami attend alors le combat de tête prêt le plus tôt.
- **Repos de confort** (RPS.4 A) : `reposDeConfort` vise deux durées de combat avant tout combat,
  au lieu d'une hors finale. Le noyau ne compare rien : la plateforme ne garde le confort que s'il
  ne retarde aucune fin de journée (RPS.5 A).

Ce que change ORD.10 B, en combats de 5 minutes séparés de 60 secondes :

| Cas                                                               | v0.24.0 à v0.33.0                             | v0.34.0                                                     |
| ----------------------------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------- |
| Tableau de 5 inscrits seul sur son tatami, 1er tour à 09:00       | 1re demi-finale 09:10, 2e 09:16, finale 09:31 | 2e demi-finale 09:06, 1re 09:12, finale 09:27               |
| Le même, suivi sur le tatami d'une catégorie de 4 inscrits        | l'autre catégorie passe à 09:06 et 09:24      | inchangé : une autre catégorie prête passe toujours d'abord |
| Tableaux de 9, 17 et 33 inscrits seuls sur leur tatami            | finales à 09:55, 10:43 et 12:19               | finales à 09:51, 10:39 et 12:15                             |
| Gi finie à 13:59, athlète commun au 1er combat d'un tableau de 16 | combat 1 à 14:04, finale 15:37                | combat 2 à 14:00, combat 1 à 14:06, finale 15:33            |

Sur deux compétitions **parallèles**, la catégorie de l'athlète commun commence désormais sans
lui : sa convocation chevauche l'autre compétition, et la double convocation bloque la
publication, en plus du chevauchement déjà signalé.

### Les contrôles

`repos_insuffisant` passe de l'avertissement au bloquant (RPS.3 B) : une retouche qui place un
combat pendant le repos réglementaire d'un athlète est acceptée dans le brouillon, mais le
planning ne se publie pas tant qu'elle n'est pas corrigée, comme une double convocation.

### Choisir entre deux plans, et la continuité des tatamis

`comparerLesPlans` départage deux plans d'une journée selon l'ordre des objectifs du §18. Une fin
plus précoce d'au moins `MARGE_ENTRE_PLANS_MINUTES` (5) l'emporte. En deçà, les objectifs suivants
départagent, dans l'ordre (ORD.9 B). `retoucheSansRetard` dit si un changement ne fait pas reculer
la fin de la journée.

`regrouperLesDerniersTours` place les demi-finales, puis les quarts, sur le tatami de la finale,
seulement si la journée ne finit pas plus tard (REP.5 C). `debutsPourRapprocherLesBranches`
rapproche les fins des branches d'une catégorie répartie, aux mêmes conditions (REP.6 A).

`controlerLaContinuite` signale deux cas, par un avertissement jamais bloquant : un combat placé
hors de sa branche, et la finale d'une catégorie répartie posée sur un tatami qui n'a joué aucune
de ses demi-finales (§12.1, §12.5).

Le contrôle `desequilibre_de_tatami` signale désormais un tatami qui finit plus d'une heure avant
ou après la moyenne des autres.

### Pour les consommateurs

- Une compétition sans espacement réglé passe de 60 à 120 secondes : toutes les heures générées
  changent. Le repli SQL de l'estimation du jour J (`jour_j_espacement_effectif`) doit suivre.
- Une catégorie ne peut être enregistrée sur 3, 5, 6 ou 7 tatamis qu'une fois levée la contrainte
  de cardinalité 1, 2, 4 ou 8 côté base.
- Une confirmation déjà donnée à un `repos_insuffisant` reste enregistrée mais ne lève plus rien :
  le constat passe dans `bloquants`, et seul un planning corrigé le fait disparaître.

## Release v0.35.0 : les coéquipiers ne se rencontrent qu'en finale, en placement par rang

Guide de génération des tableaux v1.3, §4 à §7. La règle impérative : « À partir de quatre
combattants, deux athlètes auxquels la même équipe a été attribuée doivent être placés dans des
moitiés opposées. Ils ne doivent pouvoir se rencontrer qu'en finale. » Jusqu'ici, le placement
par rang ne séparait les coéquipiers d'une catégorie qu'au premier tour, et ses tours blancs ne
changeaient jamais de main : ni le format à trois, ni l'exception à cinq du guide n'étaient
possibles (mesure du 26/09/2026, 4 à 32 inscrits : 2 499 paires sur 5 452 restaient dans une même
moitié). En absolut, la revanche de catégorie source passait avant l'équipe.

| Ce qui change                                                                  | Rôle                                                                                                                                         |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `RANG_SPORTIF_SEEDING_PLAN`                                                    | `meme-equipe-meme-moitie` : l'équipe par moitié, palier 1, après le premier tour                                                             |
| `reparation: "rang-voisin"`                                                    | un seul tour blanc réattribué par catégorie ; l'équipe au premier tour, puis les moitiés, puis la revanche ; repli exact jusqu'à 17 inscrits |
| `ABSOLUT_SEEDING_PLAN`, `ABSOLUT_RANG_SPORTIF_SEEDING_PLAN`                    | l'équipe au premier tour (0), par moitié (1), l'anti-club au quart (2, sans rang), la revanche de catégorie source en dernier (3)            |
| `verifierSeparationDEquipe(…, { parRang })`, `verifierSeparationAvantLaFinale` | `avantLaFinale` : les paires d'une entité dans une même moitié (à trois, la 1re demi-finale), et combien aucun placement ne peut éviter      |

- **Un seul tour blanc change de main** (§4 : « Il protège d'abord #1, puis #2, puis les rangs
  suivants »). Quand aucun échange entre combats pleins ne sépare deux coéquipiers, le mieux
  classé des deux prend le tour blanc du moins bien classé des exemptés qui peut le céder. À
  cinq, #4 et #5 coéquipiers : tours blancs #1, #2 et #4, combat #3/#5. À cinq, #1 et #4 d'une
  équipe, #2 et #5 d'une autre : le même tableau, les deux paires séparées. À partir de quatre,
  #1 et #2 gardent toujours le leur ; le compteur est commun au premier tour et aux moitiés.
- **Le tableau de trois** (§6) : #2 et #3 coéquipiers, la 1re demi-finale devient #1 contre #3
  et #2 attend la deuxième ; #1 coéquipier de #2 ou de #3, le format normal est conservé. Les
  moitiés ne sont réparées qu'à partir de quatre inscrits.
- **À écart de rang égal, l'échange qui sépare aussi les moitiés** : #3 et #6 coéquipiers sur
  huit, #6 échange avec #5 plutôt qu'avec #7, qui le laisserait dans la moitié de #3. Un seul
  échange au lieu de deux, comme l'exemple du guide (§5 : #16 avec #15).
- **L'équipe avant la revanche, phase par phase** (§7) : l'équipe au premier tour, puis l'équipe
  par moitié, jugée sans la revanche, puis seulement la revanche de catégorie source. Un échange
  du premier tour n'est refusé que par un conflit au moins aussi important que celui qu'il
  répare ; un échange pour la revanche n'est retenu que s'il ne dégrade aucune séparation
  d'équipe, et la revanche ne déplace jamais un tour blanc (« si elle ne pénalise aucun mieux
  classé et respecte toutes les séparations impératives »). #1 et #4 coéquipiers, #3 venu de la
  catégorie de #1 : le premier tour devient #1/#3 et #2/#4. Un tirage d'absolut est déterministe
  (sa graine est l'identifiant de la catégorie) : annuler puis refaire le tableau ne changerait
  rien.
- **Le repli exact des petites catégories** (au plus 17 inscrits) : la réparation au rang voisin
  est une recherche locale, un échange à la fois. Quand elle laisse une paire séparable dans une
  même moitié, réattribue un tour blanc qu'un autre placement aurait gardé, ou le prend à un
  mieux classé que nécessaire, toutes les répartitions entre les moitiés sont énumérées (#1 et #2
  opposés, dans chaque moitié les tours blancs aux mieux classés présents, au plus un réattribué,
  jamais celui de #1 ni de #2) et la meilleure la remplace : le moins de paires réunies, puis le
  moins de tours blancs réattribués, puis le tour blanc cédé par le moins bien classé possible,
  puis le moins d'athlètes changés de moitié. Les positions vides restent celles du placement
  standard ; si #1 finit dans la moitié du bas, les deux moitiés se retournent d'un bloc, sans
  qu'aucune rencontre change. Moins de 70 ms à 16 inscrits, mesuré sur une machine chargée ; au-delà de 17, la recherche locale
  seule.
- **Mesuré par recherche exhaustive** (verrou `tests/separation-des-coequipiers.test.ts`) :
  12 248 configurations (une paire de 4 à 17 inscrits, deux jusqu'à 12, trois de 6 à 9, quatre
  de 8 à 10), au plan des catégories comme à celui de l'absolut. Chaque tableau atteint le
  meilleur que le guide permette : aucune paire séparable laissée ensemble (le prototype du
  26/09 en laissait 24), aucun tour blanc réattribué sans nécessité, le tour blanc cédé par le
  moins bien classé possible, jamais deux tours blancs réattribués, #1 et #2 toujours opposés et
  exemptés. En absolut, avec des catégories sources qui se croisent, la revanche ne change ni un
  tour blanc ni la séparation d'équipe. Ce qui reste est impossible sous ces règles (par exemple
  sept inscrits, trois paires parmi #2 à #7 : #1 perdrait son tour blanc).
- **Le rang affiché ne change pas** : un échange déplace une position, jamais un rang (§2, §5).
- **Le contrôle** : en placement par rang, une paire n'est « inévitable » qu'après une recherche
  exhaustive des moitiés conformes (au plus 17 inscrits) ; au-delà, et sans rang, seul l'effectif
  l'impose (k athlètes d'une entité en réunissent au moins C(⌈k/2⌉, 2) + C(⌊k/2⌋, 2)).

### Pour les consommateurs

- `BracketResult.echanges` peut porter la réattribution d'un tour blanc : au premier tour,
  `deplace` est le coéquipier qui prend le tour blanc et `avec` l'exempté qui le cède. Après le
  repli exact, `echanges` est la suite d'échanges qui mène du placement standard au tableau
  retenu, chacun au nom de la contrainte de moitié.
- `VerdictSeparation.avantLaFinale` est toujours présent ; `rencontres` et `surchargees` sont
  inchangés.
- Rien ne change sans placement par rang pour les catégories : `DEFAULT_SEEDING_PLAN` et
  `SQUAD_SEEDING_PLAN` sont inchangés. L'absolut placé par médaille suit le nouvel ordre des
  paliers.
- Limites connues de `echanges`, inchangées depuis v0.31.0 : quand un combat entier change de
  moitié avec un combat exempté, seul l'athlète du combat plein est nommé ; deux échanges
  successifs peuvent nommer le même couple. `echanges` dit ce que la réparation a fait, pas le
  plus court chemin.

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

/**
 * @cfjjb/domain — le noyau métier partagé de la CFJJB.
 *
 * TypeScript PUR : aucune IO, aucun React, aucun client Supabase, aucune
 * dépendance de production. Trois consommateurs, un seul exemplaire du code :
 *
 * - `cfjjb-platform`   — la plateforme fédération / club / licencié ;
 * - `cfjjb-competition-day` — la PWA des postes du jour J ;
 * - le package lui-même, où vivent les tests de parité.
 *
 * POURQUOI CE PACKAGE EXISTE. Le référentiel des poids et des durées de combat
 * était recopié à l'identique dans deux dépôts, avec en tête un commentaire
 * demandant de « garder les deux côtés synchrones » à la main. Deux listes de
 * grades finissent toujours par diverger, et la divergence est muette : un
 * planning trie les catégories dans un ordre, l'éligibilité dans un autre.
 *
 * Le jour J étant reconstruit dans son propre dépôt, la propagation d'un
 * bracket doit tourner à l'identique dans le navigateur (hors ligne) et sur le
 * serveur. C'est ici, et seulement ici, que cette identité peut être PROUVÉE :
 * les deux passes sont deux simulations d'un même test pur.
 */

export * from "./enums";
export * from "./belts";
export * from "./referential";
export * from "./bracket-generator";
export * from "./planning-generator";
export * from "./medals";
export * from "./bracket-propagation";
export * from "./control-state";
export * from "./capabilities";

import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["node_modules/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      // Même convention que `cfjjb-platform` : le préfixe `_` marque un liant
      // délibérément ignoré. Utile notamment pour écarter une clé par
      // déstructuration (`const { fightId: _id, ...reste } = patch`), qui est la
      // façon la plus lisible de retirer un champ d'un objet.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      // Ce package est le NOYAU MÉTIER : il doit rester pur. Ces trois interdits
      // sont la frontière, et elle est vérifiée par la CI plutôt que par la
      // vigilance : la valeur du package tient entièrement au fait que le même
      // code tourne dans un navigateur hors ligne et sur un serveur.
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "node:*",
                "fs",
                "path",
                "crypto",
                "react",
                "react-dom",
                "@supabase/*",
                "next*",
              ],
              message:
                "@cfjjb/domain est pur : aucune IO, aucun React, aucun client Supabase. Le code qui en a besoin appartient à l'application qui consomme ce package.",
            },
          ],
        },
      ],
      // `Math.random()` était PROSCRIT par trois commentaires (prng.ts,
      // pool-generator.ts, pool-ranking.ts) et par AUCUNE vérification. Une
      // passe de mutation l'a glissé dans la composition des équipes A/B/C : ni
      // le lint, ni les types, ni la CI n'ont bronché - seul un test l'a vu, et
      // seulement dans ce module-là. Un tirage non rejouable est indéfendable
      // devant le club qui le conteste ; l'interdit vit donc là où il est
      // vérifié, pas là où il est écrit.
      "no-restricted-properties": [
        "error",
        {
          object: "Math",
          property: "random",
          message:
            "Tirage non rejouable : passer par `src/prng.ts` (fnv1a + mulberry32), le seul mélange dont on puisse dire « voici la graine, rejouez ».",
        },
      ],
      "no-restricted-globals": [
        "error",
        {
          name: "fetch",
          message: "@cfjjb/domain est pur : pas de réseau.",
        },
        {
          name: "localStorage",
          message: "@cfjjb/domain est pur : pas de stockage.",
        },
      ],
    },
  },
);

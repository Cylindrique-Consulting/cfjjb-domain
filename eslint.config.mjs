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

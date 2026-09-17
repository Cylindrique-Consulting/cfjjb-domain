import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["node_modules/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
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

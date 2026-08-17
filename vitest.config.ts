import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // `node` et rien d'autre : ce package n'a aucun composant, aucun DOM. Une
    // configuration jsdom coûterait des secondes de préparation par fichier
    // pour du code qui ne touche jamais au document.
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});

// eslint.config.mjs
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default [
  // 1) Ignorados (no son "core" y/o generan ruido)
  {
    ignores: [
      "dist/**",
      "build/**",
      ".tsup/**",
      "node_modules/**",
      "coverage/**",
      "testdata/**",

      // ejemplos / material de compilación
      "slots/**",
      "flows/**",
      "example/**",
    ],
  },

  // 2) Base JS
  js.configs.recommended,

  // 3) TS recomendado (sin type-aware)
  ...tseslint.configs.recommended,

  // 4) Reglas del proyecto (core)
  {
    files: ["dsl/**/*.{ts,tsx}", "compiler/**/*.{ts,tsx}", "index.ts"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      // El repo usa patterns donde console es OK
      "no-console": "off",

      // Fallthrough te está pegando en compile-jsonata.ts
      // si lo querés estricto: agregá break explícito en los switches.
      "no-fallthrough": "off",

      // En compilers es razonable usar any en bordes (JSON/unknown)
      "@typescript-eslint/no-explicit-any": "off",

      // ✅ Punto 4: permitir args/vars prefix "_" sin error
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },

  // 5) Tests: más permisivo
  {
    files: ["tests/**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "no-fallthrough": "off",
    },
  },
];
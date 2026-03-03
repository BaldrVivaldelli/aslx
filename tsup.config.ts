import { defineConfig } from "tsup";

export default defineConfig([
  // Library (puede quedar como la tengas)
  {
    entry: ["index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    clean: true,
    outDir: "dist",
    target: "node20",
    platform: "node",
    bundle: false,
    splitting: false,
    outExtension({ format }) {
      return format === "cjs" ? { js: ".cjs" } : { js: ".js" };
    },
  },

  // CLI (FIX)
  {
    entry: {
      aslx: "compiler/aslx.ts",
      "compile-jsonata": "compiler/compile-jsonata.ts",
      "build-machine": "compiler/build-machine.ts",
      "validate-machine": "compiler/validate-machine.ts",
      "build-yml": "compiler/build-yml.ts",
    },
    format: ["cjs"],
    dts: false,
    sourcemap: false,
    clean: false,
    outDir: "dist/cli",
    target: "node20",
    platform: "node",

    bundle: true,        // ✅ mete module-graph adentro
    splitting: false,    // ✅ evita chunks faltantes como ./module-graph
    treeshake: false,

    // externalizá solo deps externas / pesadas (no tu código)
    external: [
      /^node:.+$/,
      /^typescript(\/.*)?$/,
      "@swc/core",
      "tsx",
      "yaml",
    ],

    outExtension() {
      return { js: ".cjs" };
    },
  },
]);
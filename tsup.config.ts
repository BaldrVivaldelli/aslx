import { defineConfig } from "tsup";

export default defineConfig([
  // Library
  {
    entry: ["index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    clean: true,
    outDir: "dist",
    target: "node20",
    platform: "node",
    sourcemap: false,
    splitting: false,
    treeshake: true,
    bundle: false,
    outExtension({ format }) {
      return format === "cjs" ? { js: ".cjs" } : { js: ".js" };
    },
  },

  // CLI
  {
    entry: {
      "cli/aslx": "compiler/aslx.ts",
      "cli/compile-jsonata": "compiler/compile-jsonata.ts",
      "cli/build-machine": "compiler/build-machine.ts",
      "cli/validate-machine": "compiler/validate-machine.ts",
      "cli/build-yml": "compiler/build-yml.ts",
    },
    format: ["cjs"],
    dts: false,
    clean: false,
    outDir: "dist",
    target: "node20",
    platform: "node",
    sourcemap: false,

    bundle: false, 
    splitting: false,
    treeshake: false,

    outExtension() {
      return { js: ".cjs" };
    },
  },
]);
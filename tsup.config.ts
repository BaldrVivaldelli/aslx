// tsup.config.ts
import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: true,
    outDir: "dist",
    splitting: false,
  },

  {
    entry: [
      "compiler/aslx.ts",
      "compiler/compile-jsonata.ts",
      "compiler/build-machine.ts",
      "compiler/validate-machine.ts",
      "compiler/build-yml.ts",
    ],
    format: ["esm"],
    platform: "node",
    target: "node20",
    outDir: "dist/cli",
    sourcemap: true,
    dts: false,
    clean: false,
    splitting: false,

    bundle: true,

    external: ["typescript", "tsx", "@swc/core", "yaml"],
  },
]);
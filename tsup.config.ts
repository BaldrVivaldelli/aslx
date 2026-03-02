import { defineConfig } from "tsup";

export default defineConfig({
  // Lib + CLI: todo en un bundle ESM
  entry: [
    "index.ts",
    "compiler/aslx.ts",
    "compiler/compile-jsonata.ts",
    "compiler/build-machine.ts",
    "compiler/validate-machine.ts",
    "compiler/build-yml.ts",
  ],
  format: ["esm"],
  dts: true,            // si querés, ponelo false para aún más simple
  sourcemap: false,
  clean: true,
  outDir: "dist",
  target: "node20",
  platform: "node",

  bundle: true,
  splitting: false,
  treeshake: false, 
  external: [],
  outExtension() {
    return { js: ".js" };
  },
});
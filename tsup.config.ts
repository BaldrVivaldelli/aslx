import { defineConfig } from 'tsup';

// Bundled builds avoid ESM relative-import-extension headaches and keep the
// published package small and easy to consume.
export default defineConfig([
  // Library entrypoint
  {
    entry: ['index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: false,
    clean: true,
    outDir: 'dist',
    target: 'node20',
    platform: 'node',
    splitting: true,
    treeshake: true,
    bundle: false,
    external: ['@swc/core', 'tsx', 'yaml'],
    // When `package.json#type` is "module", emitting CommonJS as `.js` would break at runtime.
    // Force `.cjs` for CJS and keep `.js` for ESM.
    outExtension({ format }) {
      return format === 'cjs' ? { js: '.cjs' } : { js: '.js' };
    },
  },

  // CLI entrypoints (ESM; package has `type: module`)
  {
    entry: {
      'cli/aslx': 'compiler/aslx.ts',
      'cli/compile-jsonata': 'compiler/compile-jsonata.ts',
      'cli/build-machine': 'compiler/build-machine.ts',
      'cli/validate-machine': 'compiler/validate-machine.ts',
      'cli/build-yml': 'compiler/build-yml.ts',
    },
    format: ['esm'],
    dts: false,
    sourcemap: false,
    bundle: false,
    clean: false,
    outDir: 'dist',
    target: 'node20',
    platform: 'node',
    splitting: true,
    treeshake: true,
    external: ['@swc/core', 'tsx', 'yaml'],
    outExtension() {
      return { js: '.js' };
    },
  },
]);

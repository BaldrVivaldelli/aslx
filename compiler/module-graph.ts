// compiler/module-graph.ts
//
// Builds a deterministic list of local TypeScript modules reachable from an entrypoint.
// This is used by the JSONata slot compiler to discover slots across imports (machines/flows/slots).
//
// Notes:
// - Uses the TypeScript module resolver (NodeNext) so it behaves like real TS projects.
// - Skips node_modules and declaration files by default.

import path from "node:path";
import fs from "node:fs";
import ts from "typescript";

export type ModuleGraph = {
  entry: string;   // absolute path
  files: string[]; // absolute paths, stable order
};

export type BuildModuleGraphOptions = {
  projectRoot?: string;
  /**
   * Include node_modules in traversal (default false).
   * Usually you only want local source files.
   */
  includeNodeModules?: boolean;
};

function defaultCompilerOptions(): ts.CompilerOptions {
  // No tsconfig.json in this repo today. Keep resolution close to how tsx/node behaves.
  return {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    resolveJsonModule: true,
    esModuleInterop: true,
    allowJs: true,
  };
}

function isProbablyNodeModule(filePath: string): boolean {
  return filePath.split(path.sep).includes("node_modules");
}

function isLocalSourceFile(filePath: string, includeNodeModules: boolean): boolean {
  const ext = path.extname(filePath).toLowerCase();
  if (![".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(ext)) return false;
  if (filePath.endsWith(".d.ts")) return false;
  if (!includeNodeModules && isProbablyNodeModule(filePath)) return false;
  return true;
}

export function buildModuleGraph(entryPath: string, options: BuildModuleGraphOptions = {}): ModuleGraph {
  const projectRoot = options.projectRoot ?? process.cwd();
  const includeNodeModules = options.includeNodeModules ?? false;

  const entryAbs = path.isAbsolute(entryPath) ? entryPath : path.resolve(projectRoot, entryPath);
  if (!fs.existsSync(entryAbs)) {
    throw new Error(`Entry file does not exist: ${entryAbs}`);
  }

  const compilerOptions = defaultCompilerOptions();

  const visited = new Set<string>();
  const ordered: string[] = [];

  function resolveModule(spec: string, fromFile: string): string | null {
    // Delegate to TS resolver. This supports extensionless imports and index.ts.
    const result = ts.resolveModuleName(spec, fromFile, compilerOptions, ts.sys);
    const resolved = result.resolvedModule?.resolvedFileName;
    if (!resolved) return null;

    // TS can resolve to .d.ts for type-only packages; skip those
    if (!isLocalSourceFile(resolved, includeNodeModules)) return null;

    // Normalize (TS sometimes returns paths with different casing on Windows).
    return path.resolve(resolved);
  }

  function collectSpecifiers(sf: ts.SourceFile): string[] {
    const specs: string[] = [];

    for (const stmt of sf.statements) {
      if (ts.isImportDeclaration(stmt)) {
        if (stmt.importClause?.isTypeOnly) continue;
        const ms = stmt.moduleSpecifier;
        if (ts.isStringLiteral(ms)) specs.push(ms.text);
        continue;
      }

      if (ts.isExportDeclaration(stmt)) {
        if (stmt.isTypeOnly) continue;
        const ms = stmt.moduleSpecifier;
        if (ms && ts.isStringLiteral(ms)) specs.push(ms.text);
        continue;
      }
    }

    return specs;
  }

  function visit(fileAbs: string): void {
    const abs = path.resolve(fileAbs);
    if (visited.has(abs)) return;

    visited.add(abs);
    ordered.push(abs);

    const sourceText = fs.readFileSync(abs, "utf8");
    const sf = ts.createSourceFile(abs, sourceText, ts.ScriptTarget.ES2022, true);

    const specs = collectSpecifiers(sf).sort();
    for (const spec of specs) {
      const resolved = resolveModule(spec, abs);
      if (!resolved) continue;
      // Keep traversal local by default; still allow JS/TS within repo.
      if (!includeNodeModules && isProbablyNodeModule(resolved)) continue;
      visit(resolved);
    }
  }

  visit(entryAbs);

  // Deterministic output order regardless of filesystem quirks:
  // - Keep DFS order for locality, but also ensure the list is unique + stable.
  // The DFS ordering is already stable due to sorted specifiers.
  return { entry: entryAbs, files: ordered };
}

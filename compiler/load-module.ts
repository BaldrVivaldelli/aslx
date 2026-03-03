// compiler/load-module.ts
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

type AnyModule = Record<string, any>;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


async function loadCliSubcommandPath(baseName: string): Promise<string> {
  const candidates = [
    path.join(__dirname, `${baseName}.js`),
    path.join(__dirname, `${baseName}.cjs`),
  ];
  const target = candidates.find(fs.existsSync);
  if (!target) throw new Error(`Cannot find subcommand ${baseName}`);
  return target;
}

export async function runCliSubcommand(baseName: string, argv: string[]): Promise<number> {
  const target = await loadCliSubcommandPath(baseName);

  const res = spawnSync(process.execPath, [target, ...argv], {
    stdio: "inherit",
    env: process.env,
  });

  return typeof res.status === "number" ? res.status : 1;
}

/** URL base donde viven los subcomandos en dist/cli */
function cliDir(): string {
  // load-module.ts termina en dist/cli/load-module.js
  return __dirname;
}

function firstExisting(paths: string[]): string | null {
  for (const p of paths) if (fs.existsSync(p)) return p;
  return null;
}

/**
 * Carga un módulo del paquete (subcomando) que vive en dist/cli.
 * - Se encarga de la extensión y de validar que exista.
 */
export async function loadCliSubcommand(baseName: string): Promise<AnyModule> {
  const dir = cliDir();

  // Opción B: emitimos ESM .js (type: module)
  // Igual dejo fallback a .cjs por compat con builds viejas.
  const candidates = [
    path.join(dir, `${baseName}.js`),
    path.join(dir, `${baseName}.cjs`),
  ];

  const target = firstExisting(candidates);
  if (!target) {
    throw new Error(
      `Cannot find subcommand "${baseName}". Tried:\n  ${candidates.join("\n  ")}`
    );
  }

  const url = pathToFileURL(target).href;
  return await import(url);
}


/**
 * Carga un módulo del usuario (.ts/.js) de manera robusta:
 * - paths relativos/absolutos
 * - ESM
 * - TS (usando tsx si está disponible)
 */
export async function loadUserModule(modulePath: string): Promise<any> {
  const abs = path.resolve(modulePath);
  const url = pathToFileURL(abs).href;

  const tsImport = await tryGetTsImport();
  if (tsImport) {
    return await tsImport(url, import.meta.url);
  }

  return await import(url);
}

async function tryGetTsImport(): Promise<null | ((url: string, parent: string) => Promise<any>)> {
  const candidates = ["tsx/esm/api", "tsx/esm", "tsx"];
  for (const spec of candidates) {
    try {
      const m: any = await import(spec);
      if (typeof m.tsImport === "function") return m.tsImport;
    } catch {
      // ignore
    }
  }
  return null;
}
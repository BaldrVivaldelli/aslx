#!/usr/bin/env node

// Enable loading user-provided TypeScript entrypoints via dynamic `import()`.
import 'tsx';

import { existsSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { isStateMachineBuilder, StateMachineBuilder } from '../dsl/state-machine';
import { buildStateMachineDefinition } from './build-state-machine-definition.js';
import { renderMermaid } from './graph.js';
import { loadUserModule } from './load-module.js';

type SlotRegistry = Record<string, string>;

type CliOptions = {
  input: string;
  slotsPath: string;
  outDir: string;
  graph: boolean;
  graphDir?: string;
  keepSlots: boolean;
  inputWasDefault: boolean;
  slotsWasDefault: boolean;
};


function printHelp() {
  console.log(`aslx build

Build ASL JSON definition(s) from exported stateMachine(...) builders.

Aliases:
  build-machine

Usage:
  aslx build [entry] [--slots <slots.json>] [--out-dir <dir>] [--graph] [--graph-dir <dir>] [--keep-slots]
  aslx build-machine [entry] [--slots <slots.json>] [--out-dir <dir>] [--graph] [--graph-dir <dir>] [--keep-slots]
  aslx-build-machine [entry] [--slots <slots.json>] [--out-dir <dir>] [--graph] [--graph-dir <dir>] [--keep-slots]

Defaults:
  entry      machines/index.ts
  --slots    build/slots.json
  --out-dir  build/machines

Options:
  --slots <file>     Path to slots registry JSON (from "aslx compile").
  --out-dir <dir>    Output directory for generated machine definition JSON.
  --graph            Also emit Mermaid graphs (*.mmd).
  --graph-dir <dir>  Graph output directory (implies --graph).
  --keep-slots        Preserve { __kind, __slotId } markers instead of inlining JSONata templates.
  -h, --help         Show this help

Preflight checks:
  - If you omit --slots, the default is build/slots.json.
  - If that file doesn't exist, the CLI will suggest running "aslx compile" first.

Examples:
  aslx compile machines/index.ts --out build/slots.json
  aslx validate machines/index.ts
  aslx build machines/index.ts --slots build/slots.json --out-dir build/machines --graph
`);
}

function parseArgs(argv: string[]): CliOptions {
  const args = [...argv];

  let input = 'machines/index.ts';
  let slotsPath = 'build/slots.json';
  let outDir = 'build/machines';

  let inputWasDefault = true;
  let slotsWasDefault = true;

  let graph = false;
  let graphDir: string | undefined;
  let keepSlots = false;

  const positional: string[] = [];

  while (args.length > 0) {
    const current = args.shift();
    if (!current) break;

    if (current === '--slots') {
      const next = args.shift();
      if (!next) throw new Error('Missing value for --slots');
      slotsPath = next;
      slotsWasDefault = false;
      continue;
    }

    if (current === '--out-dir') {
      const next = args.shift();
      if (!next) throw new Error('Missing value for --out-dir');
      outDir = next;
      continue;
    }

    if (current === '--graph' || current === '--graphs') {
      graph = true;
      continue;
    }

    if (current === '--graph-dir') {
      const next = args.shift();
      if (!next) throw new Error('Missing value for --graph-dir');
      graph = true;
      graphDir = next;
      continue;
    }

    if (current === '--keep-slots') {
      keepSlots = true;
      continue;
    }

    if (current.startsWith('-')) {
      throw new Error(`Unknown option: ${current}`);
    }

    positional.push(current);
  }

  if (positional.length > 0) {
    if (positional.length > 1) {
      throw new Error(`Too many positional arguments: ${positional.join(' ')}`);
    }
    input = positional[0]!;
    inputWasDefault = false;
  }

  return { input, slotsPath, outDir, graph, graphDir, keepSlots, inputWasDefault, slotsWasDefault };
}

function isFile(p: string): boolean {
  try {
    return existsSync(p) && statSync(p).isFile();
  } catch {
    return false;
  }
}

function toFileStem(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}



async function loadSlots(slotsPath: string): Promise<SlotRegistry> {
  const resolved = path.resolve(process.cwd(), slotsPath);
  const raw = await readFile(resolved, 'utf8');
  return JSON.parse(raw) as SlotRegistry;
}


export function collectStateMachineBuilders(mod: Record<string, unknown>): Array<[string, StateMachineBuilder]> {
  return Object.entries(mod).filter(
    (entry): entry is [string, StateMachineBuilder] => isStateMachineBuilder(entry[1]),
  );
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    printHelp();
    return;
  }

  const options = parseArgs(argv);

  // --- Preflight checks (better UX for the common "aslx build" flow) ---
  const resolvedInput = path.resolve(process.cwd(), options.input);
  if (!isFile(resolvedInput)) {
    console.error(`Entry file not found: ${options.input}`);
    if (options.inputWasDefault) {
      console.error(`This command defaults to "machines/index.ts" if you don't pass an entry file.`);
      console.error(`Create ${options.input} or pass a different entry file.`);
    }
    console.error(`Run: aslx build --help`);
    process.exitCode = 1;
    return;
  }

  const resolvedSlots = path.resolve(process.cwd(), options.slotsPath);
  if (!isFile(resolvedSlots)) {
    console.error(`Slots registry not found: ${options.slotsPath}`);
    if (options.slotsWasDefault) {
      console.error(`It looks like you haven't compiled slots yet.`);
      console.error(`Run this first:`);
      console.error(`  aslx compile ${options.input} --out ${options.slotsPath}`);
      console.error(`Then re-run:`);
      console.error(`  aslx build ${options.input} --slots ${options.slotsPath} --out-dir ${options.outDir}`);
    } else {
      console.error(`Make sure you compiled slots into that file.`);
      console.error(`Example:`);
      console.error(`  aslx compile ${options.input} --out ${options.slotsPath}`);
    }
    process.exitCode = 1;
    return;
  }

  const slots = await loadSlots(options.slotsPath);
  let mod: any;

  try {
    mod = await loadUserModule(options.input);
  } catch (err) {
    console.error("IMPORT ERROR:");
    console.error(err);
    process.exit(1);
  }
  const builders = collectStateMachineBuilders(mod);

  if (builders.length === 0) {
    throw new Error(`No exported stateMachine(...) builders found in ${options.input}`);
  }

  const outDir = path.resolve(process.cwd(), options.outDir);
  await mkdir(outDir, { recursive: true });

  const graphOutDir = options.graph ? path.resolve(process.cwd(), options.graphDir ?? path.join(options.outDir, 'graphs')) : undefined;
  if (graphOutDir) await mkdir(graphOutDir, { recursive: true });

  const written: string[] = [];

  for (const [exportName, builder] of builders) {
    const definition = buildStateMachineDefinition(builder.build(), slots, !options.keepSlots);
    const filename = `${toFileStem(exportName)}.json`;
    const filePath = path.join(outDir, filename);
    await writeFile(filePath, `${JSON.stringify(definition, null, 2)}\n`, 'utf8');
    if (graphOutDir) {
      const graphFilename = `${toFileStem(exportName)}.mmd`;
      const graphPath = path.join(graphOutDir, graphFilename);
      await writeFile(graphPath, renderMermaid(definition), 'utf8');
    }
    written.push(path.relative(process.cwd(), filePath));
  }

  const relativeInput = path.relative(process.cwd(), path.resolve(process.cwd(), options.input));
  console.log(`Built ${written.length} state machine definition(s) from ${relativeInput}:`);
  for (const file of written) {
    console.log(`- ${file}`);
  }

  if (graphOutDir) {
    console.log(`Graph output directory: ${path.relative(process.cwd(), graphOutDir)}`);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});

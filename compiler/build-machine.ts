import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { StateMachineBuilder } from '../dsl/state-machine';
import { buildStateMachineDefinition } from './build-state-machine-definition';
import { renderMermaid } from './graph';

type SlotRegistry = Record<string, string>;

type CliOptions = {
  input: string;
  slotsPath: string;
  outDir: string;
  graph: boolean;
  graphDir?: string;
};

function parseArgs(argv: string[]): CliOptions {
  const args = [...argv];

  let input = 'machines/index.ts';
  let slotsPath = 'build/slots.json';
  let outDir = 'build/machines';

  let graph = false;
  let graphDir: string | undefined;

  const positional: string[] = [];

  while (args.length > 0) {
    const current = args.shift();
    if (!current) break;

    if (current === '--slots') {
      const next = args.shift();
      if (!next) throw new Error('Missing value for --slots');
      slotsPath = next;
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

    positional.push(current);
  }

  if (positional.length > 0) {
    input = positional[0]!;
  }

  return { input, slotsPath, outDir, graph, graphDir };
}

function toFileStem(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

async function loadModule(modulePath: string): Promise<Record<string, unknown>> {
  const resolved = path.resolve(process.cwd(), modulePath);
  const url = pathToFileURL(resolved).href;
  return import(url);
}

async function loadSlots(slotsPath: string): Promise<SlotRegistry> {
  const resolved = path.resolve(process.cwd(), slotsPath);
  const raw = await readFile(resolved, 'utf8');
  return JSON.parse(raw) as SlotRegistry;
}

function collectStateMachineBuilders(mod: Record<string, unknown>): Array<[string, StateMachineBuilder]> {
  return Object.entries(mod)
    .filter((entry): entry is [string, StateMachineBuilder] => entry[1] instanceof StateMachineBuilder);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const slots = await loadSlots(options.slotsPath);
  const mod = await loadModule(options.input);
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
    const definition = buildStateMachineDefinition(builder.build(), slots);
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

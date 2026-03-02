#!/usr/bin/env node

// Enable loading user-provided TypeScript entrypoints via dynamic `import()`.
import 'tsx';

import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { StateMachineBuilder } from '../dsl/state-machine';
import { normalizeStateMachine } from './normalize-state-machine';
import { validateStateMachine } from './validate-state-machine';

type CliOptions = {
  input: string;
  inputWasDefault: boolean;
};


function printHelp() {
  console.log(`aslx validate

Validate exported stateMachine(...) builders (graph + semantics).

Aliases:
  validate-machine, check

Usage:
  aslx validate [entry]
  aslx validate-machine [entry]
  aslx-validate-machine [entry]

Defaults:
  entry  machines/index.ts

Options:
  -h, --help  Show this help

Preflight checks:
  - If you omit the entry file, the default is machines/index.ts.
  - If that file doesn't exist, the CLI will explain what happened and how to fix it.

Examples:
  aslx validate machines/index.ts
`);
}


function parseArgs(argv: string[]): CliOptions {
  const args = [...argv];

  let input = 'machines/index.ts';
  let inputWasDefault = true;

  const positional: string[] = [];

  while (args.length > 0) {
    const current = args.shift();
    if (!current) break;

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

  return { input, inputWasDefault };
}

function isFile(p: string): boolean {
  try {
    return existsSync(p) && statSync(p).isFile();
  } catch {
    return false;
  }
}

async function loadModule(modulePath: string): Promise<Record<string, unknown>> {
  const resolved = path.resolve(process.cwd(), modulePath);
  const url = pathToFileURL(resolved).href;
  return import(url);
}

function collectStateMachineBuilders(mod: Record<string, unknown>): Array<[string, StateMachineBuilder]> {
  return Object.entries(mod)
    .filter((entry): entry is [string, StateMachineBuilder] => entry[1] instanceof StateMachineBuilder);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    printHelp();
    return;
  }

  const options = parseArgs(argv);

  // --- Preflight checks (better UX for the common "aslx validate" flow) ---
  const resolvedInput = path.resolve(process.cwd(), options.input);
  if (!isFile(resolvedInput)) {
    console.error(`Entry file not found: ${options.input}`);
    if (options.inputWasDefault) {
      console.error(`This command defaults to "machines/index.ts" if you don't pass an entry file.`);
      console.error(`Create ${options.input} or pass a different entry file.`);
    }
    console.error(`Run: aslx validate --help`);
    process.exitCode = 1;
    return;
  }

  const mod = await loadModule(options.input);
  const builders = collectStateMachineBuilders(mod);

  if (builders.length === 0) {
    throw new Error(`No exported stateMachine(...) builders found in ${options.input}`);
  }

  for (const [, builder] of builders) {
    const normalized = normalizeStateMachine(builder.build());
    validateStateMachine(normalized);
  }

  const relativeInput = path.relative(process.cwd(), path.resolve(process.cwd(), options.input));
  console.log(`Validated ${builders.length} state machine(s) from ${relativeInput}.`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});

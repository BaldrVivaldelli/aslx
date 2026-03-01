import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { StateMachineBuilder } from '../dsl/state-machine';
import { normalizeStateMachine } from './normalize-state-machine';
import { validateStateMachine } from './validate-state-machine';

type CliOptions = {
  input: string;
};

function parseArgs(argv: string[]): CliOptions {
  const positional = argv.filter((arg) => !arg.startsWith('--'));
  return {
    input: positional[0] ?? 'example/infra.ts',
  };
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
  const options = parseArgs(process.argv.slice(2));
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

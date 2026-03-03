#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type Command = {
  /** Primary name shown in `aslx --help`. */
  name: string;
  description: string;
  /** Built JS file name living next to this CLI in dist/cli. */
  file: string;
  /** Alternative names accepted by the router (includes legacy long names). */
  aliases?: string[];
};

// Prefer short commands for day-to-day usage; keep legacy long names as aliases.
const COMMANDS: Command[] = [
  {
    name: 'compile',
    description: 'Compile TypeScript slots into JSONata registry (slots.json + slots.map.json).',
    file: 'compile-jsonata.js',
    aliases: ['compile-jsonata', 'slots'],
  },
  {
    name: 'build',
    description: 'Build ASL JSON definition(s) from exported stateMachine(...) builders.',
    file: 'build-machine.js',
    aliases: ['build-machine'],
  },
  {
    name: 'validate',
    description: 'Validate exported stateMachine(...) builders (graph + semantics).',
    file: 'validate-machine.js',
    aliases: ['validate-machine', 'check'],
  },
  {
    name: 'yml',
    description: 'Convert built .json machine definitions to .yml.',
    file: 'build-yml.js',
    aliases: ['build-yml', 'yaml'],
  },
];

function getVersion(): string | null {
  try {
    const require = createRequire(__filename);

    const here = path.dirname(require.resolve("./aslx.cjs"));
    const pkgPath = path.resolve(here, '../../package.json');
    const raw = fs.readFileSync(pkgPath, 'utf8');
    const pkg = JSON.parse(raw) as { version?: string };
    return pkg.version ?? null;
  } catch {
    return null;
  }
}

function printHelp() {
  const version = getVersion();
  const header = version ? `aslx v${version}` : 'aslx';

  const maxName = Math.max(...COMMANDS.map((c) => c.name.length));

  const lines = COMMANDS.map((c) => {
    const alias = c.aliases && c.aliases.length ? ` (aliases: ${c.aliases.join(', ')})` : '';
    return `  ${c.name.padEnd(maxName)}  ${c.description}${alias}`;
  }).join('\n');

  console.log(`${header}

Usage:
  aslx <command> [args...]

Commands:
${lines}

Options:
  -h, --help     Show this help
  -v, --version  Print version

Examples (end-to-end):
  # 1) Compile JSONata slots from TypeScript
  aslx compile machines/index.ts --out build/slots.json

  # 2) Validate stateMachine(...) exports (graph + semantics)
  aslx validate machines/index.ts

  # 3) Build ASL machine definitions (+ optional Mermaid graphs)
  aslx build machines/index.ts --slots build/slots.json --out-dir build/machines --graph

  # 4) (Optional) Convert JSON definitions to YAML
  aslx yml --in-dir build/machines --out-dir build/machines

More:
  Run: aslx <command> --help
  Or:  aslx help <command>

Legacy binaries are still available:
  aslx-compile-jsonata, aslx-build-machine, aslx-validate-machine, aslx-build-yml
`);
}

function resolveCommand(name: string): Command | null {
  const normalized = name.trim();
  return (
    COMMANDS.find((c) => c.name === normalized) ??
    COMMANDS.find((c) => (c.aliases ?? []).includes(normalized)) ??
    null
  );
}

function runSubcommand(cmd: Command, args: string[]): number {
  const require = createRequire(__filename);
  const here = path.dirname(__filename);
  const target = path.join(here, cmd.file);

  if (!fs.existsSync(target)) {
    console.error(`Cannot find subcommand implementation: ${target}`);
    console.error(`This usually means the package was not built correctly (missing dist/cli files).`);
    return 1;
  }

  const result = spawnSync(process.execPath, [target, ...args], {
    stdio: 'inherit',
    env: process.env,
  });

  // `status` is null if the process was terminated by a signal.
  if (typeof result.status === 'number') return result.status;
  return 1;
}

function main() {
  const argv = process.argv.slice(2);

  if (argv.length === 0) {
    printHelp();
    process.exitCode = 0;
    return;
  }

  const first = argv[0] ?? '';

  if (first === '--help' || first === '-h' || first === 'help') {
    const maybeCmd = argv[1];
    if (first === 'help' && maybeCmd) {
      const cmd = resolveCommand(maybeCmd);
      if (!cmd) {
        console.error(`Unknown command: ${maybeCmd}`);
        printHelp();
        process.exitCode = 1;
        return;
      }
      process.exitCode = runSubcommand(cmd, ['--help']);
      return;
    }
    printHelp();
    process.exitCode = 0;
    return;
  }

  if (first === '--version' || first === '-v') {
    const version = getVersion();
    console.log(version ?? 'unknown');
    process.exitCode = 0;
    return;
  }

  const cmd = resolveCommand(first);
  if (!cmd) {
    console.error(`Unknown command: ${first}`);
    printHelp();
    process.exitCode = 1;
    return;
  }

  process.exitCode = runSubcommand(cmd, argv.slice(1));
}

main();

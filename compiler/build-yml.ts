#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

type Args = {
  inDir: string;
  outDir: string;
  inDirWasDefault: boolean;
  outDirWasDefault: boolean;
};


function printHelp() {
  console.log(`aslx yml

Convert generated ASL JSON machine definition(s) to YAML.

Aliases:
  build-yml, yaml

Usage:
  aslx yml [--in-dir <dir>] [--out-dir <dir>]
  aslx build-yml [--in-dir <dir>] [--out-dir <dir>]
  aslx-build-yml [--in-dir <dir>] [--out-dir <dir>]

Defaults:
  --in-dir   build/machines
  --out-dir  (same as --in-dir)

Options:
  --in-dir <dir>   Directory containing *.json machine definitions.
  --out-dir <dir>  Output directory for *.yml files (defaults to in-dir).
  -h, --help       Show this help

Preflight checks:
  - If you omit --in-dir, the default is build/machines.
  - If that directory doesn't exist, the CLI will suggest running "aslx build" first.

Examples:
  aslx yml --in-dir build/machines --out-dir build/machines
`);
}


function parseArgs(argv: string[]): Args {
  const args = [...argv];

  let inDir = 'build/machines';
  let outDir: string | undefined;

  let inDirWasDefault = true;
  let outDirWasDefault = true;

  const positional: string[] = [];

  while (args.length > 0) {
    const current = args.shift();
    if (!current) break;

    if (current === '--in-dir') {
      const next = args.shift();
      if (!next) throw new Error('Missing value for --in-dir');
      inDir = next;
      inDirWasDefault = false;
      continue;
    }

    if (current === '--out-dir') {
      const next = args.shift();
      if (!next) throw new Error('Missing value for --out-dir');
      outDir = next;
      outDirWasDefault = false;
      continue;
    }

    if (current.startsWith('-')) {
      throw new Error(`Unknown option: ${current}`);
    }

    positional.push(current);
  }

  if (positional.length > 0) {
    throw new Error(`Unexpected positional arguments: ${positional.join(' ')}`);
  }

  return { inDir, outDir: outDir ?? inDir, inDirWasDefault, outDirWasDefault };
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function isDir(p: string): boolean {
  try {
    return fs.existsSync(p) && fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function listJsonFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => path.join(dir, f));
}

function stableYamlStringify(definition: unknown): string {
  return YAML.stringify(definition, {
    indent: 2,
    lineWidth: 0, // no wrap
    defaultStringType: "QUOTE_DOUBLE",
  })
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    printHelp();
    return;
  }

  const options = parseArgs(argv);

  // --- Preflight checks (better UX for the common "aslx yml" flow) ---
  if (!isDir(options.inDir)) {
    console.error(`Input directory not found: ${options.inDir}`);
    if (options.inDirWasDefault) {
      console.error(`It looks like you haven't built machine definitions yet.`);
      console.error(`Run this first:`);
      console.error(`  aslx build machines/index.ts --slots build/slots.json --out-dir ${options.inDir}`);
      console.error(`Then re-run:`);
      console.error(`  aslx yml --in-dir ${options.inDir} --out-dir ${options.outDir}`);
    } else {
      console.error(`Make sure you built machine definitions into that directory.`);
      console.error(`Example:`);
      console.error(`  aslx build machines/index.ts --slots build/slots.json --out-dir ${options.inDir}`);
    }
    console.error(`Run: aslx yml --help`);
    process.exitCode = 1;
    return;
  }

  const files = listJsonFiles(options.inDir);
  if (files.length === 0) {
    console.error(`No .json machines found in: ${options.inDir}`);
    if (options.inDirWasDefault) {
      console.error(`If you haven't built machines yet, run:`);
      console.error(`  aslx build machines/index.ts --slots build/slots.json --out-dir ${options.inDir}`);
    } else {
      console.error(`Double-check the directory and make sure it contains *.json machine definitions.`);
    }
    console.error(`Run: aslx yml --help`);
    process.exitCode = 1;
    return;
  }

  if (options.outDirWasDefault) {
    console.log(`ℹ️  --out-dir was not provided; using out-dir = in-dir: ${options.outDir}`);
  }

  ensureDir(options.outDir);

  for (const file of files) {
    const jsonText = fs.readFileSync(file, 'utf8');
    const data = JSON.parse(jsonText);

    const ymlText = stableYamlStringify(data);

    const outFile = path.join(options.outDir, path.basename(file).replace(/\.json$/, '.yml'));
    fs.writeFileSync(outFile, ymlText, 'utf8');
  }

  console.log(`✅ Generated ${files.length} YAML machine(s) into: ${options.outDir}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
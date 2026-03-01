import { cp, mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const projectRoot = process.cwd();
const sourceInput = 'example/infra.ts';
const goldenRoot = path.join(projectRoot, 'testdata', 'golden');
const goldenSlots = path.join(goldenRoot, 'slots.json');
const goldenMachinesDir = path.join(goldenRoot, 'machines');
const updateMode = process.argv.includes('--update');

function tsxCommand(): { command: string; args: string[] } {
  return {
    command: process.execPath,
    args: [path.join(projectRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs')],
  };
}

function run(command: string, args: string[], cwd: string): void {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: false,
    env: process.env,
  });

  if (result.status !== 0) {
    throw new Error(`Command failed: ${[command, ...args].join(' ')}`);
  }
}

async function listRelativeFiles(root: string): Promise<string[]> {
  const output: string[] = [];

  async function walk(current: string) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
      } else if (entry.isFile()) {
        output.push(path.relative(root, absolute));
      }
    }
  }

  const exists = await stat(root).then(() => true).catch(() => false);
  if (!exists) return output;

  await walk(root);
  return output.sort();
}

function firstDiffSnippet(expected: string, actual: string): string {
  const expectedLines = expected.split('\n');
  const actualLines = actual.split('\n');
  const max = Math.max(expectedLines.length, actualLines.length);

  for (let i = 0; i < max; i += 1) {
    const left = expectedLines[i];
    const right = actualLines[i];
    if (left !== right) {
      return [
        `line ${i + 1}`,
        `expected: ${left ?? '<missing>'}`,
        `actual:   ${right ?? '<missing>'}`,
      ].join('\n');
    }
  }

  return 'contents differ';
}

async function compareFilePair(expectedPath: string, actualPath: string): Promise<string | null> {
  const [expected, actual] = await Promise.all([
    readFile(expectedPath, 'utf8'),
    readFile(actualPath, 'utf8'),
  ]);

  if (expected === actual) return null;

  return firstDiffSnippet(expected, actual);
}

async function ensureGoldenFiles(actualSlots: string, actualMachinesDir: string): Promise<void> {
  await mkdir(goldenMachinesDir, { recursive: true });
  await cp(actualSlots, goldenSlots);
  await rm(goldenMachinesDir, { recursive: true, force: true });
  await mkdir(goldenMachinesDir, { recursive: true });
  await cp(actualMachinesDir, goldenMachinesDir, { recursive: true });
}

async function main() {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'dsl-golden-'));
  const actualSlots = path.join(tempRoot, 'slots.json');
  const actualMachinesDir = path.join(tempRoot, 'machines');
  const { command, args } = tsxCommand();

  try {
    run(command, [...args, 'compiler/compile-jsonata.ts', sourceInput, '--out', actualSlots], projectRoot);
    run(command, [...args, 'compiler/build-machine.ts', sourceInput, '--slots', actualSlots, '--out-dir', actualMachinesDir], projectRoot);

    if (updateMode) {
      await ensureGoldenFiles(actualSlots, actualMachinesDir);
      console.log('Updated golden snapshots:');
      console.log(`- ${path.relative(projectRoot, goldenSlots)}`);
      const updatedFiles = await listRelativeFiles(goldenMachinesDir);
      for (const file of updatedFiles) {
        console.log(`- ${path.join('testdata', 'golden', 'machines', file)}`);
      }
      return;
    }

    const issues: string[] = [];
    const goldenExists = await stat(goldenSlots).then(() => true).catch(() => false);
    if (!goldenExists) {
      issues.push(`Missing golden file: ${path.relative(projectRoot, goldenSlots)} (run npm run test:golden:update)`);
    } else {
      const diff = await compareFilePair(goldenSlots, actualSlots);
      if (diff) {
        issues.push(`Mismatch in ${path.relative(projectRoot, goldenSlots)}\n${diff}`);
      }
    }

    const [expectedMachineFiles, actualMachineFiles] = await Promise.all([
      listRelativeFiles(goldenMachinesDir),
      listRelativeFiles(actualMachinesDir),
    ]);

    for (const file of expectedMachineFiles) {
      if (!actualMachineFiles.includes(file)) {
        issues.push(`Missing generated machine snapshot: testdata/golden/machines/${file}`);
      }
    }

    for (const file of actualMachineFiles) {
      if (!expectedMachineFiles.includes(file)) {
        issues.push(`Unexpected generated machine snapshot: testdata/golden/machines/${file}`);
      }
    }

    for (const file of expectedMachineFiles) {
      if (!actualMachineFiles.includes(file)) continue;
      const expectedPath = path.join(goldenMachinesDir, file);
      const actualPath = path.join(actualMachinesDir, file);
      const diff = await compareFilePair(expectedPath, actualPath);
      if (diff) {
        issues.push(`Mismatch in testdata/golden/machines/${file}\n${diff}`);
      }
    }

    if (issues.length > 0) {
      throw new Error(['Golden snapshot test failed:', ...issues.map((issue) => `- ${issue}`)].join('\n'));
    }

    const totalFiles = 1 + actualMachineFiles.length;
    console.log(`Golden snapshot test passed for ${totalFiles} file(s).`);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});

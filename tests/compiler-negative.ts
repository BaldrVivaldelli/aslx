import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const projectRoot = process.cwd();

function tsxCommand(): { command: string; args: string[] } {
  return {
    command: process.execPath,
    args: [path.join(projectRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs')],
  };
}

type NegativeCase = {
  name: string;
  source: string;
  expectedMessageIncludes: string[];
};

const negativeCases: NegativeCase[] = [
  {
    name: 'rejects optional chaining',
    source: `
export const badOptional = slot("tests:slots/optional", () => {
  const payload = { nested: 1 } as any;
  return payload?.nested;
});
`,
    expectedMessageIncludes: [
      'Unsupported expression type in toJsonata subset: OptionalChainingExpression',
    ],
  },
  {
    name: 'rejects let declarations inside slots',
    source: `
export const badLet = slot("tests:slots/let", () => {
  let value = 1;
  return value;
});
`,
    expectedMessageIncludes: ["Only 'const' declarations supported in toJsonata"],
  },
  {
    name: 'rejects object spread',
    source: `
export const badSpread = slot("tests:slots/spread", () => {
  const base = { a: 1 };
  return { ...base, b: 2 };
});
`,
    expectedMessageIncludes: ['Spread in objects not supported (v1)'],
  },
  {
    name: 'rejects nullish coalescing',
    source: `
export const badNullish = slot("tests:slots/nullish", () => {
  const left = 1 as any;
  const right = 2 as any;
  return left ?? right;
});
`,
    expectedMessageIncludes: ['Unsupported binary operator ??'],
  },
  {
    name: 'rejects unbound identifiers',
    source: `
export const badUnbound = slot("tests:slots/unbound", () => {
  return missingValue;
});
`,
    expectedMessageIncludes: ["Unbound identifier 'missingValue' in toJsonata subset"],
  },
  {
    name: 'rejects malformed slot calls without a slot id',
    source: `
export const badSlot = slot(() => {
  return 1;
});
`,
    expectedMessageIncludes: ['slot missing slotId: use slot("...", () => ...)'],
  },
];

const validControlSource = `
export const ok = slot("tests:slots/ok", () => {
  const value = 1;
  return { ok: true, value };
});
`;

async function runCompile(source: string, filename: string) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'dsl-slot-negative-'));
  const inputFile = path.join(tempRoot, filename);
  const outFile = path.join(tempRoot, 'slots.json');
  await writeFile(inputFile, source, 'utf8');

  const { command, args } = tsxCommand();
  const result = spawnSync(command, [...args, 'compiler/compile-jsonata.ts', inputFile, '--out', outFile], {
    cwd: projectRoot,
    encoding: 'utf8',
    shell: false,
    env: process.env,
  });

  return {
    tempRoot,
    inputFile,
    outFile,
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

async function assertNegativeCase(testCase: NegativeCase, index: number): Promise<void> {
  const run = await runCompile(testCase.source, `negative-${index}.ts`);
  try {
    assert.notEqual(run.status, 0, `${testCase.name}: compiler should fail with a non-zero exit code`);
    const combined = `${run.stdout}\n${run.stderr}`;
    for (const fragment of testCase.expectedMessageIncludes) {
      assert.match(
        combined,
        new RegExp(escapeRegExp(fragment)),
        `${testCase.name}: expected compiler output to contain: ${fragment}`,
      );
    }
  } finally {
    await rm(run.tempRoot, { recursive: true, force: true });
  }
}

async function assertPositiveControl(): Promise<void> {
  const run = await runCompile(validControlSource, 'positive-control.ts');
  try {
    assert.equal(run.status, 0, `positive control should compile successfully, got output:\n${run.stdout}\n${run.stderr}`);
    const json = JSON.parse(await readFile(run.outFile, 'utf8')) as Record<string, string>;
    assert.ok(json['tests:slots/ok'], 'positive control should emit the expected slot id');
    assert.match(json['tests:slots/ok'], /^\{%[\s\S]*%\}$/);
  } finally {
    await rm(run.tempRoot, { recursive: true, force: true });
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function main() {
  for (const [index, testCase] of negativeCases.entries()) {
    await assertNegativeCase(testCase, index);
  }

  await assertPositiveControl();

  console.log(
    `Slot compiler negative tests passed (${negativeCases.length} invalid fixtures + 1 positive control).`,
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});

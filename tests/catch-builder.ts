import assert from 'node:assert/strict';

import { emitStateMachine } from '../compiler/emit-asl';
import { lambdaInvoke } from '../dsl/lambda';
import { pass } from '../dsl/steps';
import { stateMachine } from '../dsl/state-machine';
import { subflow } from '../dsl/subflow';
import { task } from '../dsl/task';

const slots = {
  'tests:errorOutput': '{% $states.errorOutput %}',
};

const tests: Array<{ name: string; run: () => void }> = [
  {
    name: 'emits direct catch targets on task states',
    run: () => {
      const definition = emitStateMachine(
        stateMachine('DirectCatch')
          .startWith(
            task('Work')
              .resource('arn:aws:states:::lambda:invoke')
              .catch(['States.Timeout'], 'Recover', { output: { task_error: { __kind: 'jsonata_slot', __slotId: 'tests:errorOutput' } } })
              .next('Done'),
          )
          .then(pass('Done').end())
          .then(pass('Recover').end())
          .build(),
        slots,
      );

      const work = definition.States.Work;
      assert.equal(work.Type, 'Task');
      assert.deepEqual(work.Catch, [
        {
          ErrorEquals: ['States.Timeout'],
          Next: 'Recover',
          Output: { task_error: '{% ($states.errorOutput) %}' },
        },
      ]);
      assert.equal(work.Next, 'Done');
    },
  },
  {
    name: 'auto-wires inline catch subflows back into the following step',
    run: () => {
      const definition = emitStateMachine(
        stateMachine('InlineCatch')
          .startWith(
            lambdaInvoke('ComputeWithRecovery')
              .functionName('ComputeFunctionArn')
              .payload({ computeMany: 'input' })
              .catchAll(
                subflow(
                  pass('NormalizeComputeError').content({ ok: false, reason: 'compute_failed' }),
                ).then(
                  pass('AuditComputeFailure').content({ audited: true, source: 'catch' }),
                ),
                { output: { compute_error: { __kind: 'jsonata_slot', __slotId: 'tests:errorOutput' } } },
              ),
          )
          .then(
            pass('AfterComputeAttempt')
              .content({ joined: true })
              .end(),
          )
          .build(),
        slots,
      );

      const work = definition.States.ComputeWithRecovery;
      assert.equal(work.Type, 'Task');
      assert.equal(work.Next, 'AfterComputeAttempt');
      assert.deepEqual(work.Catch, [
        {
          ErrorEquals: ['States.ALL'],
          Next: 'NormalizeComputeError',
          Output: { compute_error: '{% ($states.errorOutput) %}' },
        },
      ]);

      const normalize = definition.States.NormalizeComputeError;
      const audit = definition.States.AuditComputeFailure;
      assert.equal(normalize.Type, 'Pass');
      assert.equal(normalize.Next, 'AuditComputeFailure');
      assert.equal(audit.Type, 'Pass');
      assert.equal(audit.Next, 'AfterComputeAttempt');
    },
  },
];

let failures = 0;
for (const test of tests) {
  try {
    test.run();
    console.log(`✅ ${test.name}`);
  } catch (error: unknown) {
    failures += 1;
    console.error(`❌ ${test.name}`);
    console.error(error instanceof Error ? error.stack : String(error));
  }
}

if (failures > 0) {
  console.error(`\n${failures} catch builder test(s) failed.`);
  process.exit(1);
}

console.log(`\n${tests.length} catch builder test(s) passed.`);

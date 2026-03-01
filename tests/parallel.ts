import assert from 'node:assert/strict';

import { emitStateMachine } from '../compiler/emit-asl';
import { lambdaInvoke } from '../dsl/lambda';
import { parallel } from '../dsl/parallel';
import { choice } from '../dsl/choice';
import { pass } from '../dsl/steps';
import { stateMachine } from '../dsl/state-machine';
import { subflow } from '../dsl/subflow';

const slots = {
  'tests:parallel/input': '{% $states.input %}',
  'tests:parallel/eligible': '{% true %}',
};

const tests: Array<{ name: string; run: () => void }> = [
  {
    name: 'emits a parallel state with multiple branches and a next transition',
    run: () => {
      const definition = emitStateMachine(
        stateMachine('ParallelFlow')
          .startWith(
            parallel('PrepareContext')
              .branch(
                subflow(
                  lambdaInvoke('LoadMerchant')
                    .functionName('LoadMerchantArn')
                    .payload({ input: { __kind: 'jsonata_slot', __slotId: 'tests:parallel/input' } }),
                ),
              )
              .branch(
                subflow(
                  lambdaInvoke('LoadRisk')
                    .functionName('LoadRiskArn')
                    .payload({ input: { __kind: 'jsonata_slot', __slotId: 'tests:parallel/input' } }),
                ),
              )
              .resultPath('$.parallel_results'),
          )
          .then(pass('AfterParallel').end())
          .build(),
        slots,
      );

      const prepare = definition.States.PrepareContext;
      assert.equal(prepare.Type, 'Parallel');
      assert.equal(prepare.ResultPath, '$.parallel_results');
      assert.equal(prepare.Next, 'AfterParallel');
      assert.equal(prepare.Branches.length, 2);
      assert.equal(prepare.Branches[0]?.StartAt, 'LoadMerchant');
      assert.equal(prepare.Branches[1]?.StartAt, 'LoadRisk');
      assert.equal(prepare.Branches[0]?.States.LoadMerchant.Type, 'Task');
      assert.equal(prepare.Branches[1]?.States.LoadRisk.Type, 'Task');
    },
  },
  {
    name: 'auto-wires inline catch subflows from parallel states into the following step',
    run: () => {
      const definition = emitStateMachine(
        stateMachine('ParallelCatchFlow')
          .startWith(
            parallel('PrepareContext')
              .branch(
                subflow(
                  lambdaInvoke('LoadMerchant')
                    .functionName('LoadMerchantArn')
                    .payload({ input: { __kind: 'jsonata_slot', __slotId: 'tests:parallel/input' } }),
                ),
              )
              .catchAll(
                subflow(
                  pass('RecoverParallelFailure').content({ ok: false, source: 'parallel' }),
                ),
                { resultPath: '$.parallel_error' },
              ),
          )
          .then(pass('AfterRecovery').end())
          .build(),
        slots,
      );

      const prepare = definition.States.PrepareContext;
      assert.equal(prepare.Type, 'Parallel');
      assert.deepEqual(prepare.Catch, [
        {
          ErrorEquals: ['States.ALL'],
          Next: 'RecoverParallelFailure',
          ResultPath: '$.parallel_error',
        },
      ]);

      const recover = definition.States.RecoverParallelFailure;
      assert.equal(recover.Type, 'Pass');
      assert.equal(recover.Next, 'AfterRecovery');
    },
  },
  {
    name: 'supports parallel followed by downstream choice states',
    run: () => {
      const definition = emitStateMachine(
        stateMachine('ParallelChoiceFlow')
          .startWith(
            parallel('PrepareContext')
              .branch(subflow(pass('LoadMerchantContext').content({ loaded: true })))
              .branch(subflow(pass('LoadRiskContext').content({ loaded: true }))),
          )
          .then(
            choice('IsEligible')
              .whenTrue({ __kind: 'jsonata_slot', __slotId: 'tests:parallel/eligible' }, 'Approve')
              .otherwise('Reject'),
          )
          .then(pass('Approve').end())
          .then(pass('Reject').end())
          .build(),
        slots,
      );

      assert.equal(definition.StartAt, 'PrepareContext');
      assert.equal(definition.States.PrepareContext.Type, 'Parallel');
      assert.equal(definition.States.PrepareContext.Next, 'IsEligible');
      assert.equal(definition.States.IsEligible.Type, 'Choice');
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
  console.error(`\n${failures} parallel builder test(s) failed.`);
  process.exit(1);
}

console.log(`\n${tests.length} parallel builder test(s) passed.`);

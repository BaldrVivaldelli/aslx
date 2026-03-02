import assert from 'node:assert/strict';

import { emitStateMachine } from '../compiler/emit-asl';
import { lambdaInvoke } from '../dsl/lambda';
import { map } from '../dsl/map';
import { pass } from '../dsl/steps';
import { stateMachine } from '../dsl/state-machine';
import { subflow } from '../dsl/subflow';

const slots = {
  'tests:map/items': '{% $states.input.items %}',
  'tests:map/input': '{% $states.input %}',
  'tests:map/itemIndex': '{% $states.context.Map.Item.Index %}',
  'tests:map/itemValue': '{% $states.context.Map.Item.Value %}',
  'tests:map/result': '{% $states.result %}',
  'tests:map/errorOutput': '{% $states.errorOutput %}',
};

const tests: Array<{ name: string; run: () => void }> = [
  {
    name: 'emits a map state with an item processor and a next transition',
    run: () => {
      const definition = emitStateMachine(
        stateMachine('MapFlow')
          .startWith(
            map('ValidateItems')
              .items({ __kind: 'jsonata_slot', __slotId: 'tests:map/items' })
              .itemSelector({
                index: { __kind: 'jsonata_slot', __slotId: 'tests:map/itemIndex' },
                value: { __kind: 'jsonata_slot', __slotId: 'tests:map/itemValue' },
              })
              .maxConcurrency(5)
              .itemProcessor(
                subflow(
                  lambdaInvoke('ValidateOne')
                    .functionName('ValidateArn')
                    .payload({ input: { __kind: 'jsonata_slot', __slotId: 'tests:map/input' } }),
                ),
              )
              .output({ validated_items: { __kind: 'jsonata_slot', __slotId: 'tests:map/result' } }),
          )
          .then(pass('AfterMap').end())
          .build(),
        slots,
      );

      const state = definition.States.ValidateItems as any;
      assert.equal(state.Type, 'Map');
      assert.equal(state.Next, 'AfterMap');
      assert.deepEqual(state.Output, { validated_items: '{% ($states.result) %}' });
      assert.equal(state.MaxConcurrency, 5);
      assert.ok(typeof state.Items === 'string');
      assert.ok(state.Items.includes('$states.input.items'));
      assert.deepEqual(state.ItemProcessor.ProcessorConfig, { Mode: 'INLINE' });
      assert.equal(state.ItemProcessor.StartAt, 'ValidateOne');
      assert.equal(state.ItemProcessor.States.ValidateOne.Type, 'Task');
    },
  },
  {
    name: 'auto-wires inline catch subflows from map states into the following step',
    run: () => {
      const definition = emitStateMachine(
        stateMachine('MapCatchFlow')
          .startWith(
            map('ValidateItems')
              .items({ __kind: 'jsonata_slot', __slotId: 'tests:map/items' })
              .itemProcessor(
                subflow(
                  pass('Noop').content({ ok: true }),
                ),
              )
              .catchAll(
                subflow(
                  pass('RecoverMapFailure').content({ ok: false, source: 'map' }),
                ),
                { output: { map_error: { __kind: 'jsonata_slot', __slotId: 'tests:map/errorOutput' } } },
              ),
          )
          .then(pass('AfterRecovery').end())
          .build(),
        slots,
      );

      const mapState = definition.States.ValidateItems as any;
      assert.equal(mapState.Type, 'Map');
      assert.deepEqual(mapState.Catch, [
        {
          ErrorEquals: ['States.ALL'],
          Next: 'RecoverMapFailure',
          Output: { map_error: '{% ($states.errorOutput) %}' },
        },
      ]);

      const recover = definition.States.RecoverMapFailure as any;
      assert.equal(recover.Type, 'Pass');
      assert.equal(recover.Next, 'AfterRecovery');
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
  console.error(`\n${failures} map builder test(s) failed.`);
  process.exit(1);
}

console.log(`\n${tests.length} map builder test(s) passed.`);

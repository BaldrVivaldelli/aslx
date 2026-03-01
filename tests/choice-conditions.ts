import assert from 'node:assert/strict';

import { emitStateMachine } from '../compiler/emit-asl';
import { choice } from '../dsl/choice';
import { all, and, any, eq, neq, not, or, type JsonataSlot } from '../dsl/jsonata';
import { pass } from '../dsl/steps';
import { stateMachine } from '../dsl/state-machine';

const slots = {
  'tests:choice/isValid': '{% $states.input.valid = true %}',
  'tests:choice/mode': '{% $states.input.mode %}',
  'tests:choice/source': '{% $states.input.source %}',
};

const isValid: JsonataSlot = { __kind: 'jsonata_slot', __slotId: 'tests:choice/isValid' };
const mode: JsonataSlot = { __kind: 'jsonata_slot', __slotId: 'tests:choice/mode' };
const source: JsonataSlot = { __kind: 'jsonata_slot', __slotId: 'tests:choice/source' };

const tests: Array<{ name: string; run: () => void }> = [
  {
    name: 'renders nested and/or/eq conditions for choice states',
    run: () => {
      const definition = emitStateMachine(
        stateMachine('ComposedConditions')
          .startWith(
            choice('Route')
              .whenTrue(
                and(
                  isValid,
                  or(
                    eq(mode, 'strict'),
                    eq(source, 'manual'),
                  ),
                ),
                'Persist',
              )
              .otherwise('Reject'),
          )
          .then(pass('Persist').end())
          .then(pass('Reject').end())
          .build(),
        slots,
      );

      const route = definition.States.Route;
      assert.equal(route.Type, 'Choice');
      assert.equal(route.Default, 'Reject');
      assert.equal(
        route.Choices[0].Condition,
        '{% (($states.input.valid = true) and ((($states.input.mode) = "strict") or (($states.input.source) = "manual"))) %}',
      );
    },
  },
  {
    name: 'renders all/any/neq helpers as composed conditions',
    run: () => {
      const definition = emitStateMachine(
        stateMachine('ExpandedConditions')
          .startWith(
            choice('Route')
              .whenTrue(
                all(
                  isValid,
                  any(
                    eq(mode, 'strict'),
                    eq(source, 'manual'),
                  ),
                  neq(source, 'legacy'),
                ),
                'Persist',
              )
              .otherwise('Reject'),
          )
          .then(pass('Persist').end())
          .then(pass('Reject').end())
          .build(),
        slots,
      );

      const route = definition.States.Route;
      assert.equal(route.Type, 'Choice');
      assert.equal(
        route.Choices[0].Condition,
        '{% (($states.input.valid = true) and ((($states.input.mode) = "strict") or (($states.input.source) = "manual")) and (($states.input.source) != "legacy")) %}',
      );
    },
  },
  {
    name: 'renders not(...) through whenFalse without compiling an extra slot',
    run: () => {
      const definition = emitStateMachine(
        stateMachine('NegatedCondition')
          .startWith(
            choice('Route')
              .whenFalse(isValid, 'Reject')
              .otherwise('Accept'),
          )
          .then(pass('Reject').end())
          .then(pass('Accept').end())
          .build(),
        slots,
      );

      const route = definition.States.Route;
      assert.equal(route.Type, 'Choice');
      assert.equal(route.Choices[0].Condition, '{% not(($states.input.valid = true)) %}');
    },
  },
  {
    name: 'supports literal equality on both sides',
    run: () => {
      const definition = emitStateMachine(
        stateMachine('LiteralEq')
          .startWith(
            choice('Route')
              .whenTrue(eq('manual', 'manual'), 'Accept')
              .otherwise('Reject'),
          )
          .then(pass('Accept').end())
          .then(pass('Reject').end())
          .build(),
        slots,
      );

      const route = definition.States.Route;
      assert.equal(route.Type, 'Choice');
      assert.equal(route.Choices[0].Condition, '{% ("manual" = "manual") %}');
    },
  },
  {
    name: 'supports literal inequality on both sides',
    run: () => {
      const definition = emitStateMachine(
        stateMachine('LiteralNeq')
          .startWith(
            choice('Route')
              .whenTrue(neq('manual', 'legacy'), 'Accept')
              .otherwise('Reject'),
          )
          .then(pass('Accept').end())
          .then(pass('Reject').end())
          .build(),
        slots,
      );

      const route = definition.States.Route;
      assert.equal(route.Type, 'Choice');
      assert.equal(route.Choices[0].Condition, '{% ("manual" != "legacy") %}');
    },
  },
  {
    name: 'all(...) rejects empty operand lists',
    run: () => {
      assert.throws(
        () => all(),
        /all\(\.\.\.\) requires at least one condition operand/,
      );
    },
  },
  {
    name: 'any(...) rejects empty operand lists',
    run: () => {
      assert.throws(
        () => any(),
        /any\(\.\.\.\) requires at least one condition operand/,
      );
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
  console.error(`\n${failures} choice condition test(s) failed.`);
  process.exit(1);
}

console.log(`\n${tests.length} choice condition test(s) passed.`);

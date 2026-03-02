import assert from "node:assert/strict";

import { emitStateMachine } from "../compiler/emit-asl";
import { lambdaInvoke } from "../dsl/lambda";
import { stateMachine } from "../dsl/state-machine";
import { pass } from "../dsl/steps";

const slots = {
  "tests:result/payload": "{% $states.result.Payload %}",
  "tests:result/source": '{% "lambda_invoke" %}',
};

const tests: Array<{ name: string; run: () => void }> = [
  {
    name: "emits task Output and Assign (JSONata)",
    run: () => {
      const definition = emitStateMachine(
        stateMachine("TaskControls")
          .queryLanguage("JSONata")
          .startWith(
            lambdaInvoke("Compute")
              .functionName("ComputeFunctionArn")
              .payload({ computeMany: "input" })
              .assign("compute_payload", { __kind: "jsonata_slot", __slotId: "tests:result/payload" })
              .output({
                compute: {
                  payload: { __kind: "jsonata_slot", __slotId: "tests:result/payload" },
                  source: { __kind: "jsonata_slot", __slotId: "tests:result/source" },
                },
              })
              .timeoutSeconds(30)
              .heartbeatSeconds(10),
          )
          .then(pass("Done").end())
          .build(),
        slots,
      );

      const compute = definition.States.Compute;
      assert.equal(compute.Type, "Task");
      assert.deepEqual(compute.Assign, {
        compute_payload: "{% ($states.result.Payload) %}",
      });
      assert.deepEqual(compute.Output, {
        compute: {
          payload: "{% ($states.result.Payload) %}",
          source: '{% ("lambda_invoke") %}',
        },
      });
      assert.equal(compute.TimeoutSeconds, 30);
      assert.equal(compute.HeartbeatSeconds, 10);
      assert.equal(compute.Next, "Done");
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
  console.error(`\n${failures} task control test(s) failed.`);
  process.exit(1);
}

console.log(`\n${tests.length} task control test(s) passed.`);

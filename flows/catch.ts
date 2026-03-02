import { lambdaInvoke } from "../dsl/lambda";
import { pass } from "../dsl/steps";
import { stateMachine } from "../dsl/state-machine";
import { subflow } from "../dsl/subflow";

import { statesInputSlot, computeErrorCatchOutput } from "../slots/common";
import { computeManyOutput, lambdaServiceRetry } from "../slots/package";

export const exampleFlowWithCatch = stateMachine("ExampleFlowWithCatch")
  .queryLanguage("JSONata")
  .comment("Handles task failures through an inline catch recovery subflow that rejoins the main flow.")
  .startWith(
    lambdaInvoke("ComputeWithRecovery")
      .comment("Attempts the compute Lambda and routes failures through a localized recovery path.")
      .functionName("${file(resources/index.json):cross_lambdas.methods}")
      .payload({
        computeMany: statesInputSlot(),
      })
      .output(computeManyOutput())
      .retry(lambdaServiceRetry())
      .catchAll(
        subflow(
          pass("NormalizeComputeError")
            .content({
              ok: false,
              reason: "compute_failed",
            }),
        ).then(
          pass("AuditComputeFailure")
            .content({
              audited: true,
              source: "catch",
            }),
        ),
        { output: computeErrorCatchOutput() },
      ),
  )
  .then(
    pass("AfterComputeAttempt")
      .content({
        joined: true,
      })
      .end(),
  );


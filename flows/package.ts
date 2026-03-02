import { choice } from "../dsl/choice";
import { awsSdkTask } from "../dsl/aws-sdk";
import { lambdaInvoke } from "../dsl/lambda";
import { pass } from "../dsl/steps";
import { stateMachine } from "../dsl/state-machine";

import { statesInputSlot } from "../slots/common";
import {
  packageKey,
  computeManyEnrichedOutput,
  getPackageOutput,
  lambdaPayloadSlot,
  lambdaExecutedSource,
  lambdaServiceRetry,
  preparePackageModulesOutput,
  isPreparedModulesValid,
} from "../slots/package";

export const packageComputationFlow = stateMachine("PackageComputationFlow")
  .queryLanguage("JSONata")
  .comment(
    "Loads a package, prepares and validates its modules, and computes the final result.",
  )
  .startWith(
    awsSdkTask("GetPackage")
      .comment("Loads the package definition from DynamoDB.")
      .service("dynamodb")
      .action("getItem")
      .arguments({
        TableName: "${file(resources/index.json):tables.providers}",
        Key: packageKey(),
      })
      .output(getPackageOutput()),
  )
  .then(
    lambdaInvoke("PreparePackageModules")
      .comment(
        "Resolves, normalizes, and validates the package modules through a domain Lambda.",
      )
      .functionName("${file(resources/index.json):cross_lambdas.load_modules}")
      .payload({
        input: statesInputSlot(),
      })
      .output(preparePackageModulesOutput()),
  )
  .then(
    choice("ArePreparedModulesValid")
      .comment("Routes to the compute step only when the prepared modules are valid.")
      .whenTrue(isPreparedModulesValid(), "ComputeMany")
      .otherwise("FailValidation"),
  )
  .then(
    lambdaInvoke("ComputeMany")
      .comment("Invokes the computation Lambda with the prepared input.")
      .functionName("${file(resources/index.json):cross_lambdas.methods}")
      .payload({
        computeMany: statesInputSlot(),
      })
      .output(computeManyEnrichedOutput())
      .timeoutSeconds(30)
      .heartbeatSeconds(10)
      .retry(lambdaServiceRetry())
      .end(),
  )
  .then(
    pass("FailValidation")
      .comment("Terminates the flow when the prepared modules are invalid.")
      .content({
        ok: false,
        reason: "invalid_modules",
      })
      .end(),
  );

export const exampleFlowWithTaskResultControls = stateMachine("ExampleFlowWithTaskResultControls")
  .queryLanguage("JSONata")
  .comment("Demonstrates Output, Assign, TimeoutSeconds, and HeartbeatSeconds on Lambda tasks when using JSONata.")
  .startWith(
    lambdaInvoke("ComputeManyWithControls")
      .comment("Invokes the computation Lambda and shapes the state output under $.compute while assigning the raw payload to a variable.")
      .functionName("${file(resources/index.json):cross_lambdas.methods}")
      .payload({
        computeMany: statesInputSlot(),
      })
      .assign("compute_payload", lambdaPayloadSlot())
      .output(computeManyEnrichedOutput())
      .timeoutSeconds(45)
      .heartbeatSeconds(15),
  )
  .then(
    pass("AfterTaskControls")
      .content({
        ok: true,
        handled: "task_result_controls",
      })
      .end(),
  );


# Official example

This is the recommended shape of the DSL for a realistic business workflow.

- use **AWS SDK tasks** for singular infrastructure operations
- use **Lambda tasks** for collection-oriented or domain-heavy preparation
- use **Choice** for explicit control-flow decisions
- use **Pass** for simple terminal responses

## Flow definition

```ts
export const packageComputationFlow = stateMachine("PackageComputationFlow")
  .queryLanguage("JSONata")
  .comment(
    "Loads a package, prepares and validates its modules, and computes the final result.",
  )
  .startWith(
    task("GetPackage")
      .comment("Loads the package definition from DynamoDB.")
      .resource("arn:aws:states:::aws-sdk:dynamodb:getItem")
      .arguments({
        TableName: "${file(resources/index.json):tables.providers}",
        Key: packageKey(),
      })
      .output(getPackageOutput()),
  )
  .then(
    task("PreparePackageModules")
      .comment(
        "Resolves, normalizes, and validates the package modules through a domain Lambda.",
      )
      .resource("arn:aws:states:::lambda:invoke")
      .arguments({
        FunctionName: "${file(resources/index.json):cross_lambdas.load_modules}",
        Payload: {
          input: statesInputSlot(),
        },
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
    task("ComputeMany")
      .comment("Invokes the computation Lambda with the prepared input.")
      .resource("arn:aws:states:::lambda:invoke")
      .arguments({
        FunctionName: "${file(resources/index.json):cross_lambdas.methods}",
        Payload: {
          computeMany: statesInputSlot(),
        },
      })
      .output(computeManyOutput())
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
```

## Supporting slots

```ts
export function statesInputSlot() {
  return slot("package:common/statesInput", () => $states.input as any);
}

export function packageKey() {
  return slot("package:task/getPackage/key", () => $states.input.pk_sk as any);
}

export function getPackageOutput() {
  return slot("package:task/getPackage/output", () =>
    $merge([
      $states.input,
      {
        query_result: $states.result,
      },
    ]),
  );
}

export function preparePackageModulesOutput() {
  return slot("package:task/preparePackageModules/output", () => ({
    input: ($states.result.Payload as any).input,
    items_found: ($states.result.Payload as any).items_found,
    all_modules_valid: ($states.result.Payload as any).all_modules_valid,
  }));
}

export function isPreparedModulesValid() {
  return slot("package:choice/isPreparedModulesValid", () =>
    (($states.input as any).all_modules_valid === true),
  );
}

export function computeManyOutput() {
  return slot("package:task/computeMany/output", () =>
    $states.result.Payload as any,
  );
}
```

## Why this example matters

This example captures the intended design of the DSL:

- **`task(...)`** models real side effects
- **`arguments(...)`** keeps AWS and Lambda payloads readable
- **`output(slot(...))`** encourages full output transformations instead of mixing inline fragments
- **`choice(...)`** makes branching explicit and semantic
- **`pass(...)`** is ideal for simple terminal responses
- **comments** document business intent directly in the flow

Use `awsSdkTask(...)` for singular AWS SDK operations and `lambdaInvoke(...)` for domain-heavy or collection-oriented preparation.

# Official example

This is the recommended shape of the DSL for a realistic business workflow.

- use **AWS SDK tasks** for singular infrastructure operations
- use **Lambda invoke tasks** for collection-oriented or domain-heavy preparation
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

- **`task(...)`** models real side effects in a generic way
- **`lambdaInvoke(...)`** makes Lambda tasks concise without changing the emitted ASL
- **`arguments(...)`** keeps AWS and Lambda payloads readable
- **`output(slot(...))`** encourages full output transformations instead of mixing inline fragments
- **`choice(...)`** makes branching explicit and semantic
- **`pass(...)`** is ideal for simple terminal responses
- **comments** document business intent directly in the flow

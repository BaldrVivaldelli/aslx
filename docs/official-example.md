Use `awsSdkTask(...)` for singular AWS SDK operations and `lambdaInvoke(...)` for domain-heavy or collection-oriented preparation.

# Official example

This is the recommended shape of the DSL for a realistic business workflow.

- use **AWS SDK tasks** for singular infrastructure operations
- use **Lambda invoke tasks** for collection-oriented or domain-heavy preparation
- use **Choice** for explicit control-flow decisions
- use **Pass** for simple terminal responses
- use **resultPath(...)** and **resultSelector(...)** to keep task outputs readable and stable

## Flow definition

```ts
export const packageComputationFlow = stateMachine("PackageComputationFlow")
  .queryLanguage("JSONata")
  .comment(
    "Loads a package, prepares and validates its modules, and computes the final result.",
  )
  .startWith(
    awsSdkTask("GetPackage")
      .comment("Loads the package definition from DynamoDB and attaches it under $.query_result.")
      .service("dynamodb")
      .action("getItem")
      .arguments({
        TableName: "${file(resources/index.json):tables.providers}",
        Key: packageKey(),
      })
      .resultPath("$.query_result"),
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
      .comment("Invokes the computation Lambda and stores a compact compute result under $.compute.")
      .functionName("${file(resources/index.json):cross_lambdas.methods}")
      .payload({
        computeMany: statesInputSlot(),
      })
      .resultSelector({
        payload: lambdaPayloadSlot(),
        source: lambdaExecutedSource(),
      })
      .resultPath("$.compute")
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
```

## Supporting slots

```ts
export function statesInputSlot() {
  return slot("package:common/statesInput", () => $states.input as any);
}

export function packageKey() {
  return slot("package:task/getPackage/key", () => $states.input.pk_sk as any);
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

export function lambdaPayloadSlot() {
  return slot("package:task/computeMany/resultSelectorPayload", () =>
    $states.result.Payload as any,
  );
}

export function lambdaExecutedSource() {
  return slot("package:task/computeMany/resultSelectorSource", () => "lambda_invoke");
}
```

## Why this example matters

This example captures the intended design of the DSL:

- **`awsSdkTask(...)`** keeps singular infrastructure reads close to the native integration shape
- **`lambdaInvoke(...)`** makes Lambda tasks concise without changing the emitted ASL
- **`resultPath(...)`** preserves the incoming state while attaching infrastructure results
- **`resultSelector(...) + resultPath(...)`** produce compact downstream business fields
- **`output(slot(...))`** remains the best tool when a task should fully reshape the state
- **`choice(...)`** makes branching explicit and semantic
- **comments** document business intent directly in the flow

## Why `GetPackage` uses `resultPath(...)`

`GetPackage` is an infrastructure read. The next step still needs the existing request state, so attaching the DynamoDB result under `$.query_result` is cleaner than replacing the full output.

## Why `PreparePackageModules` uses `output(...)`

This task is not just attaching an integration result. It is preparing a new business state for the flow. That is exactly where `output(...)` is a better semantic fit.

## Why `ComputeMany` uses `resultSelector(...) + resultPath(...)`

The Lambda result likely contains more than the flow should carry forward. Selecting only the compact business-facing fields keeps the downstream control flow stable and readable.


## Official Map example: validate modules

When you already have a list of items in your request payload and you need to run the **same workflow for each item**, prefer `map(...)`.

The repository includes an end-to-end example named **`validateModulesMapFlow`** (see `example/infra.ts`).

It shows a “business-shaped” Map:

- `Items` is driven by a JSONata slot (`modulesItemsSlot()`)
- `ItemSelector` lifts `$states.context.Map.Item.{Index,Value}` into each iteration input
- the per-item workflow calls a Lambda and returns a **compact per-item object**
- the outer flow uses `choice(...)` + condition combinators to decide whether to proceed

```ts
export const validateModulesMapFlow = stateMachine("ValidateModulesMapFlow")
  .queryLanguage("JSONata")
  .comment("Validates modules with Map + Lambda per item, then routes based on aggregated validity.")
  .startWith(
    map("ValidateModules")
      .items(modulesItemsSlot())
      .itemSelector({
        index: modulesMapItemIndexSlot(),
        module: modulesMapItemValueSlot(),
        mode: modulesValidationMode(),
        source: modulesValidationSource(),
      })
      .maxConcurrency(20)
      .itemProcessor(
        subflow(
          lambdaInvoke("ValidateOneModule")
            .functionName("${file(resources/index.json):cross_lambdas.validate_module}")
            .payload({
              index: moduleIterationIndexSlot(),
              module: moduleIterationModuleSlot(),
              mode: moduleIterationModeSlot(),
              source: moduleIterationSourceSlot(),
            })
            .resultSelector({
              index: moduleIterationIndexSlot(),
              module: moduleIterationModuleSlot(),
              valid: validateOneModuleValidSlot(),
              errors: validateOneModuleErrorsSlot(),
            })
            .resultPath("$.validation"),
        ).then(
          pass("ReturnModuleValidation")
            .content(moduleIterationValidationOutput())
            .end(),
        ),
      )
      .resultPath("$.module_validations"),
  )
  .then(
    choice("AreModulesValid")
      .whenTrue(
        all(
          areAllModulesValid(),
          any(
            eq(modulesValidationMode(), "strict"),
            eq(modulesValidationSource(), "manual"),
          ),
          neq(modulesValidationSource(), "legacy"),
        ),
        "PersistValidatedModules",
      )
      .otherwise("RejectInvalidModules"),
  );
```

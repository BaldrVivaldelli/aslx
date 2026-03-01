# Task Result Controls

`task(...)`, `lambdaInvoke(...)`, and `awsSdkTask(...)` now support the most important Step Functions result-shaping controls:

- `resultSelector(...)`
- `resultPath(...)`
- `timeoutSeconds(...)`
- `heartbeatSeconds(...)`

These controls make the DSL much more useful for real business workflows because they let you keep the incoming state, select only the fields you care about from an integration result, and place that result exactly where the next steps expect it.

## Mental model

Treat a task in four layers:

1. `arguments(...)` - the request sent to the integration target
2. `resultSelector(...)` - a projection over the raw integration result
3. `resultPath(...)` - where the selected result lands in the current state
4. `output(...)` - a full replacement of the task output when you truly want to reshape everything

That gives this rule of thumb:

- use `resultPath(...)` when you want to preserve the current state and attach a new result under a field
- use `resultSelector(...) + resultPath(...)` when the raw integration result is noisy and you only want the business fields needed downstream
- use `output(...)` when the task should produce a brand new state shape

## Order of operations

The intended reading order is:

- `arguments(...)` describes the integration request
- the integration runs
- `resultSelector(...)` trims or reshapes the raw result
- `resultPath(...)` inserts that result into the state
- `output(...)` can still replace the full output when that is the cleaner design

## Business pattern 1 - attach an infrastructure result without losing the request

When you fetch a single record from an AWS SDK integration, `resultPath(...)` is usually the cleanest choice.

```ts
awsSdkTask("GetPackage")
  .comment("Loads the package definition from DynamoDB while preserving the incoming request.")
  .service("dynamodb")
  .action("getItem")
  .arguments({
    TableName: "${file(resources/index.json):tables.providers}",
    Key: packageKey(),
  })
  .resultPath("$.query_result")
```

This is a good fit when later steps still need the original request plus the fetched record.

## Business pattern 2 - select only the business fields from a Lambda result

When a Lambda returns a large payload, use `resultSelector(...)` to keep only the downstream fields that matter.

```ts
lambdaInvoke("ComputeMany")
  .comment("Invokes the computation Lambda and stores a compact business result under $.compute.")
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
```

This is ideal when:

- the integration result contains transport metadata you do not want to carry forward
- the next `choice(...)` or `task(...)` should read from a stable business-shaped field like `$.compute`
- you want the rest of the flow to remain easy to read

## Business pattern 3 - use `output(...)` for full-state reshaping

`output(...)` is still the right tool when the task should define the next state shape explicitly.

```ts
lambdaInvoke("PreparePackageModules")
  .functionName("${file(resources/index.json):cross_lambdas.load_modules}")
  .payload({
    input: statesInputSlot(),
  })
  .output(preparePackageModulesOutput())
```

In that case, the task is acting as a business transformation step rather than as a simple integration whose result gets attached to the current state.

## Business pattern 4 - combine result controls with error handling

A good pattern is to keep success data and failure data in different parts of the state.

```ts
lambdaInvoke("ComputeWithRecovery")
  .functionName("${file(resources/index.json):cross_lambdas.methods}")
  .payload({
    computeMany: statesInputSlot(),
  })
  .resultSelector({
    payload: lambdaPayloadSlot(),
    source: lambdaExecutedSource(),
  })
  .resultPath("$.compute")
  .catchAll(
    subflow(
      pass("NormalizeComputeError")
        .content({ ok: false, reason: "compute_failed" }),
    ),
    { resultPath: "$.compute_error" },
  )
```

That keeps the state readable:

- `$.compute` for the happy path
- `$.compute_error` for recovery handling

## Example business workflow

The repo includes two representative examples:

- `PackageComputationFlow` - shows `resultPath(...)` on an AWS SDK fetch and `resultSelector(...) + resultPath(...)` on a Lambda compute task
- `MerchantOnboardingDecisionFlow` - shows a more business-shaped decision flow where a merchant profile is fetched, scored, and routed based on a compact selected decision object

## Validation rules

- `resultPath(...)` must be a non-empty JSONPath-like string such as `$.result`
- `timeoutSeconds(...)` must be a positive integer
- `heartbeatSeconds(...)` must be a positive integer
- when both are present, `heartbeatSeconds` must be smaller than `timeoutSeconds`

## Decision guide

Use this quick rule set:

- **Need to preserve the current state and add a result?** Use `resultPath(...)`
- **Need to trim the raw result before attaching it?** Use `resultSelector(...) + resultPath(...)`
- **Need a fully new task output shape?** Use `output(...)`
- **Need to store recovery details separately from success details?** Use `catch(...)` with its own `resultPath`

## Anti-patterns

Avoid these common mistakes:

- using `output(...)` for every task even when you only need to attach one field
- stuffing large raw Lambda payloads straight into the state when only two or three business fields are needed
- mixing `resultSelector(...)` and `output(...)` without a clear reason
- using vague result locations like `$.data` when `$.compute`, `$.decision`, or `$.query_result` would communicate intent better

# Task catch handlers

`catch(...)` is supported on `task(...)` and on sugars built on top of it such as `lambdaInvoke(...)` and `awsSdkTask(...)`.

Catchers can target:

- a **direct state name** (`"Recover"`)
- an **inline subflow** (`subflow(...).then(...)`)

## JSONata vs JSONPath catch fields

Catch field names differ by `QueryLanguage`:

- **JSONPath**: use `ResultPath`
- **JSONata**: use `Output` and/or `Assign` (with `$states.errorOutput`)

The validator will flag incompatible fields.

## Direct catch target

### JSONata example

```ts
import { lambdaInvoke } from "../dsl/lambda";
import { pass } from "../dsl/steps";
import { slot } from "../dsl/jsonata";

lambdaInvoke("ComputeMany")
  .functionName("ComputeArn")
  .payload({ input: slot("example:input", () => $states.input) })
  .catchAll(
    "RecoverComputeFailure",
    {
      assign: {
        compute_error: slot("example:err", () => $states.errorOutput),
      },
      output: slot("example:catch/output", () => ({
        ok: false,
        reason: "compute_failed",
        error: $states.errorOutput,
      })),
    },
  )
  .next("AfterComputeAttempt");

pass("RecoverComputeFailure").content({ ok: false }).next("AfterComputeAttempt");
```

### JSONPath example

```ts
import { rawState } from "../dsl/raw-state";

rawState("LegacyJsonPathTask", {
  QueryLanguage: "JSONPath",
  Type: "Task",
  Resource: "arn:aws:states:::lambda:invoke",
  Parameters: {
    FunctionName: "ComputeArn",
    Payload: {
      "input.$": "$.input",
    },
  },
  Catch: [
    {
      ErrorEquals: ["States.ALL"],
      ResultPath: "$.compute_error",
      Next: "RecoverComputeFailure",
    },
  ],
  Next: "AfterComputeAttempt",
});
```

## Inline catch subflows

Catch handlers can also point to `subflow(...)` targets.

```ts
import { lambdaInvoke } from "../dsl/lambda";
import { pass } from "../dsl/steps";
import { slot } from "../dsl/jsonata";
import { subflow } from "../dsl/subflow";

lambdaInvoke("ComputeWithRecovery")
  .functionName("ComputeArn")
  .payload({ input: slot("example:input", () => $states.input) })
  .catchAll(
    subflow(
      pass("NormalizeComputeError")
        .content({ ok: false, reason: "compute_failed" }),
    ).then(
      pass("AuditComputeFailure")
        .content({ audited: true, source: "catch" }),
    ),
    {
      assign: {
        compute_error: slot("example:err", () => $states.errorOutput),
      },
    },
  );
```

When a catch subflow omits explicit `next(...)` or `end()`, it auto-joins back into the next top-level step, using the same auto-wiring rule as inline `choice(...)` targets.

## Design notes

- `catch(...)` lives only on `task(...)`, `parallel(...)`, and `map(...)`
- direct state-name targets are ideal for shared recovery states
- inline `subflow(...)` targets are ideal for localized recovery paths

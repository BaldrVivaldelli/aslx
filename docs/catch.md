# Task catch handlers

`catch(...)` is supported on `task(...)` and on sugars built on top of it such as `lambdaInvoke(...)` and `awsSdkTask(...)`.

## Direct catch target

```ts
lambdaInvoke("ComputeMany")
  .functionName("${file(resources/index.json):cross_lambdas.methods}")
  .payload({
    computeMany: statesInputSlot(),
  })
  .catch(
    [
      "Lambda.ServiceException",
      "Lambda.TooManyRequestsException",
    ],
    "RecoverComputeFailure",
    { resultPath: "$.compute_error" },
  )
  .next("AfterComputeAttempt")
```

This emits:

```json
{
  "Type": "Task",
  "Resource": "arn:aws:states:::lambda:invoke",
  "Catch": [
    {
      "ErrorEquals": [
        "Lambda.ServiceException",
        "Lambda.TooManyRequestsException"
      ],
      "Next": "RecoverComputeFailure",
      "ResultPath": "$.compute_error"
    }
  ],
  "Next": "AfterComputeAttempt"
}
```

## Catch all

```ts
lambdaInvoke("ComputeMany")
  .functionName("ComputeFunctionArn")
  .payload({ computeMany: statesInputSlot() })
  .catchAll("RecoverComputeFailure", { resultPath: "$.compute_error" })
  .next("AfterComputeAttempt")
```

`catchAll(...)` is shorthand for `catch(["States.ALL"], ...)`.

## Inline catch subflows

Catch handlers can also point to `subflow(...)` targets.

```ts
lambdaInvoke("ComputeWithRecovery")
  .functionName("ComputeFunctionArn")
  .payload({ computeMany: statesInputSlot() })
  .catchAll(
    subflow(
      pass("NormalizeComputeError")
        .content({ ok: false, reason: "compute_failed" }),
    ).then(
      pass("AuditComputeFailure")
        .content({ audited: true, source: "catch" }),
    ),
    { resultPath: "$.compute_error" },
  )
```

When a catch subflow omits explicit `next(...)` or `end()`, it auto-joins back into the next top-level step, using the same auto-wiring rule as inline `choice(...)` targets.

## Design notes

- `catch(...)` lives only on `task(...)`
- `pass(...)` and `choice(...)` do not expose `catch(...)`
- direct state-name targets are ideal for shared recovery states
- inline `subflow(...)` targets are ideal for localized recovery paths
- `resultPath` is attached to the emitted ASL catcher entry

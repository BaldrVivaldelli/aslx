# Task data shaping

This repo is **JSONata-first**.

In Step Functions, the set of “data shaping” fields depends on the state’s `QueryLanguage`.

## JSONata tasks

In JSONata states you mainly use:

- `Arguments` (DSL: `.arguments(...)`) — the request sent to the integration
- `Assign` (DSL: `.assign(...)`) — store values in workflow variables
- `Output` (DSL: `.output(...)`) — define the state output

### Mental model

Think of a task in three layers:

1. **Arguments**: build the request from `$states.input` and variables
2. **Integration result**: available as `$states.result` (on success)
3. **Assign + Output**: compute variables and output

> Important: `Assign` and `Output` are evaluated in parallel in JSONata.
> If you need the same transformation in both, apply it in both.

### Example: keep input, attach result, and return a clean output

```ts
import { lambdaInvoke } from "../dsl/lambda";
import { slot } from "../dsl/jsonata";

const input = slot("example:input", () => $states.input);
const lambdaPayload = slot("example:lambdaPayload", () => $states.result.Payload);

lambdaInvoke("Compute")
  .functionName("ComputeArn")
  .payload({ request: input })
  .assign("compute", lambdaPayload)
  .output(
    slot("example:task/output", () => ({
      ok: true,
      request: $states.input,
      compute: $states.result.Payload,
    })),
  );
```

## JSONPath tasks

In JSONPath states, Step Functions uses the historical field set:

- `Parameters`
- `ResultSelector`
- `ResultPath`
- `OutputPath`

This DSL includes `resultSelector(...)` and `resultPath(...)` for convenience, but it does **not** model every JSONPath field (notably `Parameters` / `OutputPath`).

If you need full JSONPath authoring, prefer `rawState(...)`.

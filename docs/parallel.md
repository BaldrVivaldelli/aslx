# Parallel

`parallel(...)` models an ASL `Type: "Parallel"` state.

Use it when you need **fixed concurrent branches** that should all complete before the flow continues.

## Recommended shape (JSONata)

- keep each branch explicit with `branch(subflow(...))`
- use `Output` to shape the state output (and/or `Assign` to store variables)
- use `catch(...)` / `catchAll(...)` for recovery
- continue the top-level flow with `then(...)`

> In JSONata, the raw result of a `Parallel` state is available as `$states.result`.

## Example

```ts
import { parallel } from "../dsl/parallel";
import { subflow } from "../dsl/subflow";
import { lambdaInvoke } from "../dsl/lambda";
import { slot } from "../dsl/jsonata";

parallel("PrepareMerchantContext")
  .branch(
    subflow(
      lambdaInvoke("LoadMerchantProfile")
        .functionName("LoadMerchantProfileArn")
        .payload({ input: slot("example:input", () => $states.input) }),
    ),
  )
  .branch(
    subflow(
      lambdaInvoke("LoadRiskProfile")
        .functionName("LoadRiskProfileArn")
        .payload({ input: slot("example:input", () => $states.input) }),
    ),
  )
  .output(
    slot("example:parallel/output", () => ({
      // Branch results array
      branches: $states.result,
    })),
  );
```

## When to use `parallel(...)`

Use it for:

- concurrent context loading
- fixed fan-out / fan-in flows
- parallel enrichment steps

Do not use it for:

- simple sequential composition → use `subflow(...)`
- branching decisions → use `choice(...)`
- dynamic collection processing → use `map(...)`

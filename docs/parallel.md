# Parallel

`parallel(...)` models an ASL `Type: "Parallel"` state.

Use it when you need **fixed concurrent branches** that should all complete before the flow continues.

## Recommended shape

- keep each branch explicit with `branch(subflow(...))`
- use `resultPath(...)` to store branch results
- use `catch(...)` / `catchAll(...)` for recovery
- continue the top-level flow with `then(...)`

## Example

```ts
parallel("PrepareMerchantContext")
  .branch(
    subflow(
      lambdaInvoke("LoadMerchantProfile")
        .functionName("LoadMerchantProfileArn")
        .payload({ input: statesInputSlot() }),
    ),
  )
  .branch(
    subflow(
      lambdaInvoke("LoadRiskProfile")
        .functionName("LoadRiskProfileArn")
        .payload({ input: statesInputSlot() }),
    ),
  )
  .resultPath("$.parallel_results")
```

## When to use `parallel(...)`

Use it for:

- concurrent context loading
- fixed fan-out / fan-in flows
- parallel enrichment steps

Do not use it for:

- simple sequential composition → use `subflow(...)`
- branching decisions → use `choice(...)`
- dynamic collection processing → design `map(...)` later or encapsulate behind a Lambda

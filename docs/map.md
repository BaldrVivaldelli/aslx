# Map

`map(...)` models an ASL `Type: "Map"` state.

Use it when you need to **iterate over a collection** and run the same sub-workflow for each element.

## Dataset selection

Which field you use depends on `QueryLanguage`:

- **JSONata**: use `items(...)` (emits `Items`)
- **JSONPath**: use `itemsPath(...)` (emits `ItemsPath`)

This DSL is JSONata-first. If you need a full JSONPath Map (with `Parameters`, `OutputPath`, etc), use `rawState(...)`.

## Example (JSONata)

```ts
import { map } from "../dsl/map";
import { subflow } from "../dsl/subflow";
import { lambdaInvoke } from "../dsl/lambda";
import { slot } from "../dsl/jsonata";

map("ProcessItems")
  .items(slot("example:items", () => $states.input.items))
  .maxConcurrency(10)
  .itemProcessor(
    subflow(
      lambdaInvoke("ProcessOne")
        .functionName("ProcessOneArn")
        // `$states.input` here is the *iteration input*
        .payload({ item: slot("example:item", () => $states.input) })
        .end(),
    ),
  )
  .output(
    slot("example:map/output", () => ({
      // Map result array
      results: $states.result,
    })),
  );
```

## Notes

- `itemProcessor(...)` takes a `subflow(...)` (inline, no separate ASL file)
- if you omit `next(...)` / `end()` inside the processor, it auto-wires like any other sequence
- variable scope inside a Map iteration is isolated from other iterations

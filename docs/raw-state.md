# Raw states (escape hatch)

The DSL intentionally focuses on a tight, JSONata-first surface area.

When you need an ASL state type or field that the DSL does not model yet, use the **escape hatch**:

```ts
import { rawState } from "../dsl/raw-state";
```

`rawState(name, asl)` lets you embed an ASL state body **as-is**.

## Example: `Wait`

```ts
rawState("Wait5Seconds", {
  Type: "Wait",
  Seconds: 5,
})
```

## Example: terminal `Succeed`

```ts
rawState("Done", {
  Type: "Succeed",
})
```

## Example: JSONPath-only fields

If you need JSONPath-only fields (like `Parameters` or `OutputPath`) you can author them directly:

```ts
rawState("LegacyJsonPathTask", {
  QueryLanguage: "JSONPath",
  Type: "Task",
  Resource: "arn:aws:states:::lambda:invoke",
  Parameters: {
    FunctionName: "MyFnArn",
    Payload: {
      "request.$": "$.request",
    },
  },
  ResultPath: "$.lambda",
})
```

## JSONata slots inside raw states

You can embed `JsonataSlot` values anywhere inside the raw object.
The emitter will resolve them into `{% ... %}` templates.

That makes it possible to keep using the slot registry even when you need raw ASL.

## What gets validated?

Raw states are **opaque** by design.

The validator will still check:

- state name duplicates
- unknown transition targets
- unreachable states
- basic `Next`/`End` sanity for raw states

But it does **not** validate provider-specific fields inside the raw ASL body.

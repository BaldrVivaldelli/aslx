# QueryLanguage (JSONata vs JSONPath)

AWS Step Functions supports two query/transformation “modes”:

- **JSONPath** (the historical default)
- **JSONata** (newer, with `Arguments`, `Output`, and variables via `Assign`)

This repo is **JSONata-first**.

## Top-level `QueryLanguage`

Set it on the state machine builder:

```ts
import { stateMachine } from "../dsl/state-machine";

export const flow = stateMachine("MyFlow")
  .queryLanguage("JSONata")
  // ...
  ;
```

## State-level `QueryLanguage`

Step Functions also supports a **state-level** `QueryLanguage` field.

This is useful for incremental migration:

- Keep the state machine `QueryLanguage: "JSONPath"`
- Opt-in individual states to JSONata with `QueryLanguage: "JSONata"`

In the DSL, you can set it per state:

```ts
import { stateMachine } from "../dsl/state-machine";
import { pass } from "../dsl/steps";

export const mixed = stateMachine("Mixed")
  .queryLanguage("JSONPath")
  .startWith(
    pass("JsonataPass")
      .queryLanguage("JSONata")
      .content({ ok: true })
      .end(),
  );
```

### Important constraint

AWS does **not** allow mixing JSONPath states inside a JSONata state machine.

So:

- ✅ Top-level JSONPath + some states JSONata
- ❌ Top-level JSONata + some states JSONPath

The validator enforces this rule.

## What changes between JSONata and JSONPath states?

Very roughly:

- **JSONata states**: use `Arguments` + `Output` (+ `Assign` for variables)
- **JSONPath states**: use `Parameters`/`ResultSelector`/`ResultPath`/`OutputPath` (+ `Assign` as JSONPath payload template)

This repo intentionally models the **JSONata field set** well.
If you need JSONPath-only fields that are not modeled yet (like `Parameters` or `OutputPath`), use `rawState(...)`.

## Note on Map / Parallel sub-workflows

Map `ItemProcessor` and Parallel `Branches` are nested workflows.
Their *states* inherit the **state machine query language**, not the outer Map/Parallel state’s `QueryLanguage`.

If you override the Map/Parallel state to JSONata in a JSONPath machine, you still need to opt-in states inside the processor/branches explicitly.

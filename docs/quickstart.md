# Quickstart

This is a tiny, copy-pasteable tour of **ASLX**.

Package name: `aslx`

You’ll write TypeScript builders (`pass`, `choice`, `stateMachine`) and JSONata *slots* (`slot(...)`), then emit an AWS Step Functions **ASL** definition.

The `stateMachine(...)` builder can also set top-level ASL metadata like `QueryLanguage` and `Comment`.

If you publish or consume the package through npm, the intended package name is `aslx`.

---

## 0) Compile slots from TypeScript

From the repo root:

```bash
npm i
npx tsx compiler/compile-jsonata.ts example/infra.ts --out build/slots.json
```

The compiler extracts every `slot("...")` / `toJsonata(..., __slot("..."))` call in your entry file and writes JSONata strings to `build/slots.json`.

---

## 1) Pass + Slot

A slot is a *named JSONata expression* authored in TypeScript.

```ts
import { slot, $states } from "../dsl/jsonata";

export function exampleSlot() {
  return slot("example:Validate/param:validationExpr", () => {
    const body = $states.input.body;

    return {
      ok: true,
      body,
    };
  });
}
```

Use it in a `Pass`:

```ts
import { pass } from "../dsl/steps";

export const validateInput = pass("ValidateInput")
  .assign("validation", exampleSlot())
  .content({ ok: true })
  .next("PersistData")
  .build();
```

**Mental model**:
- `.assign(k, slot)` writes **Assign** (variables)
- `.content(x)` writes **Output** (result)

---

## 2) Choice + inline Pass targets

Inline targets make small flows very readable:

```ts
import { choice } from "../dsl/choice";
import { pass } from "../dsl/steps";

export const decide = choice("IsValid")
  .whenTrue(
    isValidationOk(),
    pass("PersistData").content({ status: "persisted" }),
  )
  .otherwise(
    pass("FailValidation").content({ ok: false, reason: "validation_failed" }),
  );
```

You can attach that to a graph with `stateMachine(...)`.

---

## 3) Choice + subflow targets + nested choice + join

When a branch needs multiple steps (or another decision), use `subflow(...)`.

```ts
import { stateMachine } from "../dsl/state-machine";
import { pass } from "../dsl/steps";
import { choice } from "../dsl/choice";
import { subflow } from "../dsl/subflow";

export const flow = stateMachine("ExampleFlow")
  .startWith(
    pass("ValidateInput")
      .assign("validation", exampleSlot())
      .content({ ok: true }),
  )
  .then(
    choice("RouteValidation")
      .whenTrue(
        isValidationOk(),
        subflow(
          pass("PersistData").content({ status: "persisted" }),
        ).then(
          choice("ShouldAudit")
            .whenTrue(
              shouldAudit(),
              pass("AuditSuccess").content({ audit: "success" }),
            )
            .otherwise(
              pass("SkipAudit").content({ audit: "skipped" }),
            ),
        ),
      )
      .otherwise(
        subflow(
          pass("FailValidation").content({ ok: false, reason: "validation_failed" }),
        ).then(
          pass("AuditFailure").content({ audit: "failure" }),
        ),
      ),
  )
  // Join point: both branches will be auto-wired to this state
  .then(
    pass("AfterDecision").content({ joined: true }),
  );
```

**Auto‑wiring rules (TL;DR)**
- If a `Pass` has no `.next(...)`/`.end()`, the graph builder links it to the next state in the top‑level sequence.
- For `choice(...)` targets:
  - if you pass an inline `pass(...)` or a `subflow(...)` without explicit edges, the builder wires the *end* of that target to the next top‑level state (the “join”).
  - explicit `.next(...)`/`.end()` always wins.

---


## 4) Top-level metadata: QueryLanguage + Comment

If you want the emitted ASL to carry top-level metadata, set it on the `stateMachine(...)` builder:

```ts
import { stateMachine } from "../dsl/state-machine";
import { pass } from "../dsl/steps";
import { slot, $states } from "../dsl/jsonata";

function echoOutput() {
  return slot("example:Echo/output", () => ({
    body: $states.input as any,
    statusCode: 200,
  }));
}

export const echoFlow = stateMachine("EchoFlow")
  .queryLanguage("JSONata")
  .comment("Echoes the input back")
  .startWith(
    pass("Echo")
      .content(echoOutput())
      .end(),
  );
```

That emits the same semantics as a top-level ASL definition with:

- `QueryLanguage: "JSONata"`
- `Comment: "Echoes the input back"`
- `StartAt: "Echo"`

For complex `Pass` outputs, prefer returning the full output object from a single slot instead of mixing lots of inline expression fragments per field.

## Emitting ASL

If you already have compiled slots (a map from slotId -> JSONata string):

```ts
import { emitStateMachine } from "../compiler/emit-asl";

const slots = require("../build/slots.json");
const definition = emitStateMachine(flow.build(), slots);
```

For deeper semantics, naming rules, and pitfalls, read:
- [DSL semantics](./dsl-semantics.md)

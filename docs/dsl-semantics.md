# DSL semantics

## Purpose

**ASLX** is an authoring layer for AWS Step Functions built in TypeScript.

The intended npm package name is `aslx`.

It separates two concerns:

- authoring JSONata expressions in TypeScript
- authoring state-machine topology with small builders

That split is intentional. A JSONata expression is not the same thing as a Step Functions state, and a nested authoring helper is not the same thing as an AWS native state type.

## Core mental model

Use this as the default interpretation of the DSL:

- `slot(...)` = expression
- `pass(...)` = state
- `choice(...)` = decision
- `subflow(...)` = inline mini-graph used inside a decision target
- `stateMachine(...)` = whole graph

If you keep that model in mind, the API stays easy to read.

## Glossary

### `slot(id, fn)`

Defines a compiled JSONata expression by writing normal TypeScript.

```ts
const isValidationOk = () =>
  slot("example:choice/isValidationOk", () => {
    const states = $states as { input: { validation?: { valid?: boolean } } };

    return (
      exists(states.input.validation) &&
      states.input.validation.valid === true
    );
  });
```

A slot is a reusable expression reference. It is not a state node.

Use it when you need:

- `Pass.Output`
- `Pass.Assign`
- `Choice.Condition`

### `pass(name)`

Builds an AWS Step Functions `Pass` state.

```ts
pass("ValidateInput")
  .assign("validation", exampleSlot())
  .content({ ok: true })
  .next("PersistData");
```

Use `pass(...)` when you want a named state in the emitted ASL.

### `choice(name)`

Builds an AWS Step Functions `Choice` state.

```ts
choice("IsValid")
  .whenTrue(isValidationOk(), "PersistData")
  .otherwise("FailValidation");
```

Use `choice(...)` when routing depends on a boolean condition.

### `subflow(...)`

Defines an inline sequence of authoring nodes that can be embedded under a `choice(...)` target.

```ts
subflow(
  pass("PersistData").content({ status: "persisted" }),
).then(
  pass("AuditSuccess").content({ audit: "success" }),
)
```

A `subflow(...)` is an authoring concept. It is not emitted as a distinct AWS state type.

### `stateMachine(name)`

Builds the top-level graph.

```ts
stateMachine("ExampleFlow")
  .startWith(pass("ValidateInput"))
  .then(choice("IsValid").whenTrue(isValidationOk(), "PersistData"))
  .then(pass("AfterDecision"));
```

Use `stateMachine(...)` to express the main linear skeleton of the workflow.

## DSL to ASL mapping

This is the most important semantic table in the DSL.

| DSL construct | Meaning in authoring | ASL result |
| --- | --- | --- |
| `slot(...)` | JSONata expression reference | compiled JSONata string |
| `pass(name)` | named Pass state | `Type: "Pass"` |
| `.content(...)` | visible result of the Pass | `Output` |
| `.assign(...)` / `.assigns(...)` | derived variables | `Assign` |
| `choice(name)` | named Choice state | `Type: "Choice"` |
| `.whenTrue(...)` / `.whenFalse(...)` | branch predicates | `Choices[].Condition` |
| `.otherwise(...)` | fallback branch | `Default` |
| `subflow(...)` | inline mini-graph | flattened into normal named states |
| `stateMachine(name)` | top-level workflow | `{ StartAt, States }` |

## Why `subflow` is the preferred term

The older name `branch(...)` is easy to confuse with AWS Step Functions `Parallel` states, which use the official word `Branches`.

That confusion is expensive because it makes readers wonder whether:

- the DSL is modeling a `Parallel` state
- the builder changes execution semantics
- the author is introducing concurrency

None of those are true here.

`subflow(...)` is more accurate because it means:

- an inline sequence
- embedded under another node
- flattened later into regular named states

For compatibility, `branch(...)` can remain as an alias, but the public naming should prefer `subflow(...)`.

## `pass(...)` semantics

### `.content(...)`

Maps to `Pass.Output`.

Use it for the visible payload produced by the state.

```ts
pass("PersistData").content({ status: "persisted" })
```

### `.assign(...)` and `.assigns(...)`

Map to `Pass.Assign`.

Use them for internal derived values that should remain in scope without overloading the main output payload.

```ts
pass("ValidateInput")
  .assign("validation", exampleSlot())
  .content({ ok: true })
```

This distinction keeps the DSL clear:

- `content` answers: what does this state produce?
- `assign` answers: what helper values should remain available?

### `.next(...)`

Defines an explicit edge to the next state.

Use it when you want to override auto-wiring.

### `.end()`

Marks the state as terminal.

Use it when the state should not reconnect to the next step.

## `choice(...)` semantics

### `.whenTrue(slot, target)`

Routes when the predicate evaluates to `true`.

```ts
choice("IsValid")
  .whenTrue(isValidationOk(), "PersistData")
```

### `.whenFalse(slot, target)`

Routes when the predicate evaluates to `false`.

Internally this is modeled as `not(slot)`.

```ts
choice("IsInvalid")
  .whenFalse(isValidationOk(), "FailValidation")
```

### `.when(slot, target)`

Lower-level form for advanced cases.

Prefer `whenTrue(...)` and `whenFalse(...)` for public examples because they are easier to read.

### `.otherwise(target)`

Defines the default branch.

If omitted, the graph builder may fall through to the following outer step.

## Valid target kinds in `choice(...)`

A choice target can be one of three things.

### 1. Existing state name

```ts
choice("IsValid")
  .whenTrue(isValidationOk(), "PersistData")
  .otherwise("FailValidation")
```

Use this when the destination already exists elsewhere in the graph.

### 2. Inline single state

```ts
choice("IsValid")
  .whenTrue(
    isValidationOk(),
    pass("PersistData").content({ status: "persisted" }),
  )
  .otherwise(
    pass("FailValidation").content({ ok: false }),
  )
```

Use this when each branch is exactly one state.

### 3. Inline subflow

```ts
choice("IsValid")
  .whenTrue(
    isValidationOk(),
    subflow(
      pass("PersistData").content({ status: "persisted" }),
    ).then(
      pass("AuditSuccess").content({ audit: "success" }),
    ),
  )
  .otherwise(
    subflow(
      pass("FailValidation").content({ ok: false }),
    ).then(
      pass("AuditFailure").content({ audit: "failure" }),
    ),
  )
```

Use this when a branch needs multiple steps.

## Nested decisions inside subflows

Nested decision trees are valid.

```ts
choice("RouteValidation")
  .whenTrue(
    isValidationOk(),
    subflow(
      pass("PersistData").content({ status: "persisted" }),
    ).then(
      choice("ShouldAuditSuccess")
        .whenTrue(
          isValidationOk(),
          subflow(
            pass("AuditSuccess").content({ audit: "success" }),
          ).then(
            pass("PublishSuccess").content({ publish: "success" }),
          ),
        )
        .otherwise(
          pass("SkipSuccessAudit").content({ audit: "skipped" }),
        ),
    ),
  )
  .otherwise("FailValidation");
```

The builder flattens this into standard named states and reconnects terminal nodes when possible.

## Auto-wiring rules

The builder supports conservative auto-wiring to keep authoring compact.

### Top-level sequence

In a `stateMachine(...)` sequence:

- a `Pass` without `.next(...)` or `.end()` goes to the following step
- a `Choice` without `.otherwise(...)` falls through to the following step

### Inline target state

If a `choice(...)` target is an inline `pass(...)` and that pass does not define `.next(...)` or `.end()`, it reconnects to the next outer step.

### Inline subflow

If a `choice(...)` target is a `subflow(...)`, terminal nodes inside that subflow reconnect to the next outer step unless they explicitly define `.next(...)` or `.end()`.

### Explicit transitions always win

If you define `.next(...)`, `.end()`, or `.otherwise(...)`, the builder respects that explicit transition and does not auto-wire over it.

## Naming conventions

Recommended naming helps the emitted graph stay readable.

### State names

Use verbs or short decision phrases.

Good examples:

- `ValidateInput`
- `PersistData`
- `FailValidation`
- `ShouldAudit`
- `PublishSuccess`

Avoid vague names like:

- `Step1`
- `NodeA`
- `Thing`
- `Choice1`

### Slot ids

Prefer namespaced ids.

```ts
slot("example:choice/isValidationOk", () => ...)
slot("package:validate/output", () => ...)
slot("merchant:onboarding/shouldAudit", () => ...)
```

This helps avoid collisions and keeps generated artifacts easier to inspect.

### Public examples

Prefer the high-level forms in docs and examples:

- `whenTrue(...)`
- `whenFalse(...)`
- `subflow(...)`

Keep lower-level APIs like `when(...)` and legacy aliases like `branch(...)` for advanced or compatibility-oriented cases.

## Good patterns

### Single-step decision targets

```ts
choice("IsValid")
  .whenTrue(
    isValidationOk(),
    pass("PersistData").content({ status: "persisted" }),
  )
  .otherwise(
    pass("FailValidation").content({ ok: false }),
  )
```

### Multi-step decision targets

```ts
choice("IsValid")
  .whenTrue(
    isValidationOk(),
    subflow(
      pass("PersistData").content({ status: "persisted" }),
    ).then(
      pass("AuditSuccess").content({ audit: "success" }),
    ),
  )
  .otherwise("FailValidation")
```

### Clear separation between output and derived values

```ts
pass("ValidateInput")
  .assign("validation", exampleSlot())
  .content({ ok: true, source: "ValidateInput" })
```

## Anti-patterns

### Treating `slot(...)` as if it were a state

Bad:

```ts
stateMachine("Flow").startWith(isValidationOk())
```

Why it is bad: a slot is only an expression reference, not a graph node.

### Using `subflow(...)` as if it were a top-level state type

Bad:

```ts
stateMachine("Flow")
  .startWith(subflow(pass("A")))
```

Why it is bad: `subflow(...)` is intended as an inline target under `choice(...)`, not as a replacement for the top-level graph builder.

### Hiding domain meaning in generic names

Bad:

```ts
choice("Choice1")
  .whenTrue(flag(), "Step2")
```

Better:

```ts
choice("IsValid")
  .whenTrue(isValidationOk(), "PersistData")
```

## Compatibility notes

- `branch(...)` may continue to exist as a compatibility alias.
- Public documentation should prefer `subflow(...)`.
- `subflow(...)` does not imply parallelism.
- A future `parallel(...)` builder should use AWS language directly and model `Branches` explicitly.

## Practical decision guide

If you are unsure which construct to use, default to this:

- need a reusable expression -> `slot(...)`
- need a named state -> `pass(...)`
- need conditional routing -> `choice(...)`
- need more than one inline step under a decision -> `subflow(...)`
- need the full workflow skeleton -> `stateMachine(...)`

## Summary

This DSL works best when its concepts stay narrow.

- expressions are `slot(...)`
- states are `pass(...)`
- decisions are `choice(...)`
- inline branch bodies are `subflow(...)`
- the outer graph is `stateMachine(...)`

That narrowness is what keeps the authoring model readable while still compiling to normal Step Functions ASL.


## State machine metadata

`stateMachine(name)` represents the top-level ASL document. Besides graph wiring, it can also carry top-level metadata:

- `.queryLanguage("JSONata")` -> emits `QueryLanguage: "JSONata"`
- `.comment("...")` -> emits top-level `Comment`

Example:

```ts
stateMachine("EchoFlow")
  .queryLanguage("JSONata")
  .comment("Echoes the input back")
  .startWith(
    pass("Echo")
      .content(echoOutput())
      .end(),
  );
```

This is intentionally a concern of the top-level graph builder, not of `pass(...)` or `choice(...)`.

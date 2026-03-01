# Choice condition helpers

The DSL supports composable condition helpers on top of compiled JSONata slots.

## Supported helpers

Base helpers:

- `not(slot)`
- `and(slotA, slotB, ...)`
- `or(slotA, slotB, ...)`
- `eq(left, right)`
- `neq(left, right)`

Semantic sugar:

- `all(conditionA, conditionB, ...)`
- `any(conditionA, conditionB, ...)`

Where `left` and `right` can be either:

- a compiled slot
- a JSON literal (`string`, `number`, `boolean`, `null`)

## Example

```ts
choice("RouteComposedValidation")
  .whenTrue(
    all(
      isValidationOk(),
      any(
        eq(validationMode(), "strict"),
        eq(validationSource(), "manual"),
      ),
      neq(validationSource(), "legacy"),
    ),
    "PersistComposedValidation",
  )
  .otherwise("RejectComposedValidation")
```

This emits a Choice condition equivalent to:

```jsonata
(
  ($states.input.validation.valid = true)
  and
  (
    ($states.input.validation.mode = "strict")
    or
    ($states.input.validation.source = "manual")
  )
  and
  ($states.input.validation.source != "legacy")
)
```

## Design intent

These helpers intentionally do **not** create additional compiled slots.
Instead, they build synthetic condition expressions that are resolved by the emitter.

That keeps the model simple:

- base business expressions still live in `slot(...)`
- composition happens at the control-flow layer
- no extra compiler pass is needed for composed boolean expressions

## Guidance

Use these helpers when the branching rule is easier to read as a composition of smaller predicates.

Good examples:

- validation is OK **and** mode is strict
- source is manual **or** source is backoffice
- source is **not** legacy
- status equals `"ACTIVE"`

If a condition becomes too domain-heavy or too long, prefer extracting that logic into a dedicated `slot(...)` and composing at a higher level.

## Recommended v1 condition set

The recommended boolean-composition surface for the current DSL is:

- `eq(...)`
- `neq(...)`
- `not(...)`
- `and(...)`
- `or(...)`
- `all(...)`
- `any(...)`

This keeps the language expressive without turning it into a full query library.

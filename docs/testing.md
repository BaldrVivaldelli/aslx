# Testing

The project uses golden snapshot tests to protect two critical compiler outputs:

- `slots.json`
- emitted state machine definitions under `machines/*.json`

## Run the test

```bash
npm run test:golden
```

This command:

1. recompiles slots into a temporary directory
2. emits all exported state machines into a temporary directory
3. compares the generated files against versioned snapshots under `testdata/golden/`

## Update snapshots

If you intentionally changed the compiler output, refresh the snapshots with:

```bash
npm run test:golden:update
```

## Snapshot layout

```text
testdata/
  golden/
    slots.json
    machines/
      echo-flow.json
      example-flow.json
      ...
```

## When to update snapshots

Update them only when the generated output changed **on purpose**.

Typical examples:

- a new state machine export was added
- the normalizer changed how transitions are auto-wired
- the emitter changed the emitted ASL shape
- the JSONata compiler changed the compiled slot output

If snapshots changed unexpectedly, inspect the diff before updating them.


## Negative validator tests

Run the validator regression suite with:

```bash
npm run test:validator:negative
```

This suite covers intentionally invalid machines and asserts both validation issue codes and human-readable error fragments. It helps prevent regressions in normalization and semantic validation.

## Negative slot compiler tests

Run the slot compiler negative suite with:

```bash
npm run test:compiler:negative
```

This suite feeds intentionally invalid `slot(...)` fixtures into the real JSONata compiler and asserts that it fails with clear, stable error messages.

Current coverage includes:

- optional chaining
- `let` declarations inside slots
- object spread
- nullish coalescing
- unbound identifiers
- malformed `slot(...)` calls without a slot id


## Choice condition helper tests

Run the composed condition helper suite with:

```bash
npm run test:conditions
```

This suite verifies that `and(...)`, `or(...)`, `all(...)`, `any(...)`, `eq(...)`, `neq(...)`, and `whenFalse(...)` render the expected JSONata conditions without introducing extra compiled slots, and that empty helper calls fail fast.

## Task catch handler tests

Run the task catch suite with:

```bash
npm run test:catch
```

This suite verifies that `catch(...)` and `catchAll(...)` emit ASL `Catch` entries correctly and that inline recovery `subflow(...)` targets auto-wire back into the following top-level step.


## Task result controls tests

Run `npm run test:task-controls` to validate emission of `resultSelector`, `resultPath`, `timeoutSeconds`, and `heartbeatSeconds`.


## Parallel tests

Run `npm run test:parallel` to validate `parallel(...)` emission, branch handling, and inline catch recovery.

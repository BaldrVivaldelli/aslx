# Map

The `map(...)` builder models an AWS Step Functions `Map` state using the modern `ItemProcessor` shape.

It is meant for "do the same workflow for every element" problems:

- validate many inputs
- enrich a list by calling a Lambda per item
- fan out N tasks, then collect an array of results

## API

```ts
map("ValidateItems")
  .items(itemsSlot())                // JSONata: emits `Items`
  // OR
  .itemsPath("$.items")              // JSONPath: emits `ItemsPath`

  .itemSelector({                    // emits `ItemSelector`
    index: mapItemIndexSlot(),
    value: mapItemValueSlot(),
  })

  .maxConcurrency(10)                // emits `MaxConcurrency`

  .itemProcessor(                    // emits `ItemProcessor`
    subflow(
      lambdaInvoke("ValidateOne")
        .functionName("ValidateArn")
        .payload({ input: statesInputSlot() }),
    ),
  )

  .resultPath("$.validated_items")   // emits `ResultPath`
  .catchAll("Fail", { resultPath: "$.map_error" })
```

## Items vs ItemsPath

Step Functions has two ways to select the dataset:

- `Items` (JSONata)
- `ItemsPath` (JSONPath)

This DSL supports both so you can keep the authoring style consistent with the rest of your state machine:

- If you're writing JSONata slots, prefer `items(...)`.
- If you're writing JSONPath machines, use `itemsPath(...)`.

The builder enforces that you cannot set both at once.

## ItemSelector and Map context

`ItemSelector` lets you shape the input of each iteration.

In Step Functions, the Map context object is accessible as:

- `$states.context.Map.Item.Index`
- `$states.context.Map.Item.Value`

A common pattern is to "lift" those context values into the per-iteration input via `itemSelector(...)`:

```ts
map("ValidateItems")
  .items(itemsSlot())
  .itemSelector({
    index: slot("example:map/itemIndex", () => $states.context.Map.Item.Index),
    value: slot("example:map/itemValue", () => $states.context.Map.Item.Value),
  })
  .itemProcessor(
    subflow(
      pass("Echo").content(slot("example:map/echo", () => $states.input)),
    ),
  )
```

That way, the states inside `ItemProcessor` can read from:

- `$states.input.index`
- `$states.input.value`

...without needing to access the Map context directly.

## MaxConcurrency

`maxConcurrency(n)` compiles to `MaxConcurrency`.

Useful rules of thumb:

- `0` = default (no explicit cap)
- `1` = sequential processing
- `>1` = bounded parallelism

## ItemProcessor

`itemProcessor(subflow(...))` defines the workflow executed for each item.

Just like parallel branches:

- the inner subflow is validated as an independent mini state machine
- missing `.next(...)` / `.end()` edges are auto-wired linearly
- `choice(...)` inside the processor works as expected

## Result controls

Just like `task(...)` and `parallel(...)`, `map(...)` supports:

- `resultSelector(...)`
- `resultPath(...)`

This lets you keep the original state and attach the array of per-item results under a stable business key.

Example:

```ts
map("ValidateItems")
  .items(itemsSlot())
  .itemProcessor(subflow(lambdaInvoke("ValidateOne").functionName("ValidateArn")))
  .resultPath("$.validated")
```

After this runs, downstream states can read from `$.validated`.

## Error handling

`map(...)` supports `.catch(...)` / `.catchAll(...)`.

Inline catch subflows are supported and will be auto-wired to the next outer step:

```ts
map("ValidateItems")
  .items(itemsSlot())
  .itemProcessor(subflow(pass("Noop").content({ ok: true })))
  .catchAll(
    subflow(pass("Recover").content({ ok: false })),
    { resultPath: "$.map_error" },
  )
```


## Business example: Validate modules

A realistic Map use-case is “validate a list of domain modules”, then make a decision based on the aggregated results.

See **`validateModulesMapFlow`** in `example/infra.ts`. It demonstrates:

- **`items(...)`** reading `modules` from the incoming request via `modulesItemsSlot()`
- **`itemSelector(...)`** lifting Map context + request metadata into each iteration input:
  - `$states.context.Map.Item.Index`
  - `$states.context.Map.Item.Value`
- An **`itemProcessor(subflow(...))`** that calls a Lambda per module and returns a compact per-item result
- **`resultPath("$.module_validations")`** so downstream states can read the array under a stable business key
- A `choice(...)` that composes conditions with `all(...)`, `any(...)`, `eq(...)`, and `neq(...)`

Minimal excerpt (full flow in `example/infra.ts`):

```ts
export const validateModulesMapFlow = stateMachine("ValidateModulesMapFlow")
  .queryLanguage("JSONata")
  .startWith(
    map("ValidateModules")
      .items(modulesItemsSlot())
      .itemSelector({
        index: modulesMapItemIndexSlot(),
        module: modulesMapItemValueSlot(),
        mode: modulesValidationMode(),
        source: modulesValidationSource(),
      })
      .maxConcurrency(20)
      .itemProcessor(
        subflow(
          lambdaInvoke("ValidateOneModule")
            .functionName("${file(resources/index.json):cross_lambdas.validate_module}")
            .payload({
              index: moduleIterationIndexSlot(),
              module: moduleIterationModuleSlot(),
              mode: moduleIterationModeSlot(),
              source: moduleIterationSourceSlot(),
            })
            .resultSelector({
              index: moduleIterationIndexSlot(),
              module: moduleIterationModuleSlot(),
              valid: validateOneModuleValidSlot(),
              errors: validateOneModuleErrorsSlot(),
            })
            .resultPath("$.validation"),
        ).then(
          pass("ReturnModuleValidation")
            .content(moduleIterationValidationOutput())
            .end(),
        ),
      )
      .resultPath("$.module_validations"),
  )
  .then(
    choice("AreModulesValid")
      .whenTrue(
        all(
          areAllModulesValid(),
          any(
            eq(modulesValidationMode(), "strict"),
            eq(modulesValidationSource(), "manual"),
          ),
          neq(modulesValidationSource(), "legacy"),
        ),
        "PersistValidatedModules",
      )
      .otherwise("RejectInvalidModules"),
  );
```

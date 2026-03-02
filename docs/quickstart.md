# Quickstart

This is a tiny, copy‑pasteable tour of the DSL.

You’ll write TypeScript builders (`pass`, `choice`, `stateMachine`) and JSONata *slots* (`slot(...)`), then emit an AWS Step Functions **ASL** definition.

The `stateMachine(...)` builder can also set top-level ASL metadata like `QueryLanguage` and `Comment`.

---

## 0) Compile slots from TypeScript

From the repo root:

```bash
npm i
npx tsx compiler/compile-jsonata.ts machines/index.ts --out build/slots.json
```

If you installed the published package (instead of running from this repo), use:

```bash
npx aslx compile machines/index.ts --out build/slots.json
# (long form: npx aslx compile-jsonata machines/index.ts --out build/slots.json)
# (see all commands: npx aslx --help)
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

## 2b) Choice condition helpers

When a branch rule reads better as a composition of smaller predicates, use `all(...)`, `any(...)`, `eq(...)`, `neq(...)`, and `not(...)`.

```ts
import { and, eq, or } from "../dsl/jsonata";

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
  .otherwise("RejectComposedValidation");
```

These helpers are resolved by the emitter and do not create extra compiled slots.

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
- [QueryLanguage (JSONata vs JSONPath)](./query-language.md)
- [Raw states (escape hatch)](./raw-state.md)

## Task examples

The DSL supports generic `task(...)` states, and also includes `lambdaInvoke(...)` as a focused convenience builder for Lambda integrations.

For singular infrastructure operations, keep the task close to the AWS integration shape:

```ts
task("GetPackage")
  .comment("Loads the package definition from DynamoDB.")
  .resource("arn:aws:states:::aws-sdk:dynamodb:getItem")
  .arguments({
    TableName: "${file(resources/index.json):tables.providers}",
    Key: packageKey(),
  })
  .output(getPackageOutput());
```

For Lambda integrations, prefer `lambdaInvoke(...)` over spelling out the integration ARN every time:

```ts
lambdaInvoke("PreparePackageModules")
  .comment("Resolves, normalizes, and validates the package modules through a domain Lambda.")
  .functionName("${file(resources/index.json):cross_lambdas.load_modules}")
  .payload({
    input: statesInputSlot(),
  })
  .output(preparePackageModulesOutput());
```

Use `retry(...)` for operational resilience on Lambda integrations:

```ts
lambdaInvoke("ComputeMany")
  .comment("Invokes the computation Lambda with the prepared input.")
  .functionName("${file(resources/index.json):cross_lambdas.methods}")
  .payload({
    computeMany: statesInputSlot(),
  })
  .output(computeManyOutput())
  .retry(lambdaServiceRetry())
  .end();
```

Prefer `output(...)` to return a clean business shape downstream:

```ts
lambdaInvoke("ComputeMany")
  .functionName("${file(resources/index.json):cross_lambdas.methods}")
  .payload({
    computeMany: statesInputSlot(),
  })
  .assign("compute", slot("quickstart:compute/result", () => $states.result.Payload))
  .output(
    slot("quickstart:compute/output", () => ({
      ok: true,
      compute: $states.result.Payload,
    })),
  )
  .timeoutSeconds(30)
  .heartbeatSeconds(10)
  .retry(lambdaServiceRetry());
```

---

## Official business workflow example

For the recommended end-to-end example using `task(...)`, `lambdaInvoke(...)`, `choice(...)`, top-level metadata, and task result controls, see [Official example](./official-example.md).

For details on `Arguments` / `Assign` / `Output`, see [Task data shaping](./task-controls.md).


## AWS SDK task sugar

```ts
awsSdkTask("GetPackage")
  .service("dynamodb")
  .action("getItem")
  .arguments({
    TableName: "${file(resources/index.json):tables.providers}",
    Key: packageKey(),
  })
  .output(getPackageOutput());
```

## Task catch handlers

`task(...)` and sugars built on top of it support recovery handlers through `catch(...)` and `catchAll(...)`.

```ts
lambdaInvoke("ComputeWithRecovery")
  .functionName("ComputeFunctionArn")
  .payload({
    computeMany: statesInputSlot(),
  })
  .catchAll(
    subflow(
      pass("NormalizeComputeError")
        .content({ ok: false, reason: "compute_failed" }),
    ).then(
      pass("AuditComputeFailure")
        .content({ audited: true, source: "catch" }),
    ),
    {
      assign: {
        compute_error: slot("quickstart:compute/error", () => $states.errorOutput),
      },
    },
  )
```

If the inline recovery subflow omits explicit edges, it auto-joins into the next top-level step, using the same auto-wiring rule as inline `choice(...)` targets.


## Parallel example

```ts
parallel("PrepareMerchantContext")
  .branch(subflow(lambdaInvoke("LoadMerchantProfile").functionName("...").payload({ input: statesInputSlot() })))
  .branch(subflow(lambdaInvoke("LoadRiskProfile").functionName("...").payload({ input: statesInputSlot() })))
  .output(slot("quickstart:parallel/output", () => ({ results: $states.result })))
```


## Map example

Use `map(...)` when you need to run the same workflow for each element and collect an array of results.

```ts
map("ValidateItems")
  .items(slot("quickstart:map/items", () => ($states as any).input.items))
  .itemSelector({
    index: slot("quickstart:map/itemIndex", () => ($states as any).context.Map.Item.Index),
    value: slot("quickstart:map/itemValue", () => ($states as any).context.Map.Item.Value),
  })
  .maxConcurrency(10)
  .itemProcessor(
    subflow(
      pass("EchoItem").content(slot("quickstart:map/echo", () => ($states as any).input)),
    ),
  )
  .output(slot("quickstart:map/output", () => ({ validated_items: $states.result })))
```

For a full business example, see `docs/map.md` and `validateModulesMapFlow` in `machines/index.ts`.

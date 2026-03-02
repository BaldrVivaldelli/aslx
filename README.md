# 🧠 TS → JSONata Compiler (SWC Edition)

Write **normal TypeScript** → get **pure JSONata** for AWS Step
Functions.

This project gives you a real production‑grade pipeline:

TS DSL ➜ SWC AST ➜ JSONata IR ➜ JSONata string ➜ (future) Rust ➜ YAML

------------------------------------------------------------------------

# ✨ Goals

-   ❌ No raw JSONata in infra code
-   ✅ TypeScript developer experience
-   ✅ Deterministic output
-   ✅ Hoisted reusable UDFs
-   ✅ Import system (named / default / namespace)
-   ✅ Zero Rust knowledge required for users

------------------------------------------------------------------------

# 🏗 Architecture

    infra.ts
       ↓
    SWC parser
       ↓
    AST → IR lowering
       ↓
    JSONata printer
       ↓
    slots.json
       ↓
    Serverless YAML (next step with Rust/WASM)

------------------------------------------------------------------------

# 📦 Project Structure

    dsl/
      jsonata.ts          → Authoring helpers + condition combinators
      steps.ts            → Pass state builder
      task.ts             → Task state builder (+ Lambda / AWS SDK sugars)
      choice.ts           → Choice state builder
      parallel.ts         → Parallel state builder
      map.ts              → Map state builder
      subflow.ts          → Inline subflows for choice targets
      raw-state.ts        → Escape hatch for raw ASL states
      state-machine.ts    → Top-level graph builder + top-level metadata

    docs/
      quickstart.md        → Small copy-pasteable examples
      dsl-semantics.md     → Naming and semantics guide
      query-language.md    → JSONata vs JSONPath (+ state-level overrides)
      raw-state.md         → Escape hatch for unsupported ASL fields/types
      official-example.md  → Recommended end-to-end business flow
      validation.md        → Semantic validation rules and pipeline
      choice-conditions.md → Condition helper reference for choice(...)
      catch.md             → Task catch handlers and recovery paths
      task-controls.md     → Arguments, Output, Assign, timeout, heartbeat
      parallel.md          → Parallel builder guide
      map.md               → Map builder guide

    compiler/
      compile-jsonata.ts        → Slot compiler
      normalize-state-machine.ts → Graph normalization
      validate-state-machine.ts  → Semantic validation
      build-machine.ts           → ASL emission CLI

    example/
      infra.ts            → Real usage
      lib/udfs.ts         → UDF exports

------------------------------------------------------------------------


# 📚 DSL documentation

- [Quickstart](docs/quickstart.md)
- [DSL semantics](docs/dsl-semantics.md)
- [QueryLanguage (JSONata vs JSONPath)](docs/query-language.md)
- [Raw states (escape hatch)](docs/raw-state.md)
- [Official example](docs/official-example.md)
- [Validation](docs/validation.md)
- [Choice condition helpers](docs/choice-conditions.md)
- [Task catch handlers](docs/catch.md)
- [Task data shaping](docs/task-controls.md)
- [Parallel](docs/parallel.md)
- [Map](docs/map.md)
- [AWS SDK tasks](docs/aws-sdk-task.md)
- [Publishing](docs/publishing.md)

Start here if you want the meaning of each builder and the naming rules:

This document explains:

- how top-level metadata like `QueryLanguage` and `Comment` is emitted

- the meaning of each builder and helper
- how each DSL concept maps to AWS Step Functions ASL
- why `subflow` is preferred over `branch`
- how auto-wiring works at the top level and inside inline decision targets
- naming conventions and practical examples
- common anti-patterns to avoid

------------------------------------------------------------------------

## What you will find in the guide

- **Concepts**: what is an expression, state, decision, inline subflow, and top-level graph
- **DSL -> ASL mapping**: how `content`, `assign`, `whenTrue`, and `otherwise` are emitted
- **Auto-wiring rules**: when omitted transitions are inferred and when explicit edges win
- **Naming conventions**: how to name states and slots so the graph stays readable
- **Examples and anti-patterns**: what to prefer in public docs and what to avoid

------------------------------------------------------------------------

# 🧑‍💻 How Developers Use It

``` ts
export const expr = toJsonata(() => {
  const body = $states.input.body;

  return {
    ok: true,
    alias: `ALIAS#${upper("visa")}`,
    note: foo("x"),
  };
}, __slot("pkg:validate"));
```

They write **TS only**.

------------------------------------------------------------------------

## 🗺️ Top-level ASL metadata

```ts
const flow = stateMachine("EchoFlow")
  .queryLanguage("JSONata")
  .comment("Echoes the input back")
  .startWith(
    pass("Echo")
      .content(echoOutput())
      .end(),
  );
```

This emits top-level ASL metadata while keeping `Pass` authoring focused on `Output` and `Assign`.

------------------------------------------------------------------------

# ⚙️ Install

## As an npm dependency

> If the unscoped name is taken in the registry, publish/install under a scope like `@your-org/aslx`.

```bash
npm i aslx
```

## From source (this repo)

```bash
npm install
```

------------------------------------------------------------------------

# ▶️ Compile

### Using the published CLI

```bash
npx aslx compile machines/index.ts
# (long form: npx aslx compile-jsonata machines/index.ts)
```

### From source

```bash
npx tsx compiler/compile-jsonata.ts machines/index.ts
```

------------------------------------------------------------------------

# 👀 Watch mode

### Using the published CLI

```bash
npx aslx compile machines/index.ts --out build/slots.json --watch
# (long form: npx aslx compile-jsonata machines/index.ts --out build/slots.json --watch)
```

### From source

```bash
npx tsx compiler/compile-jsonata.ts machines/index.ts --out build/slots.json --watch
```

------------------------------------------------------------------------


# 🛠 CLI

List available commands:

```bash
npx aslx --help
```

> Legacy binaries (`aslx-compile-jsonata`, etc.) are still available, but `aslx <command>` is recommended.

Short commands: `compile`, `build`, `validate`, `yml`  (legacy long names still work: `compile-jsonata`, `build-machine`, `validate-machine`, `build-yml`).

# 🧰 Build machines (ASL JSON)

```bash
# compile slots first
npx aslx compile machines/index.ts --out build/slots.json

# build machine definitions
npx aslx build machines/index.ts --slots build/slots.json --out-dir build/machines --graph
```

------------------------------------------------------------------------

# ✅ Validate machines

```bash
npx aslx validate machines/index.ts
```

------------------------------------------------------------------------

# 📝 Publishing

- [Publishing guide](docs/publishing.md)

------------------------------------------------------------------------

# 🧩 Supported TS Subset

## ✅ Expressions

-   objects

-   arrays

-   template strings

-   ternary

-   logical ops

-   === / !==

-   -   

## ✅ Array methods

``` ts
arr.map(x => ...)
arr.filter(x => ...)
reduce(arr, (acc, x) => ..., init)
```

## ✅ Computed access

``` ts
obj[key] → $lookup(obj,key)
```


# 🔀 Choice condition helpers

The DSL now supports composable condition helpers for `choice(...)`:

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

These helpers are resolved by the emitter rather than compiled as extra slots.
That keeps base expressions inside `slot(...)` and boolean composition at the control-flow layer.

------------------------------------------------------------------------

# ✅ Validation pipeline

``` bash
npm run validate:machine
npm run build:machine
npm run test:golden
npm run test:validator:negative
npm run test:compiler:negative
npm run test:conditions
npm run test:catch
```

- `validate:machine` checks graph correctness without writing ASL files
- `build:machine` validates first and only emits JSON when the graph is valid
- `test:golden` protects generated slots and machine JSON snapshots
- `test:validator:negative` protects semantic validation error coverage
- `test:compiler:negative` protects slot compiler subset errors and diagnostics
- `test:conditions` protects composed `choice(...)` helper rendering
- `test:catch` protects task catch handler emission and inline recovery auto-wiring

Validation currently checks:

- missing transition targets
- unreachable states
- duplicate state names
- invalid `StartAt`
- missing `Task.resource`
- conflicting `next` / `end` usage

------------------------------------------------------------------------

------------------------------------------------------------------------

# 🧠 UDF System

## Author

``` ts
export const foo = udf(() => "FOO");
export default udf((x) => `X#${x}`);
```

## Use

``` ts
import foo from "./lib"
import { bar } from "./lib"
import * as u from "./lib"

foo()
bar()
u.foo()
u.default()
```

## Output

Hoisted **alphabetically**:

``` jsonata
$bar := function(){...};
$foo := function($x){...};
$u__foo := function(){...};
```

------------------------------------------------------------------------

# 🧮 Built‑ins

Available for DX:

-   exists
-   keys
-   lookup
-   merge
-   append
-   count
-   upper
-   reduce

------------------------------------------------------------------------

# 🧯 Errors

Real file location:

    infra.ts:42:7 UDF 'foo' expects 1 args, got 0

------------------------------------------------------------------------

# 🎯 Why This Matters

This lets you:

-   Build a **Step Functions DSL in TS**
-   Generate JSONata safely
-   Plug a **Rust backend for YAML**
-   Ship a **real platform product**

Exactly your Osiris/Nave vision.

------------------------------------------------------------------------
## Task support

The project now includes a generic `task(...)` builder for aws-sdk tasks and `lambdaInvoke(...)` as focused sugar for Lambda Step Functions tasks. See `machines/index.ts` and `docs/quickstart.md` for concrete examples.

------------------------------------------------------------------------
## Golden tests

Use golden snapshot tests to lock down the emitted `slots.json` and `machines/*.json` artifacts.

```bash
npm run test:golden
```

If you intentionally changed the DSL, compiler, normalizer, or emitter and want to refresh the expected outputs:

```bash
npm run test:golden:update
```

Snapshots live under:

- `testdata/golden/slots.json`
- `testdata/golden/machines/*.json`

------------------------------------------------------------------------
## AWS SDK sugar

Use `awsSdkTask(...)` when you want to express an AWS SDK integration with `.service(...)` and `.action(...)` instead of spelling the full resource ARN manually.

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

------------------------------------------------------------------------
## Task data shaping

In JSONata-first workflows, prefer:

- `arguments(...)` → ASL `Arguments`
- `assign(...)` → ASL `Assign`
- `output(...)` → ASL `Output`

The DSL also supports operational controls like `timeoutSeconds(...)` and `heartbeatSeconds(...)`.

JSONPath-only fields like `ResultPath` / `ResultSelector` are supported for compatibility, but are validated as JSONPath-only.

See `docs/task-controls.md` for examples and rules.

------------------------------------------------------------------------
## Additional docs

- `docs/parallel.md`
------------------------------------------------------------------------
## Additional test scripts

- `npm run test:parallel`
------------------------------------------------------------------------

# 🔮 Next Steps

-   Rust WASM YAML emitter
-   Type‑aware "+" operator
-   Source maps
-   Serverless auto‑slot replacement
-   Language server for autocomplete

------------------------------------------------------------------------

# ❤️ Philosophy

TS is the **authoring language**

JSONata is the **execution language**

You own the **compiler layer**

That's the power move.
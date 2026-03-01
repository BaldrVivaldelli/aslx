# ASLX

A TypeScript DSL and compiler for JSONata-first AWS Step Functions authoring.

Package name: `aslx`

Write **normal TypeScript** and a small workflow DSL -> get **pure JSONata** slots and emitted **ASL** machines.

This project gives you a real production-grade pipeline:

TS DSL -> SWC AST -> JSONata IR -> JSONata string -> ASL machine JSON

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
      jsonata.ts          → Authoring helpers
      steps.ts            → Pass state builder
      choice.ts           → Choice state builder
      subflow.ts          → Inline subflows for choice targets
      state-machine.ts    → Top-level graph builder + top-level metadata

    docs/
      quickstart.md      → 4 small examples
      dsl-semantics.md    → Naming and semantics guide

    compiler/
      compile-jsonata.ts  → Slot compiler
      build-machine.ts    → ASL machine emitter

    example/
      infra.ts            → Real usage
      lib/udfs.ts         → UDF exports

------------------------------------------------------------------------


# 📚 DSL documentation

- [Quickstart](docs/quickstart.md)
- [DSL semantics](docs/dsl-semantics.md)

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

If you publish this package to npm, use:

```bash
npm install aslx
```

If you are working from source in this repo, keep using `npm install`.



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

From source:

``` bash
npm install
```

As an npm package name, this project is intended to publish as:

``` bash
npm install aslx
```

------------------------------------------------------------------------

# ▶️ Compile

``` bash
npx tsx compiler/compile-jsonata.ts example/infra.ts
```

------------------------------------------------------------------------

# 🏭 Build full state machines

``` bash
npm run build:machine
```

This does two things:

- compiles JSONata slots to `build/slots.json`
- emits every exported `stateMachine(...)` builder from `example/infra.ts` into `build/machines/*.json`

Example outputs:

- `build/machines/echo-flow.json`
- `build/machines/example-flow.json`
- `build/machines/example-flow-with-subflows.json`

------------------------------------------------------------------------

# 👀 Watch mode

``` bash
npx tsx compiler/compile-jsonata.ts example/infra.ts --out build/slots.json --watch
```

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

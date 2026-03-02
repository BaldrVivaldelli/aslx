#!/usr/bin/env node

// compiler/compile-jsonata.ts
// ESM + SWC: TypeScript "normal" -> JSONata embedded
// Features:
// - toJsonata(() => ..., __slot("id")) extraction
// - TS subset lowering to JSONata IR
// - UDFs hoisted alphabetically (includes named/default/namespace imports)
// - Recursive barrel resolution: export *, export {x} from, export default udf(...)
// - Namespace calls: u.foo(), u.default()
// - obj[k] sugar -> $lookup(obj, k)
// - map/filter/reduce lowering
// - '+' heuristic: numeric (+) vs stringy (&)
// - Arity checks for UDF calls
// - file:line:col errors (span -> line map)
// - CLI: --out <file> --watch

import fs from "node:fs";
import path from "node:path";
import { parseSync } from "@swc/core";
import { buildModuleGraph } from "./module-graph";

/** ---------------- IR ---------------- */
type KeyIR = { k: "Str"; v: string } | { k: "Expr"; e: ExprIR };

type ExprIR =
    | { k: "Null" }
    | { k: "Bool"; v: boolean }
    | { k: "Num"; v: number }
    | { k: "Str"; v: string }
    | { k: "Var"; name: string } // $name
    | { k: "Current" } // $
    | { k: "Path"; base: ExprIR; segs: string[] }
    | { k: "Arr"; items: ExprIR[] }
    | { k: "Obj"; entries: { key: KeyIR; value: ExprIR }[] }
    | { k: "Call"; fn: string; args: ExprIR[] }
    | {
        k: "Bin";
        op: "and" | "or" | "eq" | "neq" | "cat" | "add";
        a: ExprIR;
        b: ExprIR;
    }
    | { k: "Not"; e: ExprIR }
    | { k: "Ternary"; c: ExprIR; t: ExprIR; f: ExprIR }
    | { k: "Map"; arr: ExprIR; param: string; body: ProgramIR } // $map
    | { k: "Select"; arr: ExprIR; pred: ProgramIR } // arr[pred]
    | {
        k: "Reduce";
        arr: ExprIR;
        acc: string;
        param: string;
        init: ExprIR;
        body: ProgramIR;
    };

type BindingIR =
    | { kind: "Let"; name: string; expr: ExprIR }
    | { kind: "Fn"; name: string; params: string[]; body: ProgramIR };

type ProgramIR = { bindings: BindingIR[]; result: ExprIR };

/** ---------------- Source map (offset -> line/col) ---------------- */
class LineMap {
    private lineStarts: number[] = [0];
    constructor(private src: string) {
        for (let i = 0; i < src.length; i++) {
            if (src.charCodeAt(i) === 10) this.lineStarts.push(i + 1);
        }
    }
    pos(offset: number) {
        // rightmost lineStart <= offset
        let lo = 0,
            hi = this.lineStarts.length - 1;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (this.lineStarts[mid] <= offset) lo = mid + 1;
            else hi = mid - 1;
        }
        const line = Math.max(0, lo - 1);
        const col = offset - this.lineStarts[line];
        return { line: line + 1, col: col + 1 }; // 1-based
    }
}

function isIdent(n: any, name: string) {
    return n?.type === "Identifier" && n.value === name;
}

function mkFail(filePath: string, lineMap: LineMap) {
    return (node: any, msg: string): never => {
        const span = node?.span;
        if (span?.start != null) {
            const { line, col } = lineMap.pos(span.start);
            throw new Error(`${filePath}:${line}:${col} ${msg}`);
        }
        throw new Error(`${filePath} ${msg}`);
    };
}

/** ---------------- Builtins mapping (TS fn -> JSONata fn) ---------------- */
const BUILTINS: Record<string, string> = {
    exists: "$exists",
    keys: "$keys",
    lookup: "$lookup",
    merge: "$merge",
    append: "$append",
    type: "$type",
    count: "$count",
    upper: "$uppercase",
};

/** ---------------- Extraction: toJsonata calls ---------------- */
type Found = { slotId: string; fnNode: any; spanStart?: number };

function extractToJsonataCalls(
    source: string,
    fail: (n: any, m: string) => never,
): Found[] {
    const ast = parseSync(source, { syntax: "typescript", tsx: false, target: "es2022" });
    const found: Found[] = [];

    function visit(node: any) {
        if (!node || typeof node !== "object") return;

        if (node.type === "CallExpression") {
            const callee = node.callee;
            const isToJsonata =
                isIdent(callee, "toJsonata") ||
                (callee?.type === "MemberExpression" && isIdent(callee.property, "toJsonata"));
            const isSlot =
                isIdent(callee, "slot") ||
                (callee?.type === "MemberExpression" && isIdent(callee.property, "slot"));

            if (isToJsonata || isSlot) {
                const args = node.arguments ?? [];
                const fnArg = isSlot ? args[1]?.expression : args[0]?.expression;
                const slotArg = isSlot ? args[0]?.expression : args[1]?.expression;

                let slotId: string | null = null;
                if (
                    slotArg?.type === "CallExpression" &&
                    isIdent(slotArg.callee, "__slot") &&
                    slotArg.arguments?.[0]?.expression?.type === "StringLiteral"
                ) {
                    slotId = slotArg.arguments[0].expression.value;
                } else if (slotArg?.type === "StringLiteral") {
                    slotId = slotArg.value;
                }

                if (!slotId) {
                    fail(
                        node,
                        isSlot
                            ? `slot missing slotId: use slot("...", () => ...)`
                            : `toJsonata missing slotId: use __slot("...") as 2nd arg`,
                    );
                }
                if (fnArg?.type !== "ArrowFunctionExpression" && fnArg?.type !== "FunctionExpression") {
                    fail(
                        node,
                        isSlot
                            ? "slot second arg must be arrow/function expression"
                            : "toJsonata first arg must be arrow/function expression",
                    );
                }

                found.push({ slotId, fnNode: fnArg, spanStart: node.span?.start });
            }
        }

        for (const k of Object.keys(node)) {
            const v = node[k];
            if (Array.isArray(v)) v.forEach(visit);
            else visit(v);
        }
    }

    visit(ast);
    return found;
}

/** ---------------- Module resolution (recursive exports, barrels, default) ---------------- */
type UdfExportIndex = Map<string, any>; // exportedName -> fnNode (includes "default")

type ModuleCacheEntry = {
    source: string;
    ast: any;
    exportedUdfs: UdfExportIndex; // fully resolved (recursive)
};

const moduleCache = new Map<string, ModuleCacheEntry>();

function readText(filePath: string): string {
    return fs.readFileSync(filePath, "utf8");
}

function tryResolveTsModule(fromFile: string, spec: string): string | null {
    if (!(spec.startsWith("./") || spec.startsWith("../"))) return null;

    const baseDir = path.dirname(fromFile);
    const raw = path.resolve(baseDir, spec);

    const candidates = [
        raw,
        `${raw}.ts`,
        `${raw}.tsx`,
        path.join(raw, "index.ts"),
        path.join(raw, "index.tsx"),
    ];

    for (const c of candidates) {
        if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
    }
    return null;
}

function loadAstCached(filePath: string): ModuleCacheEntry {
    const abs = path.resolve(filePath);
    const cached = moduleCache.get(abs);
    if (cached) return cached;

    const source = readText(abs);
    const ast = parseSync(source, { syntax: "typescript", tsx: false, target: "es2022" });

    const entry: ModuleCacheEntry = { source, ast, exportedUdfs: new Map() };
    moduleCache.set(abs, entry);
    return entry;
}

/**
 * Supports:
 * - export const foo = udf(fn)
 * - export default udf(fn) => key "default"
 * - export { foo } from "./x"
 * - export { foo as bar } from "./x"
 * - export * from "./x"
 */
function getExportedUdfsRecursive(
    moduleFile: string,
    fail: (n: any, m: string) => never,
    visited = new Set<string>(),
): UdfExportIndex {
    const abs = path.resolve(moduleFile);
    const entry = loadAstCached(abs);

    if ((entry.exportedUdfs as any).__computed) return entry.exportedUdfs;
    if (visited.has(abs)) return new Map(); // cycle guard
    visited.add(abs);

    const out: UdfExportIndex = new Map();

    const mergeInto = (target: UdfExportIndex, src: UdfExportIndex) => {
        for (const [k, v] of src.entries()) {
            if (!target.has(k)) target.set(k, v);
        }
    };

    // export const foo = udf(...)
    for (const node of entry.ast.body ?? []) {
        if (node.type === "ExportDeclaration" && node.declaration?.type === "VariableDeclaration") {
            for (const d of node.declaration.declarations ?? []) {
                if (d.id?.type === "Identifier" && d.init?.type === "CallExpression") {
                    const name = d.id.value;
                    const init = d.init;

                    const isUdfCall =
                        isIdent(init.callee, "udf") ||
                        (init.callee?.type === "MemberExpression" && isIdent(init.callee.property, "udf"));
                    if (!isUdfCall) continue;

                    const arg0 = init.arguments?.[0]?.expression;
                    if (arg0?.type === "ArrowFunctionExpression" || arg0?.type === "FunctionExpression") {
                        out.set(name, arg0);
                    }
                }
            }
        }
    }

    // export default udf(...)
    for (const node of entry.ast.body ?? []) {
        if (node.type === "ExportDefaultExpression") {
            const expr = node.expression;
            if (expr?.type === "CallExpression") {
                const isUdfCall =
                    isIdent(expr.callee, "udf") ||
                    (expr.callee?.type === "MemberExpression" && isIdent(expr.callee.property, "udf"));
                if (isUdfCall) {
                    const arg0 = expr.arguments?.[0]?.expression;
                    if (arg0?.type === "ArrowFunctionExpression" || arg0?.type === "FunctionExpression") {
                        out.set("default", arg0);
                    }
                }
            }
        }
    }

    // barrels / re-exports
    for (const node of entry.ast.body ?? []) {
        // export { ... } from "./x"
        if (node.type === "ExportNamedDeclaration" && node.source?.value) {
            const spec = node.source.value as string;
            const resolved = tryResolveTsModule(abs, spec);
            if (!resolved) continue;

            const modExports = getExportedUdfsRecursive(resolved, fail, visited);
            const specs = node.specifiers ?? [];

            if (specs.length > 0) {
                for (const s of specs) {
                    const orig = s.orig?.value;
                    const exported = s.exported?.value ?? orig;
                    if (!orig || !exported) continue;

                    const fnNode = modExports.get(orig);
                    if (fnNode) out.set(exported, fnNode);
                }
            }
        }

        // export * from "./x"
        if (node.type === "ExportAllDeclaration" && node.source?.value) {
            const spec = node.source.value as string;
            const resolved = tryResolveTsModule(abs, spec);
            if (!resolved) continue;

            const modExports = getExportedUdfsRecursive(resolved, fail, visited);
            mergeInto(out, modExports);
        }
    }

    (out as any).__computed = true;
    entry.exportedUdfs = out;
    return out;
}

/** ---------------- Import resolution: named + default + namespace ---------------- */
type ImportContext = {
    udfs: Map<string, any>; // localName -> fnNode (named + default)
    namespaces: Map<string, Map<string, any>>; // nsName -> exports map
};

function resolveImports(
    entryFile: string,
    entrySource: string,
    fail: (n: any, m: string) => never,
): ImportContext {
    const ast = parseSync(entrySource, { syntax: "typescript", tsx: false, target: "es2022" });
    const udfs = new Map<string, any>();
    const namespaces = new Map<string, Map<string, any>>();

    for (const item of ast.body ?? []) {
        if (item.type !== "ImportDeclaration") continue;

        const spec = item.source?.value;
        if (typeof spec !== "string") continue;

        const resolved = tryResolveTsModule(entryFile, spec);
        if (!resolved) continue;

        const modExports = getExportedUdfsRecursive(resolved, fail);

        for (const s of item.specifiers ?? []) {
            // import foo from "./x"
            if (s.type === "ImportDefaultSpecifier") {
                const localName = s.local?.value;
                if (!localName) continue;
                const fnNode = modExports.get("default");
                if (fnNode) udfs.set(localName, fnNode);
                continue;
            }

            // import * as u from "./x"
            if (s.type === "ImportNamespaceSpecifier") {
                const nsName = s.local?.value;
                if (!nsName) continue;

                const map = new Map<string, any>();
                for (const [k, v] of modExports.entries()) {
                    if (k === "__computed") continue;
                    map.set(k, v);
                }
                // stable ordering helps DX
                namespaces.set(
                    nsName,
                    new Map([...map.entries()].sort(([a], [b]) => a.localeCompare(b))),
                );
                continue;
            }

            // import { foo as bar } from "./x"
            if (s.type === "ImportSpecifier") {
                const importedName = s.imported?.value ?? s.local?.value;
                const localName = s.local?.value;
                if (!importedName || !localName) continue;

                const fnNode = modExports.get(importedName);
                if (fnNode) udfs.set(localName, fnNode);
            }
        }
    }

    return { udfs, namespaces };
}

/** ---------------- Lowering ---------------- */
type VarBinding = { kind: "Var"; name: string } | { kind: "Current" };

class Env {
    stack: Map<string, VarBinding>[] = [new Map()];
    push() {
        this.stack.push(new Map());
    }
    pop() {
        this.stack.pop();
    }
    set(name: string, b: VarBinding) {
        this.stack[this.stack.length - 1].set(name, b);
    }
    get(name: string): VarBinding | null {
        for (let i = this.stack.length - 1; i >= 0; i--) {
            const v = this.stack[i].get(name);
            if (v) return v;
        }
        return null;
    }
    clone(): Env {
        const e = new Env();
        e.stack = this.stack.map((m) => new Map(m));
        return e;
    }
}

type UdfIndex = Map<string, any>; // localName -> fnNode
type UdfArity = Map<string, number>; // hoistName -> arity

function nsHoistName(ns: string, exp: string) {
    return `${ns}__${exp}`; // $u__foo, $u__default
}

class HoistContext {
    hoisted = new Set<string>();

    // Ordered at the end: UDFs alphabetically, then locals, then return
    udfBindings: BindingIR[] = [];
    localBindings: BindingIR[] = [];

    udfArity: UdfArity = new Map();

    constructor(
        public udfIndex: UdfIndex,
        public namespaces: Map<string, Map<string, any>>,
    ) { }
}

type LambdaLowerMode = "map" | "filter" | "function";

function lowerProgram(
    fnNode: any,
    udfIndex: UdfIndex,
    namespaces: Map<string, Map<string, any>>,
    fail: (n: any, m: string) => never,
): ProgramIR {
    const env = new Env();
    const ctx = new HoistContext(udfIndex, namespaces);

    if ((fnNode.params ?? []).length !== 0) fail(fnNode, "toJsonata callback must have 0 parameters");

    let result: ExprIR | null = null;

    if (fnNode.body.type !== "BlockStatement") {
        result = lowerExpr(fnNode.body, env, ctx, fail);
    } else {
        env.push();
        for (const stmt of fnNode.body.stmts) {
            if (stmt.type === "VariableDeclaration") {
                if (stmt.kind !== "const") fail(stmt, "Only 'const' declarations supported in toJsonata");
                for (const decl of stmt.declarations) {
                    if (decl.id.type !== "Identifier") fail(decl, "Only identifier bindings supported");
                    const name = decl.id.value;
                    if (!decl.init) fail(decl, "const must have initializer");

                    if (decl.init.type === "ArrowFunctionExpression" || decl.init.type === "FunctionExpression") {
                        const fn = lowerLambdaProgram(decl.init, env, "function", ctx, fail);
                        ctx.localBindings.push({ kind: "Fn", name, params: fn.params, body: fn.body });
                        env.set(name, { kind: "Var", name });
                    } else {
                        const expr = lowerExpr(decl.init, env, ctx, fail);
                        ctx.localBindings.push({ kind: "Let", name, expr });
                        env.set(name, { kind: "Var", name });
                    }
                }
                continue;
            }

            if (stmt.type === "ReturnStatement") {
                if (!stmt.argument) fail(stmt, "return must have an expression");
                result = lowerExpr(stmt.argument, env, ctx, fail);
                break;
            }

            fail(stmt, `Unsupported statement in toJsonata block: ${stmt.type}`);
        }
        env.pop();
    }

    if (!result) fail(fnNode, "toJsonata must return an expression");

    // Order: UDFs hoisted alphabetically -> locals -> return
    const udfSorted = [...ctx.udfBindings].sort((a, b) => a.name.localeCompare(b.name));
    return { bindings: [...udfSorted, ...ctx.localBindings], result };
}

function lowerLambdaProgram(
    fnNode: any,
    parentEnv: Env,
    mode: LambdaLowerMode,
    ctx: HoistContext,
    fail: (n: any, m: string) => never,
): { params: string[]; body: ProgramIR } {
    const params = fnNode.params ?? [];
    const names: string[] = [];

    for (const p of params) {
        if (p.pat?.type === "Identifier") names.push(p.pat.value);
        else if (p.type === "Identifier") names.push(p.value);
        else fail(fnNode, "Only identifier params supported in lambdas");
    }

    if ((mode === "filter" || mode === "map") && names.length !== 1) {
        fail(fnNode, `${mode} callback must have exactly 1 parameter`);
    }

    const env = parentEnv.clone();
    env.push();

    if (mode === "filter") env.set(names[0], { kind: "Current" }); // k -> $
    else for (const n of names) env.set(n, { kind: "Var", name: n }); // m -> $m

    if (fnNode.body.type !== "BlockStatement") {
        const body: ProgramIR = { bindings: [], result: lowerExpr(fnNode.body, env, ctx, fail) };
        env.pop();
        return { params: names, body };
    }

    const bindings: BindingIR[] = [];
    let result: ExprIR | null = null;

    for (const stmt of fnNode.body.stmts) {
        if (stmt.type === "VariableDeclaration") {
            if (stmt.kind !== "const") fail(stmt, "Only 'const' supported inside lambda blocks");
            for (const decl of stmt.declarations) {
                if (decl.id.type !== "Identifier") fail(decl, "Only identifier bindings supported");
                const name = decl.id.value;
                if (!decl.init) fail(decl, "const must have initializer");
                const expr = lowerExpr(decl.init, env, ctx, fail);
                bindings.push({ kind: "Let", name, expr });
                env.set(name, { kind: "Var", name });
            }
            continue;
        }

        if (stmt.type === "ReturnStatement") {
            if (!stmt.argument) fail(stmt, "return must have expression");
            result = lowerExpr(stmt.argument, env, ctx, fail);
            break;
        }

        fail(stmt, `Unsupported statement in lambda block: ${stmt.type}`);
    }

    env.pop();
    if (!result) fail(fnNode, "lambda block must end with return <expr>");
    return { params: names, body: { bindings, result } };
}

function unwrapExpr(n: any): any {
    // unwrap common SWC wrappers
    while (n && typeof n === "object") {
        if (n.type === "ParenthesisExpression") n = n.expression;
        else if (n.type === "TsAsExpression") n = n.expression;
        else if (n.type === "TsTypeAssertion") n = n.expression;
        else break;
    }
    return n;
}

function memberPropName(propNode: any): string | null {
    const p = unwrapExpr(propNode);

    if (!p || typeof p !== "object") return null;

    if (p.type === "Identifier") return p.value;
    if (p.type === "StringLiteral") return p.value;
    if (p.type === "NumericLiteral") return String(p.value);

    // SWC sometimes uses IdentifierName-like nodes; try value if it's a string
    if (typeof (p as any).value === "string") return (p as any).value;

    return null;
}
/** Flatten: MemberExpression chain -> Path(base, segs[]) */
function lowerMemberToPath(
    node: any,
    env: Env,
    ctx: HoistContext,
    fail: (n: any, m: string) => never,
): ExprIR {
    const segs: string[] = [];
    let cur = node;

    while (cur?.type === "MemberExpression") {
        if (cur.computed) fail(cur, "Internal: computed member should be lowered to lookup");

        const prop = memberPropName(cur.property);
        if (!prop) {
            console.error("DEBUG member property:", cur.property?.type, cur.property);
            fail(cur.property, "Only identifier/string/numeric member access supported");
        }

        segs.unshift(prop);
        cur = cur.object;
    }

    const base = lowerExpr(cur, env, ctx, fail);
    return { k: "Path", base, segs };
}

function lowerExpr(node: any, env: Env, ctx: HoistContext, fail: (n: any, m: string) => never): ExprIR {
    switch (node.type) {
        case "NullLiteral":
            return { k: "Null" };
        case "BooleanLiteral":
            return { k: "Bool", v: node.value };
        case "NumericLiteral":
            return { k: "Num", v: node.value };
        case "StringLiteral":
            return { k: "Str", v: node.value };
        case "Identifier": {
            if (node.value === "$states") return { k: "Var", name: "states" };

            const b = env.get(node.value);
            if (b?.kind === "Current") return { k: "Current" };
            if (b?.kind === "Var") return { k: "Var", name: b.name };

            fail(node, `Unbound identifier '${node.value}' in toJsonata subset`);
        }
        case "MemberExpression": {
            const isComputed =
                node.computed === true || node.property?.type === "Computed";

            if (isComputed) {
                const obj = lowerExpr(node.object, env, ctx, fail);

                const keyExprNode =
                    node.property?.type === "Computed"
                        ? node.property.expression
                        : node.property;

                const key = lowerExpr(keyExprNode, env, ctx, fail);

                return { k: "Call", fn: "$lookup", args: [obj, key] };
            }

            return lowerMemberToPath(node, env, ctx, fail);
        }
        case "ObjectExpression": {
            const entries = node.properties.map((p: any) => {
                // ✅ shorthand: { foo }
                if (p.type === "Identifier") {
                    const key: KeyIR = { k: "Str", v: p.value };
                    const value: ExprIR = lowerExpr(p, env, ctx, fail); // Identifier -> $foo
                    return { key, value };
                }

                if (p.type === "KeyValueProperty") {
                    const key = lowerKey(p.key, env, ctx, fail);
                    const value = lowerExpr(p.value, env, ctx, fail);
                    return { key, value };
                }

                if (p.type === "SpreadElement") fail(p, "Spread in objects not supported (v1)");
                fail(p, `Unsupported object property type: ${p.type}`);
            });

            return { k: "Obj", entries };
        }
        case "ArrayExpression": {
            const items = (node.elements ?? []).map((el: any) => {
                if (!el) return { k: "Null" } as ExprIR;
                if (el.spread) fail(el, "Spread in arrays not supported (v1)");
                return lowerExpr(el.expression ?? el, env, ctx, fail);
            });
            return { k: "Arr", items };
        }
        case "UnaryExpression": {
            if (node.operator === "!") return { k: "Not", e: lowerExpr(node.argument, env, ctx, fail) };
            fail(node, `Unsupported unary operator ${node.operator}`);
        }
        case "BinaryExpression": {
            const a = lowerExpr(node.left, env, ctx, fail);
            const b = lowerExpr(node.right, env, ctx, fail);

            switch (node.operator) {
                case "&&":
                    return { k: "Bin", op: "and", a, b };
                case "||":
                    return { k: "Bin", op: "or", a, b };
                case "===":
                    return { k: "Bin", op: "eq", a, b };
                case "!==":
                    return { k: "Bin", op: "neq", a, b };
                case "+": {
                    // heuristic: if either side is stringy literal/template -> concat (&), else numeric (+)
                    const leftStringy = node.left.type === "StringLiteral" || node.left.type === "TemplateLiteral";
                    const rightStringy = node.right.type === "StringLiteral" || node.right.type === "TemplateLiteral";
                    return { k: "Bin", op: leftStringy || rightStringy ? "cat" : "add", a, b };
                }
                default:
                    fail(node, `Unsupported binary operator ${node.operator}`);
            }
        }
        case "ConditionalExpression": {
            return {
                k: "Ternary",
                c: lowerExpr(node.test, env, ctx, fail),
                t: lowerExpr(node.consequent, env, ctx, fail),
                f: lowerExpr(node.alternate, env, ctx, fail),
            };
        }
        case "TemplateLiteral": {
            // `A${x}B` -> "A" & x & "B"
            const parts: ExprIR[] = [];
            for (let i = 0; i < node.quasis.length; i++) {
                const q = node.quasis[i];
                const raw = q.cooked ?? q.raw ?? "";
                if (raw.length > 0) parts.push({ k: "Str", v: raw });
                const expr = node.expressions[i];
                if (expr) parts.push(lowerExpr(expr, env, ctx, fail));
            }
            if (parts.length === 0) return { k: "Str", v: "" };
            let out = parts[0];
            for (let i = 1; i < parts.length; i++) out = { k: "Bin", op: "cat", a: out, b: parts[i] };
            return out;
        }
        case "CallExpression": {
            const callee = node.callee;

            // 1) MemberExpression callees:
            //    - arr.map / arr.filter (method calls)
            //    - namespace UDF calls: u.foo(), u.default()
            if (callee.type === "MemberExpression" && !callee.computed) {
                // namespace call: u.foo(...)
                if (callee.object?.type === "Identifier" && callee.property?.type === "Identifier") {
                    const ns = callee.object.value;
                    const exp = callee.property.value;

                    const nsMap = ctx.namespaces.get(ns);
                    if (nsMap) {
                        const fnNode = nsMap.get(exp);

                        if (!fnNode) {
                            if (exp === "default") {
                                fail(node, `Namespace '${ns}' has no default UDF export (export default udf(...))`);
                            }
                            const available = [...nsMap.keys()].slice(0, 12);
                            fail(node, `Unknown namespace UDF '${ns}.${exp}'. Available: ${available.join(", ")}`);
                        }

                        const hoistName = nsHoistName(ns, exp);

                        if (!ctx.hoisted.has(hoistName)) {
                            const lam = lowerLambdaProgram(fnNode, env, "function", ctx, fail);
                            ctx.udfBindings.push({ kind: "Fn", name: hoistName, params: lam.params, body: lam.body });
                            ctx.udfArity.set(hoistName, lam.params.length);
                            ctx.hoisted.add(hoistName);
                        }

                        const expected = ctx.udfArity.get(hoistName) ?? 0;
                        const got = (node.arguments ?? []).length;
                        if (expected !== got) fail(node, `UDF '${ns}.${exp}' expects ${expected} args, got ${got}`);

                        const args = (node.arguments ?? []).map((a: any) => lowerExpr(a.expression, env, ctx, fail));
                        return { k: "Call", fn: `$${hoistName}`, args };
                    }
                }

                // method calls (map/filter)
                if (callee.property.type !== "Identifier") fail(callee.property, "method must be identifier");
                const method = callee.property.value;

                const recv = lowerExpr(callee.object, env, ctx, fail);
                const arg0 = node.arguments?.[0]?.expression;

                if (method === "filter") {
                    if (!arg0) fail(node, "filter requires a callback");
                    if (arg0.type !== "ArrowFunctionExpression" && arg0.type !== "FunctionExpression") {
                        fail(arg0, "filter callback must be arrow/function");
                    }
                    const lam = lowerLambdaProgram(arg0, env, "filter", ctx, fail);
                    return { k: "Select", arr: recv, pred: lam.body };
                }

                if (method === "map") {
                    if (!arg0) fail(node, "map requires a callback");
                    if (arg0.type !== "ArrowFunctionExpression" && arg0.type !== "FunctionExpression") {
                        fail(arg0, "map callback must be arrow/function");
                    }
                    const lam = lowerLambdaProgram(arg0, env, "map", ctx, fail);
                    return { k: "Map", arr: recv, param: lam.params[0], body: lam.body };
                }
            }

            // 2) Identifier callees:
            if (callee.type === "Identifier") {
                const name = callee.value;

                // reduce(arr, fn, init) -> $reduce(arr, function($acc,$k){...}, init)
                if (name === "reduce") {
                    if (node.arguments.length !== 3) fail(node, "reduce(arr, fn, init) requires 3 args");
                    const arr = lowerExpr(node.arguments[0].expression, env, ctx, fail);
                    const fnArg = node.arguments[1].expression;
                    const init = lowerExpr(node.arguments[2].expression, env, ctx, fail);

                    if (fnArg.type !== "ArrowFunctionExpression" && fnArg.type !== "FunctionExpression") {
                        fail(fnArg, "reduce second arg must be arrow/function");
                    }
                    const lam = lowerLambdaProgram(fnArg, env, "function", ctx, fail);
                    if (lam.params.length !== 2) fail(fnArg, "reduce callback must have (acc, item) params");

                    return { k: "Reduce", arr, acc: lam.params[0], param: lam.params[1], init, body: lam.body };
                }

                // builtins
                if (name in BUILTINS) {
                    const fn = BUILTINS[name];
                    const args = (node.arguments ?? []).map((a: any) => lowerExpr(a.expression, env, ctx, fail));
                    return { k: "Call", fn, args };
                }

                // imported UDF calls (named/default)
                if (ctx.udfIndex.has(name)) {
                    const udfFnNode = ctx.udfIndex.get(name)!;

                    if (!ctx.hoisted.has(name)) {
                        const lam = lowerLambdaProgram(udfFnNode, env, "function", ctx, fail);
                        ctx.udfBindings.push({ kind: "Fn", name, params: lam.params, body: lam.body });
                        ctx.udfArity.set(name, lam.params.length);
                        ctx.hoisted.add(name);
                        env.set(name, { kind: "Var", name });
                    }

                    const expected = ctx.udfArity.get(name) ?? 0;
                    const got = (node.arguments ?? []).length;
                    if (expected !== got) fail(node, `UDF '${name}' expects ${expected} args, got ${got}`);

                    const args = (node.arguments ?? []).map((a: any) => lowerExpr(a.expression, env, ctx, fail));
                    return { k: "Call", fn: `$${name}`, args };
                }

                // local function calls: const f = (...) => ...
                const b = env.get(name);
                if (b?.kind === "Var") {
                    const args = (node.arguments ?? []).map((a: any) => lowerExpr(a.expression, env, ctx, fail));
                    return { k: "Call", fn: `$${b.name}`, args };
                }

                fail(node, `Unsupported call '${name}(...)' (not a builtin/UDF/local fn)`);
            }

            fail(node, `Unsupported call callee type: ${callee.type}`);
        }

        case "ParenthesisExpression": {
            return lowerExpr(node.expression, env, ctx, fail);
        }

        case "TsAsExpression":
        case "TsTypeAssertion": {
            return lowerExpr(node.expression, env, ctx, fail);
        }
        default:
            fail(node, `Unsupported expression type in toJsonata subset: ${node.type}`);
    }
}

function lowerKey(node: any, env: Env, ctx: HoistContext, fail: (n: any, m: string) => never): KeyIR {
    if (node.type === "Identifier") return { k: "Str", v: node.value };
    if (node.type === "StringLiteral") return { k: "Str", v: node.value };
    if (node.type === "NumericLiteral") return { k: "Str", v: String(node.value) };
    if (node.type === "Computed") return { k: "Expr", e: lowerExpr(node.expression, env, ctx, fail) };
    if (node.type === "ComputedPropertyName") return { k: "Expr", e: lowerExpr(node.expression, env, ctx, fail) };
    fail(node, `Unsupported object key type: ${node.type}`);
}

/** ---------------- Printer ---------------- */
function printJsonata(prog: ProgramIR): string {
    const lines: string[] = [];
    lines.push("{%");
    lines.push("(");

    const bindingLines: string[] = [];
    for (const b of prog.bindings) {
        if (b.kind === "Let") {
            bindingLines.push(`  $${b.name} := ${printExpr(b.expr)};`);
            bindingLines.push("");
        } else {
            const params = b.params.map((p) => `$${p}`).join(",");
            bindingLines.push(`  $${b.name} := function(${params}){ ${printProgramInline(b.body)} };`);
            bindingLines.push("");
        }
    }
    while (bindingLines.length && bindingLines[bindingLines.length - 1] === "") bindingLines.pop();
    lines.push(...bindingLines);
    if (bindingLines.length) lines.push("");

    lines.push(`  ${printExpr(prog.result)}`);
    lines.push(")");
    lines.push("%}");
    return lines.join("\n");
}

function printProgramInline(p: ProgramIR): string {
    if (p.bindings.length === 0) return printExpr(p.result);
    const lets = p.bindings
        .map((b) => {
            if (b.kind === "Let") return `$${b.name} := ${printExpr(b.expr)}`;
            const params = b.params.map((x) => `$${x}`).join(",");
            return `$${b.name} := function(${params}){ ${printProgramInline(b.body)} }`;
        })
        .join("; ");
    return `( ${lets}; ${printExpr(p.result)} )`;
}

function printKey(k: KeyIR): string {
    if (k.k === "Str") return JSON.stringify(k.v);
    return `(${printExpr(k.e)})`;
}

function printExpr(e: ExprIR): string {
    switch (e.k) {
        case "Null":
            return "null";
        case "Bool":
            return e.v ? "true" : "false";
        case "Num":
            return String(e.v);
        case "Str":
            return JSON.stringify(e.v);
        case "Current":
            return "$";
        case "Var":
            return `$${e.name}`;
        case "Path":
            return `${printExpr(e.base)}.${e.segs.join(".")}`;
        case "Arr":
            return `[${e.items.map(printExpr).join(", ")}]`;
        case "Obj": {
            const parts = e.entries.map(({ key, value }) => {
                if (key.k === "Str") return `${JSON.stringify(key.v)}: ${printExpr(value)}`;
                return `${printKey(key)}: ${printExpr(value)}`;
            });
            return `{${parts.join(", ")}}`;
        }
        case "Not":
            return `(${printExpr(e.e)} = false)`;
        case "Ternary":
            return `(${printExpr(e.c)} ? ${printExpr(e.t)} : ${printExpr(e.f)})`;
        case "Bin": {
            const op =
                e.op === "and"
                    ? "and"
                    : e.op === "or"
                        ? "or"
                        : e.op === "eq"
                            ? "="
                            : e.op === "neq"
                                ? "!="
                                : e.op === "cat"
                                    ? "&"
                                    : e.op === "add"
                                        ? "+"
                                        : "??";
            return `(${printExpr(e.a)} ${op} ${printExpr(e.b)})`;
        }
        case "Map": {
            const body = printProgramInline(e.body);
            return `$map(${printExpr(e.arr)}, function($${e.param}){ ${body} })`;
        }
        case "Select": {
            const pred = printProgramInline(e.pred);
            return `${printExpr(e.arr)}[${pred}]`;
        }
        case "Call":
            return `${e.fn}(${e.args.map(printExpr).join(", ")})`;
        case "Reduce": {
            const body = printProgramInline(e.body);
            return `$reduce(${printExpr(e.arr)}, function($${e.acc},$${e.param}){ ${body} }, ${printExpr(e.init)})`;
        }
    }
}

/** ---------------- CLI ---------------- */

function printHelp() {
    console.log(`aslx compile

Compile TypeScript expressions into JSONata slot registry.

Aliases:
  compile-jsonata, slots

Usage:
  aslx compile [entry] [--out <file>] [--watch]
  aslx compile-jsonata [entry] [--out <file>] [--watch]
  aslx-compile-jsonata [entry] [--out <file>] [--watch]

Defaults:
  entry  machines/index.ts

Behavior:
  - If --out is omitted, compiled slots are printed to stdout.
  - If --out is provided, this also writes a slot origin map next to it:
      <out>.map.json

Options:
  --out <file>  Write slots registry JSON to this file.
  --watch       Recompile on .ts/.tsx changes under the current working directory.
  -h, --help    Show this help

Examples:
  aslx compile machines/index.ts --out build/slots.json
  aslx compile machines/index.ts --watch
`);
}

function parseArgs(argv: string[]) {
    const args = argv.slice(2);
    let input = "machines/index.ts";
    let outFile: string | null = null;
    let watch = false;

    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === "--out") outFile = args[++i] ?? null;
        else if (a === "--watch") watch = true;
        else if (!a.startsWith("--")) input = a;
    }
    return { input, outFile, watch };
}

function debounce<T extends (...args: any[]) => void>(fn: T, ms: number) {
    let t: NodeJS.Timeout | null = null;
    return (...args: Parameters<T>) => {
        if (t) clearTimeout(t);
        t = setTimeout(() => fn(...args), ms);
    };
}

function shouldScanForSlots(filePath: string): boolean {
    const rel = path.relative(process.cwd(), filePath).split(path.sep).join("/");

    // Skip library / tooling sources. These can contain internal helper calls like
    // `toJsonata(fn, __slot(slotId))` that are not real slots to compile.
    if (rel.startsWith("dsl/")) return false;
    if (rel.startsWith("compiler/")) return false;
    if (rel.startsWith("tests/")) return false;
    if (rel.startsWith("testdata/")) return false;
    if (rel.startsWith("build/")) return false;
    return true;
}

function formatLoc(filePath: string, lineMap: LineMap, spanStart?: number): string {
    if (spanStart == null) return filePath;
    const { line, col } = lineMap.pos(spanStart);
    return `${filePath}:${line}:${col}`;
}

function compileOnce(entryAbsFile: string, outFile: string | null) {
    // Clear caches to ensure watch mode reflects changes across the whole module graph.
    moduleCache.clear();

    const graph = buildModuleGraph(entryAbsFile, { projectRoot: process.cwd() });

    const slots = new Map<
        string,
        { expr: string; origin: { file: string; line: number; col: number } }
    >();

    for (const filePath of graph.files) {
        if (!shouldScanForSlots(filePath)) continue;

        const src = fs.readFileSync(filePath, "utf8");
        const lineMap = new LineMap(src);
        const fail = mkFail(filePath, lineMap);

        const imports = resolveImports(filePath, src, fail);
        const udfIndex: UdfIndex = new Map([...imports.udfs]);
        const namespaces = imports.namespaces;

        const calls = extractToJsonataCalls(src, fail);

        for (const c of calls) {
            if (slots.has(c.slotId)) {
                const first = slots.get(c.slotId)!;
                throw new Error(
                    `Duplicate slotId "${c.slotId}"
- ${first.origin.file}:${first.origin.line}:${first.origin.col}
- ${formatLoc(filePath, lineMap, c.spanStart)}`,
                );
            }

            const prog = lowerProgram(c.fnNode, udfIndex, namespaces, fail);
            const expr = printJsonata(prog);

            const loc = c.spanStart != null ? lineMap.pos(c.spanStart) : { line: 1, col: 1 };
            slots.set(c.slotId, {
                expr,
                origin: { file: filePath, line: loc.line, col: loc.col },
            });
        }
    }

    // Stable output ordering: sort by slotId.
    const sorted = [...slots.entries()].sort(([a], [b]) => a.localeCompare(b));
    const out: Record<string, string> = {};
    for (const [slotId, entry] of sorted) out[slotId] = entry.expr;

    const outMap: Record<string, { expr: string; origin: { file: string; line: number; col: number } }> = {};
    for (const [slotId, entry] of sorted) outMap[slotId] = entry;

    if (!outFile) {
        for (const [k, v] of Object.entries(out)) {
            console.log(`
=== SLOT ${k} ===
`);
            console.log(v);
        }
        return;
    }

    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, JSON.stringify(out, null, 2) + "\n", "utf8");
    console.log(`✅ wrote ${Object.keys(out).length} slots to ${outFile}`);

    const mapFile = outFile.endsWith(".json") ? outFile.replace(/\.json$/, ".map.json") : `${outFile}.map.json`;
    fs.writeFileSync(mapFile, JSON.stringify(outMap, null, 2) + "\n", "utf8");
    console.log(`✅ wrote slot origin map to ${mapFile}`);
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printHelp();
    process.exit(0);
}

const { input, outFile, watch } = parseArgs(process.argv);
const absFile = path.resolve(input);

const run = () => {
    try {
        compileOnce(absFile, outFile);
        process.exitCode = 0;
    } catch (e: any) {
        console.error(String(e?.message ?? e));
        process.exitCode = 1;
    }
};

run();


if (watch) {
    const rerun = debounce(run, 80);

    fs.watch(process.cwd(), { recursive: true }, (_evt, filename) => {
        if (!filename) return;

        const rel = filename.split(path.sep).join("/");

        // Ignore noisy paths.
        if (rel.startsWith("node_modules/")) return;
        if (rel.startsWith("build/")) return;

        if (rel.endsWith(".ts") || rel.endsWith(".tsx")) rerun();
    });

    console.log("👀 watching for changes...");
}

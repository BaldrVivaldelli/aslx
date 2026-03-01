// dsl/jsonata.ts
// Authoring-time DSL helpers.
// These functions are NOT executed at runtime by the compiler.
// They exist so developers can write "normal TS" and still get strong-ish DX.

export type JsonataSlot = { __kind: "jsonata_slot"; __slotId: string };

// Used only so the compiler can detect slots in the AST.
export function __slot(slotId: string): string {
  return slotId;
}

/**
 * Wrap a TypeScript callback that the compiler will parse and translate into JSONata.
 *
 * Usage:
 *   toJsonata(() => ({ a: 1 }), __slot("mySlot"))
 */
export function toJsonata<T>(_fn: () => T, slotId: string): JsonataSlot {
  return { __kind: "jsonata_slot", __slotId: slotId };
}

/**
 * Small convenience wrapper so slots can be authored as:
 *
 *   slot("mySlot", () => ({ a: 1 }))
 */
export function slot<T>(slotId: string, fn: () => T): JsonataSlot {
  return toJsonata(fn, __slot(slotId));
}

/**
 * Simple slot combinator for boolean negation.
 *
 * This does not create a new compiled slot. Instead, the emitter recognizes
 * the synthetic `not(<slotId>)` wrapper and renders `not(<expr>)` in JSONata.
 */
export function not(inner: JsonataSlot): JsonataSlot {
  return {
    __kind: "jsonata_slot",
    __slotId: `not(${inner.__slotId})`,
  };
}

/**
 * Mark a function as a UDF so it can be imported and hoisted into JSONata:
 *
 *   export const foo = udf(() => "foo");
 *   export default udf((x) => `X#${x}`);
 *
 * The compiler detects `udf(<fn>)` patterns and hoists the inner function.
 */
export function udf<T extends (...args: any[]) => any>(fn: T): T {
  return fn;
}

/** ---------------- Optional JSONata builtins (for DX / intellisense) ----------------
 * These are convenient, but not strictly required by the compiler.
 * The compiler recognizes calls by IDENTIFIER NAME, so keep these names stable.
 *
 * If you don't want to expose them, you can remove this section.
 */
export const exists = (_x: any): boolean => true as any;
export const keys = (_x: any): string[] => [] as any;
export const lookup = (_obj: any, _k: any): any => undefined as any;
export const merge = (_xs: any[]): any => undefined as any;
export const append = (_a: any, _b: any): any => undefined as any;
export const type = (_x: any): string => "" as any;
export const count = (_x: any): number => 0 as any;
export const upper = (_x: any): string => "" as any;

/**
 * `reduce(arr, (acc, item) => ..., init)`
 * Lowers to JSONata `$reduce(arr, function($acc,$item){...}, init)`
 */
export function reduce<T, A>(
  _arr: T[],
  _fn: (acc: A, item: T) => A,
  _init: A,
): A {
  return _init as any;
}

/**
 * Placeholder for Step Functions `$states` / execution input.
 * The compiler treats `$states` as an unbound identifier and will error unless
 * you bind it in your callback. If you want to use `$states` literally, you have 2 options:
 *
 * 1) Bind it explicitly in your toJsonata callback:
 *    const $states = { input: { ... } } as any; // not great
 *
 * 2) Use a different convention in TS (recommended):
 *    export const states: any = {}; and map it in the compiler as a special root
 *
 * For now, keep it as `any` so devs can write:
 *    $states.input.foo
 */
export const $states: any = {};

export function isJsonataSlot(x: unknown): x is JsonataSlot {
  return (
    typeof x === "object" &&
    x !== null &&
    "__kind" in x &&
    "__slotId" in x &&
    (x as JsonataSlot).__kind === "jsonata_slot"
  );
}

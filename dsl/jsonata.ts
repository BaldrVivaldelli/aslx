// dsl/jsonata.ts
// Authoring-time DSL helpers.
// These functions are NOT executed at runtime by the compiler.
// They exist so developers can write "normal TS" and still get strong-ish DX.

export type JsonataSlot = { __kind: "jsonata_slot"; __slotId: string };
export type JsonataLiteral = string | number | boolean | null;
export type JsonataConditionOperand = JsonataSlot | JsonataLiteral;

export type SyntheticJsonataExpression =
  | { kind: "slot"; slotId: string }
  | { kind: "literal"; value: JsonataLiteral }
  | { kind: "not"; operand: SyntheticJsonataExpression }
  | { kind: "and"; operands: SyntheticJsonataExpression[] }
  | { kind: "or"; operands: SyntheticJsonataExpression[] }
  | { kind: "eq"; left: SyntheticJsonataExpression; right: SyntheticJsonataExpression }
  | { kind: "neq"; left: SyntheticJsonataExpression; right: SyntheticJsonataExpression };

const SYNTHETIC_SLOT_PREFIX = "__jsonata_expr__:";

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

function encodeSyntheticExpression(expr: SyntheticJsonataExpression): JsonataSlot {
  const payload = Buffer.from(JSON.stringify(expr)).toString("base64url");
  return {
    __kind: "jsonata_slot",
    __slotId: `${SYNTHETIC_SLOT_PREFIX}${payload}`,
  };
}

export function parseSyntheticExpressionSlotId(slotId: string): SyntheticJsonataExpression | undefined {
  if (!slotId.startsWith(SYNTHETIC_SLOT_PREFIX)) return undefined;

  const payload = slotId.slice(SYNTHETIC_SLOT_PREFIX.length);
  try {
    const decoded = Buffer.from(payload, "base64url").toString("utf8");
    return JSON.parse(decoded) as SyntheticJsonataExpression;
  } catch {
    return undefined;
  }
}

function operandToExpression(operand: JsonataConditionOperand): SyntheticJsonataExpression {
  if (isJsonataSlot(operand)) {
    const synthetic = parseSyntheticExpressionSlotId(operand.__slotId);
    if (synthetic) return synthetic;
    return { kind: "slot", slotId: operand.__slotId };
  }

  return { kind: "literal", value: operand };
}

function assertConditionOperands(name: string, operands: JsonataSlot[]): void {
  if (operands.length === 0) {
    throw new Error(`${name}(...) requires at least one condition operand`);
  }
}


/**
 * Simple slot combinator for boolean negation.
 *
 * This does not create a new compiled slot. Instead, the emitter recognizes
 * the synthetic expression wrapper and renders `not(<expr>)` in JSONata.
 */
export function not(inner: JsonataSlot): JsonataSlot {
  return encodeSyntheticExpression({
    kind: "not",
    operand: operandToExpression(inner),
  });
}

/**
 * Compose multiple boolean slots with JSONata `and`.
 */
export function and(...operands: [JsonataSlot, JsonataSlot, ...JsonataSlot[]]): JsonataSlot {
  return encodeSyntheticExpression({
    kind: "and",
    operands: operands.map((operand) => operandToExpression(operand)),
  });
}

/**
 * Alias for variadic boolean conjunction with an explicit semantic name.
 */
export function all(...operands: JsonataSlot[]): JsonataSlot {
  assertConditionOperands("all", operands);
  if (operands.length === 1) return operands[0];
  return and(operands[0], operands[1], ...operands.slice(2));
}

/**
 * Compose multiple boolean slots with JSONata `or`.
 */
export function or(...operands: [JsonataSlot, JsonataSlot, ...JsonataSlot[]]): JsonataSlot {
  return encodeSyntheticExpression({
    kind: "or",
    operands: operands.map((operand) => operandToExpression(operand)),
  });
}

/**
 * Alias for variadic boolean disjunction with an explicit semantic name.
 */
export function any(...operands: JsonataSlot[]): JsonataSlot {
  assertConditionOperands("any", operands);
  if (operands.length === 1) return operands[0];
  return or(operands[0], operands[1], ...operands.slice(2));
}

/**
 * Compare either slots or JSON literals with JSONata equality (`=`).
 */
export function eq(left: JsonataConditionOperand, right: JsonataConditionOperand): JsonataSlot {
  return encodeSyntheticExpression({
    kind: "eq",
    left: operandToExpression(left),
    right: operandToExpression(right),
  });
}

/**
 * Compare either slots or JSON literals with JSONata inequality (`!=`).
 */
export function neq(left: JsonataConditionOperand, right: JsonataConditionOperand): JsonataSlot {
  return encodeSyntheticExpression({
    kind: "neq",
    left: operandToExpression(left),
    right: operandToExpression(right),
  });
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

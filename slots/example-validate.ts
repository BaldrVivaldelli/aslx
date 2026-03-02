import {
  slot,
  exists,
  keys,
  merge,
  lookup,
  count,
  upper,
  reduce,
  $states,
} from "../dsl/jsonata";

import type {
  JsonObject,
  StatesParams,
  StatesInput,
  Schema,
} from "./types";

import { bar } from "../lib/udfs";
import foo from "../lib/udfs";
import * as u from "../lib/udfs";

export function exampleSlot() {
  return slot("example:Validate/param:validationExpr", () => {
    const EMPTY_OBJ: JsonObject = {};
    const EMPTY_PARAMS: StatesParams = {};

    const states = $states as { input: StatesInput };

    const coalesce = <T>(a: T | undefined, b: T): T => (exists(a) ? a : b);

    const body = coalesce(states.input.body, EMPTY_OBJ);
    const params = coalesce(states.input.params, EMPTY_PARAMS);
    const pathParams = coalesce(params.path, EMPTY_OBJ);
    const qs = coalesce(params.querystring, EMPTY_OBJ);

    const schema: Schema = {
      alias: { type: "string", required: true },
      slug: { type: "string", required: true },
      overrides: { type: "object", required: false },
    };

    const schemaKeys = keys(schema);

    const payload = merge([qs, pathParams, body]);

    const missing = schemaKeys.filter((k) => {
      const def = schema[k];
      const v = lookup(payload, k);
      return def.required === true && !exists(v);
    });

    const clean = reduce(
      schemaKeys,
      (acc: JsonObject, k: string) => {
        const v = lookup(payload, k);
        return exists(v) ? merge([acc, { [k]: v }]) : acc;
      },
      EMPTY_OBJ,
    );

    const noteA = bar();
    const noteB = foo("X");
    const noteC = u.foo_bar();
    const noteD = u.default("Y");

    const numericPlus = 1 + 2;
    const stringyPlus = "A" + "B";

    return {
      valid: count(missing) === 0,
      input: clean,
      errors: { missing },
      notes: { noteA, noteB, noteC, noteD },
      demoKey: `ALIAS#${upper("visa")}`,
      numericPlus,
      stringyPlus,
    };
  });
}

export function isValidationOk() {
  return slot("example:Choice/isValidationOk", () => {
    const states = $states as { input: StatesInput };
    const validation = states.input.validation;
    return exists(validation) && validation.valid === true;
  });
}

export function validationMode() {
  return slot("example:Choice/validationMode", () => {
    const states = $states as { input: StatesInput };
    return (states.input.validation as any).mode;
  });
}

export function validationSource() {
  return slot("example:Choice/validationSource", () => {
    const states = $states as { input: StatesInput };
    return (states.input.validation as any).source;
  });
}

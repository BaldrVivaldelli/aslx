// slots/types.ts
// Authoring-time types used by examples. These do not affect emitted ASL/JSONata.

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [k: string]: JsonValue };

export type SchemaTypeName = "string" | "number" | "boolean" | "object" | "array";
export type SchemaDef = { type: SchemaTypeName; required: boolean };
export type Schema = Record<string, SchemaDef>;

export type StatesParams = {
  path?: JsonObject;
  querystring?: JsonObject;
};

export type StatesInput = {
  body?: JsonObject;
  params?: StatesParams;
  validation?: {
    valid?: boolean;
    mode?: string;
    source?: string;
  };
};

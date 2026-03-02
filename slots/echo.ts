import { slot, $states } from "../dsl/jsonata";

export function echoOutput() {
  return slot("example:Echo/output", () => ({
    body: ($states as { input: unknown }).input,
    statusCode: 200,
  }));
}

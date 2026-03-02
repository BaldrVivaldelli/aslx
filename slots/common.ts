import { slot, $states, merge } from "../dsl/jsonata";

export function statesInputSlot() {
  return slot("package:common/statesInput", () => ($states as { input: unknown }).input);
}

export function statesErrorOutputSlot() {
  return slot("package:common/statesErrorOutput", () => ($states as { errorOutput: unknown }).errorOutput);
}

export function computeErrorCatchOutput() {
  return slot("package:common/catch/computeErrorOutput", () =>
    merge([
      ($states as { input: Record<string, unknown> }).input,
      {
        compute_error: ($states as { errorOutput: unknown }).errorOutput,
      },
    ]),
  );
}

import { slot, $states } from "../dsl/jsonata";

export function statesInputSlot() {
  return slot("package:common/statesInput", () => ($states as { input: unknown }).input);
}

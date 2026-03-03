import type { StateMachineNode } from "../dsl/state-machine";
import { emitStateMachine, type SlotRegistry } from "./emit-asl.js";
import { normalizeStateMachine } from "./normalize-state-machine.js";
import { validateStateMachine } from "./validate-state-machine.js";

export function buildStateMachineDefinition(
  machine: StateMachineNode,
  slots: SlotRegistry,
  inlineSlots: boolean = true,
) {
  const normalized = normalizeStateMachine(machine);
  validateStateMachine(normalized);
  return emitStateMachine(machine, slots, inlineSlots);
}

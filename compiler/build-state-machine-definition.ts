import type { StateMachineNode } from "../dsl/state-machine";
import { emitStateMachine, type SlotRegistry } from "./emit-asl";
import { normalizeStateMachine } from "./normalize-state-machine";
import { validateStateMachine } from "./validate-state-machine";

export function buildStateMachineDefinition(machine: StateMachineNode, slots: SlotRegistry) {
  const normalized = normalizeStateMachine(machine);
  validateStateMachine(normalized);
  return emitStateMachine(machine, slots);
}

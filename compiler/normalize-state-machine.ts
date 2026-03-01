import type { ChoiceNode } from "../dsl/choice";
import type { StateMachineNode, StepNode } from "../dsl/state-machine";
import type { PassNode } from "../dsl/steps";
import type { TaskNode } from "../dsl/task";

export type NormalizedStateNode = StepNode;

export type NormalizedTransition = {
  from: string;
  to: string;
  kind: "next" | "choice" | "default";
};

export type NormalizedStateMachine = {
  kind: "normalizedStateMachine";
  name: string;
  queryLanguage?: StateMachineNode["queryLanguage"];
  comment?: string;
  startAt: string;
  states: NormalizedStateNode[];
  stateMap: Record<string, NormalizedStateNode>;
  transitions: NormalizedTransition[];
  incomingCount: Record<string, number>;
};

function cloneState<T extends NormalizedStateNode>(node: T): T {
  return structuredClone(node);
}

function getOutgoingTransitions(node: NormalizedStateNode): NormalizedTransition[] {
  if (node.kind === "pass" || node.kind === "task") {
    return node.next ? [{ from: node.name, to: node.next, kind: "next" }] : [];
  }

  return [
    ...node.choices.map((choice) => ({
      from: node.name,
      to: choice.next,
      kind: "choice" as const,
    })),
    ...(node.otherwise ? [{ from: node.name, to: node.otherwise, kind: "default" as const }] : []),
  ];
}

export function normalizeStateMachine(machine: StateMachineNode): NormalizedStateMachine {
  if (machine.states.length === 0) {
    throw new Error(`State machine ${machine.name} cannot be normalized without states`);
  }

  const states = machine.states.map((state) => cloneState(state));
  const stateMap: Record<string, NormalizedStateNode> = {};
  const incomingCount: Record<string, number> = {};
  const transitions: NormalizedTransition[] = [];

  for (const state of states) {
    stateMap[state.name] = state;
    incomingCount[state.name] = 0;
  }

  for (const state of states) {
    const outgoing = getOutgoingTransitions(state);
    transitions.push(...outgoing);
    for (const transition of outgoing) {
      incomingCount[transition.to] = (incomingCount[transition.to] ?? 0) + 1;
    }
  }

  return {
    kind: "normalizedStateMachine",
    name: machine.name,
    queryLanguage: machine.queryLanguage,
    comment: machine.comment,
    startAt: states[0]!.name,
    states,
    stateMap,
    transitions,
    incomingCount,
  };
}

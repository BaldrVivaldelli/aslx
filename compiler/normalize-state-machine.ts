import type { StateMachineNode, StepNode } from "../dsl/state-machine";

export type NormalizedStateNode = StepNode;

export type NormalizedTransition = {
  from: string;
  to: string;
  kind: "next" | "choice" | "default" | "catch";
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
  if (node.kind === "pass") {
    return node.next ? [{ from: node.name, to: node.next, kind: "next" }] : [];
  }

  if (node.kind === "task" || node.kind === "parallel" || node.kind === "map") {
    return [
      ...(node.next ? [{ from: node.name, to: node.next, kind: "next" as const }] : []),
      ...((node.catch ?? []).map((policy) => ({ from: node.name, to: policy.Next, kind: "catch" as const }))),
    ];
  }

  if (node.kind === "raw") {
    const state = node.asl as any;
    const type = typeof state?.Type === "string" ? state.Type : undefined;

    if (type === "Choice") {
      const choices: NormalizedTransition[] = [];
      if (Array.isArray(state?.Choices)) {
        for (const choice of state.Choices) {
          if (choice?.Next) {
            choices.push({ from: node.name, to: String(choice.Next), kind: "choice" });
          }
        }
      }
      if (state?.Default) {
        choices.push({ from: node.name, to: String(state.Default), kind: "default" });
      }
      return choices;
    }

    const out: NormalizedTransition[] = [];
    if (state?.Next) out.push({ from: node.name, to: String(state.Next), kind: "next" });
    if (Array.isArray(state?.Catch)) {
      for (const catcher of state.Catch) {
        if (catcher?.Next) out.push({ from: node.name, to: String(catcher.Next), kind: "catch" });
      }
    }
    return out;
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
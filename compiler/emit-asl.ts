import type { JsonataSlot } from "../dsl/jsonata";
import { isJsonataSlot } from "../dsl/jsonata";
import type { ChoiceNode, ChoiceRule } from "../dsl/choice";
import type { StateMachineNode, StateMachineQueryLanguage } from "../dsl/state-machine";
import type { PassAssignMap, PassContent, PassNode } from "../dsl/steps";

export type SlotRegistry = Record<string, string>;

export type AslPassState = {
  Type: "Pass";
  Comment?: string;
  Output?: unknown;
  Assign?: Record<string, unknown>;
  Next?: string;
  End?: true;
};

export type AslChoiceBranch = {
  Condition: string;
  Next: string;
};

export type AslChoiceState = {
  Type: "Choice";
  Comment?: string;
  Choices: AslChoiceBranch[];
  Default?: string;
};

export type AslState = AslPassState | AslChoiceState;
export type AslStates = Record<string, AslState>;

export type AslStateMachineDefinition = {
  QueryLanguage?: StateMachineQueryLanguage;
  Comment?: string;
  StartAt: string;
  States: AslStates;
};

function renderJsonataTemplate(expr: string): string {
  return `{% ${expr} %}`;
}

function stripJsonataFence(expr: string): string {
  return expr
    .replace(/^\s*\{%\s*/, "")
    .replace(/\s*%\}\s*$/, "")
    .trim();
}

function resolveSlot(slot: JsonataSlot, slots: SlotRegistry): string {
  const slotId = slot.__slotId;

  if (slotId.startsWith("not(") && slotId.endsWith(")")) {
    const innerId = slotId.slice(4, -1);
    const innerExpr = slots[innerId];
    if (!innerExpr) {
      throw new Error(`Missing compiled slot for slotId: ${innerId}`);
    }
    return renderJsonataTemplate(`not(${stripJsonataFence(innerExpr)})`);
  }

  const expr = slots[slotId];
  if (!expr) {
    throw new Error(`Missing compiled slot for slotId: ${slotId}`);
  }
  return renderJsonataTemplate(stripJsonataFence(expr));
}

function resolveContentValue(value: PassContent, slots: SlotRegistry): unknown {
  if (isJsonataSlot(value)) return resolveSlot(value, slots);
  return value;
}

function resolveAssign(assign: PassAssignMap | undefined, slots: SlotRegistry): Record<string, unknown> | undefined {
  if (!assign) return undefined;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(assign)) {
    out[key] = resolveContentValue(value, slots);
  }
  return out;
}

function emitChoiceRule(rule: ChoiceRule, slots: SlotRegistry): AslChoiceBranch {
  return {
    Condition: resolveSlot(rule.condition, slots),
    Next: rule.next,
  };
}

export function emitPassState(node: PassNode, slots: SlotRegistry): AslPassState {
  const state: AslPassState = {
    Type: "Pass",
  };

  if (node.content !== undefined) {
    state.Output = resolveContentValue(node.content, slots);
  }

  const assign = resolveAssign(node.assign, slots);
  if (assign && Object.keys(assign).length > 0) {
    state.Assign = assign;
  }

  if (node.next) state.Next = node.next;
  else state.End = true;

  return state;
}

export function emitChoiceState(node: ChoiceNode, slots: SlotRegistry): AslChoiceState {
  if (node.choices.length === 0) {
    throw new Error(`Choice state ${node.name} must have at least one branch`);
  }

  const state: AslChoiceState = {
    Type: "Choice",
    Choices: node.choices.map((rule) => emitChoiceRule(rule, slots)),
  };

  if (node.otherwise) {
    state.Default = node.otherwise;
  }

  return state;
}

export function emitStates(nodes: Array<PassNode | ChoiceNode>, slots: SlotRegistry): AslStates {
  const states: AslStates = {};
  for (const node of nodes) {
    states[node.name] = node.kind === "pass"
      ? emitPassState(node, slots)
      : emitChoiceState(node, slots);
  }
  return states;
}

export function emitStateMachine(
  input: Array<PassNode | ChoiceNode> | StateMachineNode,
  slots: SlotRegistry,
): AslStateMachineDefinition {
  const nodes = Array.isArray(input) ? input : input.states;

  if (nodes.length === 0) {
    throw new Error("Cannot emit a state machine with zero states");
  }

  return {
    ...(Array.isArray(input)
      ? {}
      : {
          ...(input.queryLanguage ? { QueryLanguage: input.queryLanguage } : {}),
          ...(input.comment ? { Comment: input.comment } : {}),
        }),
    StartAt: nodes[0].name,
    States: emitStates(nodes, slots),
  };
}

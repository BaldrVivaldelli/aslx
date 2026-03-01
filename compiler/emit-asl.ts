import type { ChoiceNode, ChoiceRule } from "../dsl/choice";
import type { JsonataLiteral, JsonataSlot, SyntheticJsonataExpression } from "../dsl/jsonata";
import { isJsonataSlot, parseSyntheticExpressionSlotId } from "../dsl/jsonata";
import type { StateMachineNode, StateMachineQueryLanguage } from "../dsl/state-machine";
import type { PassAssignMap, PassContent, PassNode } from "../dsl/steps";
import type { TaskArgumentValue, TaskNode } from "../dsl/task";

export type SlotRegistry = Record<string, string>;

export type AslPassState = {
  Type: "Pass";
  Comment?: string;
  Output?: unknown;
  Assign?: Record<string, unknown>;
  Next?: string;
  End?: true;
};

export type AslTaskState = {
  Type: "Task";
  Comment?: string;
  Resource: string;
  Arguments?: unknown;
  Output?: unknown;
  Retry?: TaskNode["retry"];
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

export type AslState = AslPassState | AslTaskState | AslChoiceState;
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

function renderLiteral(value: JsonataLiteral): string {
  return JSON.stringify(value);
}

function resolveCompiledSlotExpression(slotId: string, slots: SlotRegistry): string {
  const expr = slots[slotId];
  if (!expr) {
    throw new Error(`Missing compiled slot for slotId: ${slotId}`);
  }
  return `(${stripJsonataFence(expr)})`;
}

function renderSyntheticExpression(expr: SyntheticJsonataExpression, slots: SlotRegistry): string {
  switch (expr.kind) {
    case "slot":
      return resolveCompiledSlotExpression(expr.slotId, slots);
    case "literal":
      return renderLiteral(expr.value);
    case "not":
      return `not(${renderSyntheticExpression(expr.operand, slots)})`;
    case "and":
      return `(${expr.operands.map((operand) => renderSyntheticExpression(operand, slots)).join(" and ")})`;
    case "or":
      return `(${expr.operands.map((operand) => renderSyntheticExpression(operand, slots)).join(" or ")})`;
    case "eq":
      return `(${renderSyntheticExpression(expr.left, slots)} = ${renderSyntheticExpression(expr.right, slots)})`;
    case "neq":
      return `(${renderSyntheticExpression(expr.left, slots)} != ${renderSyntheticExpression(expr.right, slots)})`;
  }
}

function resolveSlot(slot: JsonataSlot, slots: SlotRegistry): string {
  const slotId = slot.__slotId;
  const synthetic = parseSyntheticExpressionSlotId(slotId);

  if (synthetic) {
    return renderJsonataTemplate(renderSyntheticExpression(synthetic, slots));
  }

  return renderJsonataTemplate(stripJsonataFence(resolveCompiledSlotExpression(slotId, slots)));
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

function resolveTaskArgumentValue(value: TaskArgumentValue, slots: SlotRegistry): unknown {
  if (isJsonataSlot(value)) {
    return resolveSlot(value, slots);
  }

  if (Array.isArray(value)) {
    return value.map((item) => resolveTaskArgumentValue(item, slots));
  }

  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      out[key] = resolveTaskArgumentValue(child as TaskArgumentValue, slots);
    }
    return out;
  }

  return value;
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

  if (node.comment) {
    state.Comment = node.comment;
  }

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

export function emitTaskState(node: TaskNode, slots: SlotRegistry): AslTaskState {
  const state: AslTaskState = {
    Type: "Task",
    Resource: node.resource,
  };

  if (node.comment) {
    state.Comment = node.comment;
  }

  if (node.arguments !== undefined) {
    state.Arguments = resolveTaskArgumentValue(node.arguments, slots);
  }

  if (node.output !== undefined) {
    state.Output = resolveContentValue(node.output, slots);
  }

  if (node.retry && node.retry.length > 0) {
    state.Retry = node.retry.map((policy) => ({
      ...policy,
      ErrorEquals: [...policy.ErrorEquals],
    }));
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

  if (node.comment) {
    state.Comment = node.comment;
  }

  if (node.otherwise) {
    state.Default = node.otherwise;
  }

  return state;
}

export function emitStates(nodes: Array<PassNode | TaskNode | ChoiceNode>, slots: SlotRegistry): AslStates {
  const states: AslStates = {};
  for (const node of nodes) {
    states[node.name] = node.kind === "pass"
      ? emitPassState(node, slots)
      : node.kind === "task"
        ? emitTaskState(node, slots)
        : emitChoiceState(node, slots);
  }
  return states;
}

export function emitStateMachine(
  input: Array<PassNode | TaskNode | ChoiceNode> | StateMachineNode,
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

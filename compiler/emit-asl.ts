import type { ChoiceNode, ChoiceRule } from "../dsl/choice";
import type { JsonataLiteral, JsonataSlot, SyntheticJsonataExpression } from "../dsl/jsonata";
import { isJsonataSlot, parseSyntheticExpressionSlotId } from "../dsl/jsonata";
import type { ParallelCatchPolicy, ParallelNode } from "../dsl/parallel";
import type { MapCatchPolicy, MapNode } from "../dsl/map";
import type { StateMachineNode, StateMachineQueryLanguage, StepNode } from "../dsl/state-machine";
import type { RawStateNode } from "../dsl/raw-state";
import type { PassAssignMap, PassContent, PassNode } from "../dsl/steps";
import type { CatchPolicy, TaskArgumentValue, TaskNode } from "../dsl/task";
import type { AslStateMachineDefinition } from "./asl-types";

export type SlotRegistry = Record<string, string>;

export type AslPassState = {
  Type: "Pass";
  Comment?: string;
  QueryLanguage?: StateMachineQueryLanguage;
  Output?: unknown;
  Assign?: Record<string, unknown>;
  Next?: string;
  End?: true;
};

export type AslTaskCatch = {
  ErrorEquals: string[];
  Next: string;
  ResultPath?: string;
  Output?: unknown;
  Assign?: Record<string, unknown>;
};

export type AslTaskState = {
  Type: "Task";
  Comment?: string;
  QueryLanguage?: StateMachineQueryLanguage;
  Resource: string;
  Arguments?: unknown;
  ResultSelector?: unknown;
  ResultPath?: string;
  Output?: unknown;
  Assign?: Record<string, unknown>;
  TimeoutSeconds?: number;
  HeartbeatSeconds?: number;
  Retry?: TaskNode["retry"];
  Catch?: AslTaskCatch[];
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
  QueryLanguage?: StateMachineQueryLanguage;
  Choices: AslChoiceBranch[];
  Default?: string;
};

export type AslBranchDefinition = {
  StartAt: string;
  States: AslStates;
};

export type AslParallelState = {
  Type: "Parallel";
  Comment?: string;
  QueryLanguage?: StateMachineQueryLanguage;
  Branches: AslBranchDefinition[];
  Arguments?: unknown;
  Output?: unknown;
  Assign?: Record<string, unknown>;
  ResultSelector?: unknown;
  ResultPath?: string;
  Retry?: TaskNode["retry"];
  Catch?: AslTaskCatch[];
  Next?: string;
  End?: true;
};

export type AslItemProcessorDefinition = {
  ProcessorConfig?: { Mode: "INLINE" | "DISTRIBUTED"; ExecutionType?: "STANDARD" | "EXPRESS" };
  StartAt: string;
  States: AslStates;
};

export type AslMapState = {
  Type: "Map";
  Comment?: string;
  QueryLanguage?: StateMachineQueryLanguage;
  Items?: unknown;
  ItemsPath?: string;
  ItemSelector?: unknown;
  MaxConcurrency?: unknown;
  ItemProcessor: AslItemProcessorDefinition;
  Output?: unknown;
  Assign?: Record<string, unknown>;
  ResultSelector?: unknown;
  ResultPath?: string;
  Retry?: TaskNode["retry"];
  Catch?: AslTaskCatch[];
  Next?: string;
  End?: true;
};

export type AslRawState = {
  Type: string;
  Comment?: string;
  QueryLanguage?: StateMachineQueryLanguage;
  Next?: string;
  End?: true;
  [key: string]: unknown;
};

export type AslState = AslPassState | AslTaskState | AslChoiceState | AslParallelState | AslMapState | AslRawState;
export type AslStates = Record<string, AslState>;


type BranchStateNode = PassNode | TaskNode | ChoiceNode | RawStateNode;

function resolveUnknownValue(value: unknown, slots: SlotRegistry): unknown {
  if (isJsonataSlot(value as any)) {
    return resolveSlot(value as JsonataSlot, slots);
  }

  if (Array.isArray(value)) {
    return value.map((item) => resolveUnknownValue(item, slots));
  }

  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = resolveUnknownValue(child, slots);
    }
    return out;
  }

  return value;
}

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

function emitCatchPolicy(
  policy: CatchPolicy | ParallelCatchPolicy | MapCatchPolicy,
  slots: SlotRegistry,
): AslTaskCatch {
  const out: AslTaskCatch = {
    ErrorEquals: [...policy.ErrorEquals],
    Next: policy.Next,
  };

  if (policy.ResultPath) out.ResultPath = policy.ResultPath;

  if (policy.Output !== undefined) {
    out.Output = resolveContentValue(policy.Output as PassContent, slots);
  }

  const assign = resolveAssign((policy as any).Assign as PassAssignMap | undefined, slots);
  if (assign && Object.keys(assign).length > 0) out.Assign = assign;

  return out;
}

function emitChoiceRule(rule: ChoiceRule, slots: SlotRegistry): AslChoiceBranch {
  return {
    Condition: resolveSlot(rule.condition, slots),
    Next: rule.next,
  };
}

function cloneBranchState<T extends BranchStateNode>(node: T): T {
  return structuredClone(node);
}

function hasExplicitTransition(node: PassNode | TaskNode): boolean {
  return node.next !== undefined || node.end === true;
}

function rawStateType(node: RawStateNode): string | undefined {
  const type = (node.asl as any)?.Type;
  return typeof type === "string" ? type : undefined;
}

function rawHasExplicitTransition(node: RawStateNode): boolean {
  const state = node.asl as any;
  const type = rawStateType(node);
  if (type === "Succeed" || type === "Fail") return true;
  if (type === "Choice") {
    return Boolean(state?.Default) || (Array.isArray(state?.Choices) && state.Choices.length > 0);
  }
  return state?.Next !== undefined || state?.End === true;
}

function expandBranchSequence(
  sequence: BranchStateNode[],
  expanded: BranchStateNode[],
  seenNames: Set<string>,
  terminalNext?: string,
): void {
  const wired = sequence.map((state) => cloneBranchState(state));

  for (let i = 0; i < wired.length; i += 1) {
    const current = wired[i]!;
    const next = wired[i + 1];
    const fallbackNext = next?.name ?? terminalNext;

    if (current.kind === "pass" || current.kind === "task") {
      if (!hasExplicitTransition(current)) {
        if (fallbackNext) current.next = fallbackNext;
        else current.end = true;
      }

      if (seenNames.has(current.name)) {
        throw new Error(`Duplicate branch state name detected: ${current.name}`);
      }
      seenNames.add(current.name);
      expanded.push(current);

      if (current.kind === "task" && current.catch) {
        for (const policy of current.catch) {
          if (!policy.inlineTarget) continue;
          expandBranchSequence(policy.inlineTarget.states as BranchStateNode[], expanded, seenNames, fallbackNext);
        }
      }
      continue;
    }

    if (current.kind === "raw") {
      const type = rawStateType(current);
      const state = current.asl as any;

      if (!rawHasExplicitTransition(current)) {
        if (type === "Choice") {
          if (fallbackNext) state.Default = fallbackNext;
        } else if (type === "Succeed" || type === "Fail") {
          // terminal types cannot be auto-wired
        } else {
          if (fallbackNext) state.Next = fallbackNext;
          else state.End = true;
        }
      }

      if (seenNames.has(current.name)) {
        throw new Error(`Duplicate branch state name detected: ${current.name}`);
      }
      seenNames.add(current.name);
      expanded.push(current);
      continue;
    }

    if (current.otherwise === undefined && fallbackNext) {
      current.otherwise = fallbackNext;
    }

    if (seenNames.has(current.name)) {
      throw new Error(`Duplicate branch state name detected: ${current.name}`);
    }
    seenNames.add(current.name);
    expanded.push(current);

    for (const rule of current.choices) {
      if (!rule.inlineTarget) continue;
      expandBranchSequence(rule.inlineTarget.states as BranchStateNode[], expanded, seenNames, fallbackNext);
    }

    if (current.otherwiseInlineTarget) {
      expandBranchSequence(current.otherwiseInlineTarget.states as BranchStateNode[], expanded, seenNames, fallbackNext);
    }
  }
}

function materializeBranchStates(states: BranchStateNode[]): BranchStateNode[] {
  if (states.length === 0) {
    throw new Error("Cannot emit an empty parallel branch");
  }
  const expanded: BranchStateNode[] = [];
  const seenNames = new Set<string>();
  expandBranchSequence(states, expanded, seenNames);
  return expanded;
}

function emitBranchDefinition(branch: import("../dsl/subflow").SubflowNode, slots: SlotRegistry): AslBranchDefinition {
  const states = materializeBranchStates(branch.states as BranchStateNode[]);
  return {
    StartAt: states[0]!.name,
    States: emitStates(states, slots),
  };
}

export function emitPassState(node: PassNode, slots: SlotRegistry): AslPassState {
  const state: AslPassState = { Type: "Pass" };

  if (node.comment) state.Comment = node.comment;
  if (node.queryLanguage) state.QueryLanguage = node.queryLanguage;
  if (node.content !== undefined) state.Output = resolveContentValue(node.content, slots);

  const assign = resolveAssign(node.assign, slots);
  if (assign && Object.keys(assign).length > 0) state.Assign = assign;

  if (node.next) state.Next = node.next;
  else state.End = true;

  return state;
}

export function emitTaskState(node: TaskNode, slots: SlotRegistry): AslTaskState {
  const state: AslTaskState = { Type: "Task", Resource: node.resource };
  if (node.comment) state.Comment = node.comment;
  if (node.queryLanguage) state.QueryLanguage = node.queryLanguage;
  if (node.arguments !== undefined) state.Arguments = resolveTaskArgumentValue(node.arguments, slots);
  if (node.resultSelector !== undefined) state.ResultSelector = resolveTaskArgumentValue(node.resultSelector, slots);
  if (node.resultPath !== undefined) state.ResultPath = node.resultPath;
  if (node.output !== undefined) state.Output = resolveContentValue(node.output, slots);

  const assign = resolveAssign(node.assign, slots);
  if (assign && Object.keys(assign).length > 0) state.Assign = assign;
  if (node.timeoutSeconds !== undefined) state.TimeoutSeconds = node.timeoutSeconds;
  if (node.heartbeatSeconds !== undefined) state.HeartbeatSeconds = node.heartbeatSeconds;
  if (node.retry && node.retry.length > 0) {
    state.Retry = node.retry.map((policy) => ({ ...policy, ErrorEquals: [...policy.ErrorEquals] }));
  }
  if (node.catch && node.catch.length > 0) {
    state.Catch = node.catch.map((policy) => emitCatchPolicy(policy, slots));
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

  if (node.comment) state.Comment = node.comment;
  if (node.queryLanguage) state.QueryLanguage = node.queryLanguage;
  if (node.otherwise) state.Default = node.otherwise;
  return state;
}

export function emitParallelState(node: ParallelNode, slots: SlotRegistry): AslParallelState {
  if (node.branches.length === 0) {
    throw new Error(`Parallel state ${node.name} must have at least one branch`);
  }

  const state: AslParallelState = {
    Type: "Parallel",
    Branches: node.branches.map((branch) => emitBranchDefinition(branch, slots)),
  };

  if (node.comment) state.Comment = node.comment;
  if (node.queryLanguage) state.QueryLanguage = node.queryLanguage;
  if (node.arguments !== undefined) state.Arguments = resolveTaskArgumentValue(node.arguments, slots);
  if (node.output !== undefined) state.Output = resolveContentValue(node.output, slots);

  const assign = resolveAssign(node.assign, slots);
  if (assign && Object.keys(assign).length > 0) state.Assign = assign;

  if (node.resultSelector !== undefined) state.ResultSelector = resolveTaskArgumentValue(node.resultSelector, slots);
  if (node.resultPath !== undefined) state.ResultPath = node.resultPath;

  if (node.retry && node.retry.length > 0) {
    state.Retry = node.retry.map((policy) => ({ ...policy, ErrorEquals: [...policy.ErrorEquals] }));
  }

  if (node.catch && node.catch.length > 0) state.Catch = node.catch.map((policy) => emitCatchPolicy(policy, slots));
  if (node.next) state.Next = node.next;
  else state.End = true;
  return state;
}

export function emitMapState(node: MapNode, slots: SlotRegistry): AslMapState {
  if (!node.itemProcessor || node.itemProcessor.states.length === 0) {
    throw new Error(`Map state ${node.name} must have a non-empty itemProcessor`);
  }

  const processorStates = materializeBranchStates(node.itemProcessor.states as BranchStateNode[]);
  const itemProcessor: AslItemProcessorDefinition = {
    ProcessorConfig: { Mode: "INLINE" },
    StartAt: processorStates[0]!.name,
    States: emitStates(processorStates, slots),
  };

  const state: AslMapState = {
    Type: "Map",
    ItemProcessor: itemProcessor,
  };

  if (node.comment) state.Comment = node.comment;
  if (node.queryLanguage) state.QueryLanguage = node.queryLanguage;

  if (node.items !== undefined) state.Items = resolveTaskArgumentValue(node.items, slots);
  if (node.itemsPath !== undefined) state.ItemsPath = node.itemsPath;
  if (node.itemSelector !== undefined) state.ItemSelector = resolveTaskArgumentValue(node.itemSelector, slots);
  if (node.maxConcurrency !== undefined) {
    state.MaxConcurrency = isJsonataSlot(node.maxConcurrency)
      ? resolveSlot(node.maxConcurrency, slots)
      : node.maxConcurrency;
  }

  if (node.output !== undefined) state.Output = resolveContentValue(node.output, slots);

  const assign = resolveAssign(node.assign, slots);
  if (assign && Object.keys(assign).length > 0) state.Assign = assign;

  if (node.resultSelector !== undefined) state.ResultSelector = resolveTaskArgumentValue(node.resultSelector, slots);
  if (node.resultPath !== undefined) state.ResultPath = node.resultPath;

  if (node.retry && node.retry.length > 0) {
    state.Retry = node.retry.map((policy) => ({ ...policy, ErrorEquals: [...policy.ErrorEquals] }));
  }

  if (node.catch && node.catch.length > 0) state.Catch = node.catch.map((policy) => emitCatchPolicy(policy, slots));

  if (node.next) state.Next = node.next;
  else state.End = true;

  return state;
}

export function emitRawState(node: RawStateNode, slots: SlotRegistry): AslRawState {
  const rendered = resolveUnknownValue(node.asl, slots) as AslRawState;
  const out: AslRawState = {
    ...(rendered as Record<string, unknown>),
    Type: String((rendered as any)?.Type ?? "State"),
  };

  if (node.queryLanguage) {
    out.QueryLanguage = node.queryLanguage;
  }

  return out;
}

export function emitStates(nodes: Array<StepNode | BranchStateNode>, slots: SlotRegistry): AslStates {
  const states: AslStates = {};
  for (const node of nodes) {
    states[node.name] = node.kind === "pass"
      ? emitPassState(node, slots)
      : node.kind === "task"
        ? emitTaskState(node, slots)
        : node.kind === "choice"
          ? emitChoiceState(node, slots)
          : node.kind === "parallel"
            ? emitParallelState(node, slots)
            : node.kind === "map"
              ? emitMapState(node, slots)
              : emitRawState(node, slots);
  }
  return states;
}

export function emitStateMachine(
  input: StepNode[] | StateMachineNode,
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
    StartAt: nodes[0]!.name,
    States: emitStates(nodes, slots),
  };
}
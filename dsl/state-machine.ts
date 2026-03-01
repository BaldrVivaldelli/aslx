import type { SlotRegistry } from "../compiler/emit-asl";
import { buildStateMachineDefinition } from "../compiler/build-state-machine-definition";
import type { ChoiceNode, ChoiceRule } from "./choice";
import { ChoiceBuilder } from "./choice";
import type { ParallelNode } from "./parallel";
import { ParallelBuilder } from "./parallel";
import type { MapNode } from "./map";
import { MapBuilder } from "./map";
import type { PassNode } from "./steps";
import { PassBuilder } from "./steps";
import type { SubflowNode } from "./subflow";
import type { TaskNode } from "./task";
import { TaskBuilder } from "./task";

export type StateMachineQueryLanguage = "JSONata" | "JSONPath";

export type StepNode = PassNode | TaskNode | ChoiceNode | ParallelNode | MapNode;
export type StepLike = PassBuilder | PassNode | TaskBuilder | TaskNode | ChoiceBuilder | ChoiceNode | ParallelBuilder | ParallelNode | MapBuilder | MapNode;

export type StateMachineNode = {
  kind: "stateMachine";
  name: string;
  queryLanguage?: StateMachineQueryLanguage;
  comment?: string;
  states: StepNode[];
};

function isPassBuilder(step: StepLike): step is PassBuilder {
  return step instanceof PassBuilder;
}

function isTaskBuilder(step: StepLike): step is TaskBuilder {
  return step instanceof TaskBuilder;
}

function isChoiceBuilder(step: StepLike): step is ChoiceBuilder {
  return step instanceof ChoiceBuilder;
}

function isParallelBuilder(step: StepLike): step is ParallelBuilder {
  return step instanceof ParallelBuilder;
}

function isMapBuilder(step: StepLike): step is MapBuilder {
  return step instanceof MapBuilder;
}

function clonePassNode(node: PassNode): PassNode {
  return {
    ...node,
    assign: node.assign ? { ...node.assign } : undefined,
  };
}

function cloneTaskArgumentValue(value: TaskNode["arguments"]): TaskNode["arguments"] {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    return value.map((item) => cloneTaskArgumentValue(item) as NonNullable<TaskNode["arguments"]>[number]);
  }
  if (value !== null && typeof value === "object" && !("__kind" in value)) {
    const out: Record<string, NonNullable<TaskNode["arguments"]>> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = cloneTaskArgumentValue(item as NonNullable<TaskNode["arguments"]>);
    }
    return out as TaskNode["arguments"];
  }
  return value;
}

function cloneSubflowNode(node: SubflowNode): SubflowNode {
  return {
    kind: "subflow",
    states: node.states.map((state) => {
      if (state.kind === "pass") return clonePassNode(state);
      if (state.kind === "task") return cloneTaskNode(state);
      return cloneChoiceNode(state);
    }),
  };
}

function cloneTaskNode(node: TaskNode): TaskNode {
  return {
    ...node,
    arguments: cloneTaskArgumentValue(node.arguments),
    resultSelector: cloneTaskArgumentValue(node.resultSelector),
    retry: node.retry ? node.retry.map((policy) => ({ ...policy, ErrorEquals: [...policy.ErrorEquals] })) : undefined,
    catch: node.catch ? node.catch.map((policy) => ({
      ...policy,
      ErrorEquals: [...policy.ErrorEquals],
      inlineTarget: policy.inlineTarget ? cloneSubflowNode(policy.inlineTarget) : undefined,
    })) : undefined,
  };
}

function cloneChoiceRule(rule: ChoiceRule): ChoiceRule {
  return {
    ...rule,
    inlineTarget: rule.inlineTarget ? cloneSubflowNode(rule.inlineTarget) : undefined,
  };
}

function cloneChoiceNode(node: ChoiceNode): ChoiceNode {
  return {
    ...node,
    choices: node.choices.map(cloneChoiceRule),
    otherwiseInlineTarget: node.otherwiseInlineTarget
      ? cloneSubflowNode(node.otherwiseInlineTarget)
      : undefined,
  };
}

function cloneParallelNode(node: ParallelNode): ParallelNode {
  return {
    ...node,
    branches: node.branches.map(cloneSubflowNode),
    resultSelector: cloneTaskArgumentValue(node.resultSelector),
    catch: node.catch ? node.catch.map((policy) => ({
      ...policy,
      ErrorEquals: [...policy.ErrorEquals],
      inlineTarget: policy.inlineTarget ? cloneSubflowNode(policy.inlineTarget) : undefined,
    })) : undefined,
  };
}

function cloneMapNode(node: MapNode): MapNode {
  return {
    ...node,
    items: cloneTaskArgumentValue(node.items as any) as any,
    itemsPath: node.itemsPath,
    itemSelector: cloneTaskArgumentValue(node.itemSelector as any) as any,
    maxConcurrency: node.maxConcurrency,
    itemProcessor: node.itemProcessor ? cloneSubflowNode(node.itemProcessor) : undefined,
    resultSelector: cloneTaskArgumentValue(node.resultSelector as any) as any,
    resultPath: node.resultPath,
    catch: node.catch ? node.catch.map((policy) => ({
      ...policy,
      ErrorEquals: [...policy.ErrorEquals],
      inlineTarget: policy.inlineTarget ? cloneSubflowNode(policy.inlineTarget) : undefined,
    })) : undefined,
    next: node.next,
    ...(node.end === true ? { end: true } : {}),
  };
}

function materializeStep(step: StepLike): StepNode {
  if (isPassBuilder(step)) return step.build();
  if (isTaskBuilder(step)) return step.build();
  if (isChoiceBuilder(step)) return step.build();
  if (isParallelBuilder(step)) return step.build();
  if (isMapBuilder(step)) return step.build();
  return cloneNode(step);
}

function cloneNode(node: StepNode): StepNode {
  if (node.kind === "pass") return clonePassNode(node);
  if (node.kind === "task") return cloneTaskNode(node);
  if (node.kind === "choice") return cloneChoiceNode(node);
  if (node.kind === "parallel") return cloneParallelNode(node);
  return cloneMapNode(node);
}

function hasExplicitTransition(node: PassNode | TaskNode | ParallelNode | MapNode): boolean {
  return node.next !== undefined || node.end === true;
}

function pushUniqueState(target: StepNode[], seenNames: Set<string>, state: StepNode): void {
  if (seenNames.has(state.name)) {
    throw new Error(`Duplicate state name detected: ${state.name}`);
  }

  seenNames.add(state.name);
  target.push(state);
}

function expandSequence(
  sequence: StepNode[],
  expanded: StepNode[],
  seenNames: Set<string>,
  terminalNext?: string,
): void {
  const wired = sequence.map(cloneNode);

  for (let i = 0; i < wired.length; i += 1) {
    const current = wired[i]!;
    const next = wired[i + 1];
    const fallbackNext = next?.name ?? terminalNext;

    if (current.kind === "pass" || current.kind === "task" || current.kind === "parallel" || current.kind === "map") {
      if (!hasExplicitTransition(current)) {
        if (fallbackNext) current.next = fallbackNext;
        else current.end = true;
      }

      pushUniqueState(expanded, seenNames, current);

      if ((current.kind === "task" || current.kind === "parallel" || current.kind === "map") && current.catch) {
        for (const policy of current.catch) {
          if (!policy.inlineTarget) continue;
          expandSequence(policy.inlineTarget.states as StepNode[], expanded, seenNames, fallbackNext);
        }
      }

      continue;
    }

    if (current.otherwise === undefined && fallbackNext) {
      current.otherwise = fallbackNext;
    }

    pushUniqueState(expanded, seenNames, current);

    for (const rule of current.choices) {
      if (!rule.inlineTarget) continue;
      expandSequence(rule.inlineTarget.states as StepNode[], expanded, seenNames, fallbackNext);
    }

    if (current.otherwiseInlineTarget) {
      expandSequence(current.otherwiseInlineTarget.states as StepNode[], expanded, seenNames, fallbackNext);
    }
  }
}

function wireLinearGraph(states: StepNode[]): StepNode[] {
  const expanded: StepNode[] = [];
  const seenNames = new Set<string>();
  expandSequence(states, expanded, seenNames);
  return expanded;
}

export class StateMachineBuilder {
  private readonly name: string;
  private readonly steps: StepLike[] = [];
  private metadata: {
    queryLanguage?: StateMachineQueryLanguage;
    comment?: string;
  } = {};

  constructor(name: string) {
    this.name = name;
  }

  queryLanguage(value: StateMachineQueryLanguage): this {
    this.metadata.queryLanguage = value;
    return this;
  }

  comment(value: string): this {
    this.metadata.comment = value;
    return this;
  }

  startWith(step: StepLike): this {
    if (this.steps.length > 0) {
      throw new Error(`State machine ${this.name} already has a starting step`);
    }

    this.steps.push(step);
    return this;
  }

  then(step: StepLike): this {
    if (this.steps.length === 0) {
      throw new Error(`State machine ${this.name} must start with startWith(...) before then(...)`);
    }

    this.steps.push(step);
    return this;
  }

  build(): StateMachineNode {
    if (this.steps.length === 0) {
      throw new Error(`State machine ${this.name} cannot be built without steps`);
    }

    const states = wireLinearGraph(this.steps.map(materializeStep));

    return {
      kind: "stateMachine",
      name: this.name,
      queryLanguage: this.metadata.queryLanguage,
      comment: this.metadata.comment,
      states,
    };
  }

  toDefinition(slots: SlotRegistry) {
    const graph = this.build();
    return buildStateMachineDefinition(graph, slots);
  }
}

export function stateMachine(name: string): StateMachineBuilder {
  return new StateMachineBuilder(name);
}
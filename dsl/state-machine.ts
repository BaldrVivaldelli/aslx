import type { SlotRegistry } from "../compiler/emit-asl";
import { emitStateMachine as emitAslStateMachine } from "../compiler/emit-asl";
import type { SubflowNode } from "./subflow";
import type { ChoiceNode, ChoiceRule } from "./choice";
import { ChoiceBuilder } from "./choice";
import type { PassNode } from "./steps";
import { PassBuilder } from "./steps";

export type StateMachineQueryLanguage = "JSONata" | "JSONPath";

export type StepNode = PassNode | ChoiceNode;
export type StepLike = PassBuilder | PassNode | ChoiceBuilder | ChoiceNode;

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

function isChoiceBuilder(step: StepLike): step is ChoiceBuilder {
  return step instanceof ChoiceBuilder;
}

function clonePassNode(node: PassNode): PassNode {
  return {
    ...node,
    assign: node.assign ? { ...node.assign } : undefined,
  };
}

function cloneSubflowNode(node: SubflowNode): SubflowNode {
  return {
    kind: "subflow",
    states: node.states.map((state) =>
      state.kind === "pass" ? clonePassNode(state) : cloneChoiceNode(state),
    ),
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

function materializeStep(step: StepLike): StepNode {
  if (isPassBuilder(step)) return step.build();
  if (isChoiceBuilder(step)) return step.build();
  return step.kind === "pass" ? clonePassNode(step) : cloneChoiceNode(step);
}

function cloneNode(node: StepNode): StepNode {
  return node.kind === "pass" ? clonePassNode(node) : cloneChoiceNode(node);
}

function hasExplicitTransition(node: PassNode): boolean {
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
    const current = wired[i];
    const next = wired[i + 1];
    const fallbackNext = next?.name ?? terminalNext;

    if (current.kind === "pass") {
      if (!hasExplicitTransition(current)) {
        if (fallbackNext) current.next = fallbackNext;
        else current.end = true;
      }

      pushUniqueState(expanded, seenNames, current);
      continue;
    }

    if (current.otherwise === undefined && fallbackNext) {
      current.otherwise = fallbackNext;
    }

    pushUniqueState(expanded, seenNames, current);

    for (const rule of current.choices) {
      if (!rule.inlineTarget) continue;
      expandSequence(rule.inlineTarget.states, expanded, seenNames, fallbackNext);
    }

    if (current.otherwiseInlineTarget) {
      expandSequence(current.otherwiseInlineTarget.states, expanded, seenNames, fallbackNext);
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
    return emitAslStateMachine(graph, slots);
  }
}

export function stateMachine(name: string): StateMachineBuilder {
  return new StateMachineBuilder(name);
}

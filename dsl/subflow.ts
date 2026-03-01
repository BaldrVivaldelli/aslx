import type { ChoiceNode } from "./choice";
import { ChoiceBuilder } from "./choice";
import type { PassNode } from "./steps";
import { PassBuilder } from "./steps";
import type { TaskNode } from "./task";
import { TaskBuilder } from "./task";

export type SubflowStepNode = PassNode | TaskNode | ChoiceNode;
export type SubflowStepLike = PassBuilder | PassNode | TaskBuilder | TaskNode | ChoiceBuilder | ChoiceNode;

export type SubflowNode = {
  kind: "subflow";
  states: SubflowStepNode[];
};

function isPassBuilder(step: SubflowStepLike): step is PassBuilder {
  return step instanceof PassBuilder;
}

function isTaskBuilder(step: SubflowStepLike): step is TaskBuilder {
  return step instanceof TaskBuilder;
}

function isChoiceBuilder(step: SubflowStepLike): step is ChoiceBuilder {
  return step instanceof ChoiceBuilder;
}

function clonePassNode(node: PassNode): PassNode {
  return {
    ...node,
    assign: node.assign ? { ...node.assign } : undefined,
  };
}

function cloneTaskArgumentValue(value: TaskNode["arguments"]): TaskNode["arguments"] {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value.map((item) => cloneTaskArgumentValue(item) as never);
  if (value !== null && typeof value === "object" && !("__kind" in value)) {
    const out: Record<string, NonNullable<TaskNode["arguments"]>> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = cloneTaskArgumentValue(item as NonNullable<TaskNode["arguments"]>);
    }
    return out as TaskNode["arguments"];
  }
  return value;
}

function cloneTaskNode(node: TaskNode): TaskNode {
  return {
    ...node,
    arguments: cloneTaskArgumentValue(node.arguments),
    retry: node.retry ? node.retry.map((policy) => ({ ...policy, ErrorEquals: [...policy.ErrorEquals] })) : undefined,
  };
}

function cloneChoiceNode(node: ChoiceNode): ChoiceNode {
  return {
    ...node,
    choices: node.choices.map((rule) => ({
      ...rule,
      inlineTarget: rule.inlineTarget
        ? {
            ...rule.inlineTarget,
            states: rule.inlineTarget.states.map(cloneStepNode),
          }
        : undefined,
    })),
    otherwiseInlineTarget: node.otherwiseInlineTarget
      ? {
          ...node.otherwiseInlineTarget,
          states: node.otherwiseInlineTarget.states.map(cloneStepNode),
        }
      : undefined,
  };
}

function cloneStepNode(node: SubflowStepNode): SubflowStepNode {
  if (node.kind === "pass") return clonePassNode(node);
  if (node.kind === "task") return cloneTaskNode(node);
  return cloneChoiceNode(node);
}

function materializeStep(step: SubflowStepLike): SubflowStepNode {
  if (isPassBuilder(step)) return step.build();
  if (isTaskBuilder(step)) return step.build();
  if (isChoiceBuilder(step)) return step.build();
  return cloneStepNode(step);
}

export class SubflowBuilder {
  private readonly steps: SubflowStepLike[] = [];

  constructor(step?: SubflowStepLike) {
    if (step) this.steps.push(step);
  }

  startWith(step: SubflowStepLike): this {
    if (this.steps.length > 0) {
      throw new Error("Subflow already has a starting step");
    }

    this.steps.push(step);
    return this;
  }

  then(step: SubflowStepLike): this {
    if (this.steps.length === 0) {
      throw new Error("Subflow must start with startWith(...) or subflow(step) before then(...)");
    }

    this.steps.push(step);
    return this;
  }

  build(): SubflowNode {
    if (this.steps.length === 0) {
      throw new Error("Cannot build an empty subflow");
    }

    return {
      kind: "subflow",
      states: this.steps.map(materializeStep),
    };
  }
}

export function subflow(step?: SubflowStepLike): SubflowBuilder {
  return new SubflowBuilder(step);
}

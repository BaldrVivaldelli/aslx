import type { ChoiceNode } from "./choice";
import { ChoiceBuilder } from "./choice";
import type { PassNode } from "./steps";
import { PassBuilder } from "./steps";

export type SubflowStepNode = PassNode | ChoiceNode;
export type SubflowStepLike = PassBuilder | PassNode | ChoiceBuilder | ChoiceNode;

export type SubflowNode = {
  kind: "subflow";
  states: SubflowStepNode[];
};

function isPassBuilder(step: SubflowStepLike): step is PassBuilder {
  return step instanceof PassBuilder;
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

function cloneChoiceNode(node: ChoiceNode): ChoiceNode {
  return {
    ...node,
    choices: node.choices.map((rule) => ({
      ...rule,
      inlineTarget: rule.inlineTarget
        ? {
            ...rule.inlineTarget,
            states: rule.inlineTarget.states.map((state) =>
              state.kind === "pass" ? clonePassNode(state) : cloneChoiceNode(state),
            ),
          }
        : undefined,
    })),
    otherwiseInlineTarget: node.otherwiseInlineTarget
      ? {
          ...node.otherwiseInlineTarget,
          states: node.otherwiseInlineTarget.states.map((state) =>
            state.kind === "pass" ? clonePassNode(state) : cloneChoiceNode(state),
          ),
        }
      : undefined,
  };
}

function materializeStep(step: SubflowStepLike): SubflowStepNode {
  if (isPassBuilder(step)) return step.build();
  if (isChoiceBuilder(step)) return step.build();
  return step.kind === "pass" ? clonePassNode(step) : cloneChoiceNode(step);
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

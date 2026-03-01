import type { JsonataSlot } from "./jsonata";
import { not } from "./jsonata";
import type { PassNode } from "./steps";
import { PassBuilder } from "./steps";
import type { SubflowNode } from "./subflow";
import { SubflowBuilder, subflow } from "./subflow";
import type { TaskNode } from "./task";
import { TaskBuilder } from "./task";

export type StepName = string;
export type InlineSubflowStepLike = PassBuilder | PassNode | TaskBuilder | TaskNode;
export type InlineSubflowTarget = InlineSubflowStepLike | SubflowBuilder | SubflowNode;
export type SubflowTarget = StepName | InlineSubflowTarget;

export type ChoiceRule = {
  condition: JsonataSlot;
  next: StepName;
  inlineTarget?: SubflowNode;
};

export type ChoiceNode = {
  kind: "choice";
  name: string;
  choices: ChoiceRule[];
  comment?: string;
  otherwise?: StepName;
  otherwiseInlineTarget?: SubflowNode;
};

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
    catch: node.catch ? node.catch.map((policy) => ({
      ...policy,
      ErrorEquals: [...policy.ErrorEquals],
      inlineTarget: policy.inlineTarget ? cloneSubflowNode(policy.inlineTarget) : undefined,
    })) : undefined,
  };
}

function cloneChoiceNode(node: ChoiceNode): ChoiceNode {
  return {
    ...node,
    choices: node.choices.map((rule) => ({
      ...rule,
      inlineTarget: rule.inlineTarget ? cloneSubflowNode(rule.inlineTarget) : undefined,
    })),
    otherwiseInlineTarget: node.otherwiseInlineTarget
      ? cloneSubflowNode(node.otherwiseInlineTarget)
      : undefined,
  };
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

function isPassBuilder(target: InlineSubflowStepLike): target is PassBuilder {
  return target instanceof PassBuilder;
}

function isTaskBuilder(target: InlineSubflowStepLike): target is TaskBuilder {
  return target instanceof TaskBuilder;
}

function isSubflowBuilder(target: InlineSubflowTarget): target is SubflowBuilder {
  return target instanceof SubflowBuilder;
}

function isSubflowNode(target: InlineSubflowTarget): target is SubflowNode {
  return typeof target === "object" && target !== null && "kind" in target && target.kind === "subflow";
}

function materializeInlineSubflowStep(target: InlineSubflowStepLike): PassNode | TaskNode {
  if (isPassBuilder(target)) return target.build();
  if (isTaskBuilder(target)) return target.build();
  return target.kind === "pass" ? clonePassNode(target) : cloneTaskNode(target);
}

function materializeInlineSubflowTarget(target: InlineSubflowTarget): SubflowNode {
  if (isSubflowBuilder(target)) return target.build();
  if (isSubflowNode(target)) return cloneSubflowNode(target);
  return subflow(materializeInlineSubflowStep(target)).build();
}

function cloneRule(rule: ChoiceRule): ChoiceRule {
  return {
    ...rule,
    inlineTarget: rule.inlineTarget ? cloneSubflowNode(rule.inlineTarget) : undefined,
  };
}

function materializeSubflowTarget(target: SubflowTarget): {
  next: StepName;
  inlineTarget?: SubflowNode;
} {
  if (typeof target === "string") {
    return { next: target };
  }

  const inlineTarget = materializeInlineSubflowTarget(target);
  return {
    next: inlineTarget.states[0].name,
    inlineTarget,
  };
}

export class ChoiceBuilder {
  private readonly node: ChoiceNode;

  constructor(name: string) {
    this.node = {
      kind: "choice",
      name,
      choices: [],
    };
  }

  when(condition: JsonataSlot, target: SubflowTarget): this {
    const materialized = materializeSubflowTarget(target);
    this.node.choices.push({ condition, ...materialized });
    return this;
  }

  whenTrue(condition: JsonataSlot, target: SubflowTarget): this {
    return this.when(condition, target);
  }

  whenFalse(condition: JsonataSlot, target: SubflowTarget): this {
    return this.when(not(condition), target);
  }

  comment(value: string): this {
    this.node.comment = value;
    return this;
  }

  otherwise(target: SubflowTarget): this {
    const materialized = materializeSubflowTarget(target);
    this.node.otherwise = materialized.next;
    this.node.otherwiseInlineTarget = materialized.inlineTarget;
    return this;
  }

  build(): ChoiceNode {
    if (this.node.choices.length === 0) {
      throw new Error(`Choice state ${this.node.name} must declare at least one when(...) branch`);
    }

    return {
      ...this.node,
      choices: this.node.choices.map(cloneRule),
      otherwiseInlineTarget: this.node.otherwiseInlineTarget
        ? cloneSubflowNode(this.node.otherwiseInlineTarget)
        : undefined,
    };
  }
}

export function choice(name: string): ChoiceBuilder {
  return new ChoiceBuilder(name);
}

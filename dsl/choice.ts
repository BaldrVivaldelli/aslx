import type { JsonataSlot } from "./jsonata";
import { not } from "./jsonata";
import type { StateMachineQueryLanguage } from "./state-machine";
import type { RawStateNode } from "./raw-state";
import type { PassNode, StepName } from "./steps";
import { PassBuilder } from "./steps";
import type { SubflowNode } from "./subflow";
import { SubflowBuilder, cloneSubflowNode, subflow } from "./subflow";
import type { TaskArgumentValue, TaskNode } from "./task";
import { cloneTaskNode, TaskBuilder } from "./task";

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
  /** Optional state-level query language override (emits `QueryLanguage` in the state object). */
  queryLanguage?: StateMachineQueryLanguage;
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

// function cloneTaskArgumentValue(value: TaskArgumentValue): TaskArgumentValue;
// function cloneTaskArgumentValue(value: TaskArgumentValue | undefined): TaskArgumentValue | undefined;
// function cloneTaskArgumentValue(value: TaskArgumentValue | undefined): TaskArgumentValue | undefined {
//   if (value === undefined) return undefined;

//   if (Array.isArray(value)) {
//     // value es TaskArgumentValue[], pero cada item puede ser TaskArgumentValue (no undefined)
//     return value.map((item) => cloneTaskArgumentValue(item));
//   }

//   if (value !== null && typeof value === "object" && !("__kind" in value)) {
//     const out: Record<string, TaskArgumentValue> = {};
//     for (const [key, item] of Object.entries(value)) {
//       // item puede ser TaskArgumentValue | undefined dependiendo de tu tipo de record
//       out[key] = cloneTaskArgumentValue(item as TaskArgumentValue);
//     }
//     return out;
//   }

//   return value;
// }

// function cloneTaskNode(node: TaskNode): TaskNode {
//   return {
//     ...node,
//     arguments: cloneTaskArgumentValue(node.arguments),
//     retry: node.retry ? node.retry.map((policy) => ({ ...policy, ErrorEquals: [...policy.ErrorEquals] })) : undefined,
//     catch: node.catch ? node.catch.map((policy) => ({
//       ...policy,
//       ErrorEquals: [...policy.ErrorEquals],
//       inlineTarget: policy.inlineTarget ? cloneSubflowNode(policy.inlineTarget) : undefined,
//     })) : undefined,
//   };
// }

export function cloneChoiceNode(node: ChoiceNode): ChoiceNode {
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

  queryLanguage(value: StateMachineQueryLanguage): this {
    this.node.queryLanguage = value;
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

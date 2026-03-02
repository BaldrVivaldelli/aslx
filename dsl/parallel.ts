import type { RetryPolicy, TaskArgumentValue, TaskNode } from "./task";
import type { PassAssignMap, PassAssignValue, PassContent, StepName } from "./steps";
import type { StateMachineQueryLanguage } from "./state-machine";
import type { RawStateNode } from "./raw-state";
import type { SubflowNode } from "./subflow";
import { SubflowBuilder, subflow } from "./subflow";
import type { PassNode } from "./steps";
import { PassBuilder } from "./steps";
import { TaskBuilder } from "./task";

export type ParallelCatchPolicy = {
  ErrorEquals: string[];
  Next: StepName;
  /** JSONPath-only */
  ResultPath?: string;
  /** JSONata-only */
  Output?: PassContent;
  /** Variables */
  Assign?: PassAssignMap;
  inlineTarget?: SubflowNode;
};

export type ParallelNode = {
  kind: "parallel";
  name: string;
  /** Optional state-level query language override (emits `QueryLanguage` in the state object). */
  queryLanguage?: StateMachineQueryLanguage;
  branches: SubflowNode[];
  comment?: string;
  /** JSONata-only */
  arguments?: TaskArgumentValue;
  /** JSONata-only */
  output?: PassContent;
  /** Variables */
  assign?: PassAssignMap;
  retry?: RetryPolicy[];
  /** JSONPath-only */
  resultSelector?: TaskArgumentValue;
  /** JSONPath-only */
  resultPath?: string;
  catch?: ParallelCatchPolicy[];
  next?: StepName;
  end?: true;
};

export type InlineParallelStepLike = PassBuilder | PassNode | TaskBuilder | TaskNode;
export type InlineParallelTarget = InlineParallelStepLike | SubflowBuilder | SubflowNode;
export type ParallelCatchTarget = StepName | InlineParallelTarget;
export type ParallelCatchOptions = {
  /** JSONPath-only */
  resultPath?: string;
  /** JSONata-only */
  output?: PassContent;
  /** Variables */
  assign?: PassAssignMap;
};

function cloneTaskArgumentValue(value: TaskArgumentValue | undefined): TaskArgumentValue | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value.map((item) => cloneTaskArgumentValue(item) as TaskArgumentValue);
  if (value !== null && typeof value === "object" && !("__kind" in value)) {
    const out: Record<string, TaskArgumentValue> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = cloneTaskArgumentValue(item as TaskArgumentValue) as TaskArgumentValue;
    }
    return out;
  }
  return value;
}

function clonePassNode(node: PassNode): PassNode {
  return {
    ...node,
    assign: node.assign ? { ...node.assign } : undefined,
  };
}

function cloneTaskNode(node: TaskNode): TaskNode {
  return {
    ...node,
    assign: node.assign ? { ...node.assign } : undefined,
    arguments: cloneTaskArgumentValue(node.arguments),
    resultSelector: cloneTaskArgumentValue(node.resultSelector),
    retry: node.retry ? node.retry.map((policy) => ({ ...policy, ErrorEquals: [...policy.ErrorEquals] })) : undefined,
    catch: node.catch ? node.catch.map((policy) => ({
      ...policy,
      ErrorEquals: [...policy.ErrorEquals],
      Assign: policy.Assign ? { ...policy.Assign } : undefined,
      inlineTarget: policy.inlineTarget ? cloneSubflowNode(policy.inlineTarget) : undefined,
    })) : undefined,
  };
}

function cloneChoiceNode(node: import("./choice").ChoiceNode): import("./choice").ChoiceNode {
  return {
    ...node,
    choices: node.choices.map((rule) => ({
      ...rule,
      inlineTarget: rule.inlineTarget ? cloneSubflowNode(rule.inlineTarget) : undefined,
    })),
    otherwiseInlineTarget: node.otherwiseInlineTarget ? cloneSubflowNode(node.otherwiseInlineTarget) : undefined,
  };
}

function cloneSubflowNode(node: SubflowNode): SubflowNode {
  return {
    kind: "subflow",
    states: node.states.map((state) => {
      if (state.kind === "pass") return clonePassNode(state);
      if (state.kind === "task") return cloneTaskNode(state);
      if (state.kind === "raw") {
        return {
          ...state,
          asl: structuredClone((state as RawStateNode).asl),
        } as RawStateNode;
      }
      return cloneChoiceNode(state);
    }),
  };
}

function isPassBuilder(target: InlineParallelStepLike): target is PassBuilder {
  return target instanceof PassBuilder;
}

function isTaskBuilder(target: InlineParallelStepLike): target is TaskBuilder {
  return target instanceof TaskBuilder;
}

function isSubflowBuilder(target: InlineParallelTarget): target is SubflowBuilder {
  return target instanceof SubflowBuilder;
}

function isSubflowNode(target: InlineParallelTarget): target is SubflowNode {
  return typeof target === "object" && target !== null && "kind" in target && target.kind === "subflow";
}

function materializeInlineParallelStep(target: InlineParallelStepLike): PassNode | TaskNode {
  if (isPassBuilder(target)) return target.build();
  if (isTaskBuilder(target)) return target.build();
  return target.kind === "pass" ? clonePassNode(target) : cloneTaskNode(target);
}

function materializeInlineParallelTarget(target: InlineParallelTarget): SubflowNode {
  if (isSubflowBuilder(target)) return target.build();
  if (isSubflowNode(target)) return cloneSubflowNode(target);
  return subflow(materializeInlineParallelStep(target)).build();
}

function materializeCatchTarget(target: ParallelCatchTarget): { next: StepName; inlineTarget?: SubflowNode } {
  if (typeof target === "string") {
    return { next: target };
  }

  const inlineTarget = materializeInlineParallelTarget(target);
  return {
    next: inlineTarget.states[0]!.name,
    inlineTarget,
  };
}

export class ParallelBuilder {
  private readonly node: ParallelNode;

  constructor(name: string) {
    this.node = {
      kind: "parallel",
      name,
      branches: [],
    };
  }

  comment(value: string): this {
    this.node.comment = value;
    return this;
  }

  queryLanguage(value: StateMachineQueryLanguage): this {
    this.node.queryLanguage = value;
    return this;
  }

  arguments(argumentsValue: TaskArgumentValue): this {
    this.node.arguments = argumentsValue;
    return this;
  }

  argument(name: string, value: TaskArgumentValue): this {
    const current = this.node.arguments;

    if (current === undefined) {
      this.node.arguments = { [name]: value };
      return this;
    }

    if (current === null || typeof current !== "object" || Array.isArray(current) || ("__kind" in (current as any))) {
      throw new Error(`Parallel state ${this.node.name} cannot merge argument ${name} into non-object arguments.`);
    }

    this.node.arguments = {
      ...(current as Record<string, TaskArgumentValue>),
      [name]: value,
    };

    return this;
  }

  output(output: PassContent): this {
    this.node.output = output;
    return this;
  }

  assign(name: string, value: PassAssignValue): this {
    this.node.assign ??= {};
    this.node.assign[name] = value;
    return this;
  }

  assigns(values: PassAssignMap): this {
    this.node.assign ??= {};
    Object.assign(this.node.assign, values);
    return this;
  }

  retry(policy: RetryPolicy | RetryPolicy[]): this {
    this.node.retry = Array.isArray(policy) ? [...policy] : [policy];
    return this;
  }

  branch(flow: SubflowBuilder | SubflowNode): this {
    const materialized = flow instanceof SubflowBuilder ? flow.build() : cloneSubflowNode(flow);
    this.node.branches.push(materialized);
    return this;
  }

  resultSelector(selector: TaskArgumentValue): this {
    this.node.resultSelector = selector;
    return this;
  }

  resultPath(path: string): this {
    this.node.resultPath = path;
    return this;
  }

  catch(errorEquals: string | string[], target: ParallelCatchTarget, options: ParallelCatchOptions = {}): this {
    const normalizedErrors = Array.isArray(errorEquals) ? [...errorEquals] : [errorEquals];
    if (normalizedErrors.length === 0) {
      throw new Error(`Parallel state ${this.node.name} cannot declare an empty catch policy.`);
    }

    const materialized = materializeCatchTarget(target);
    const policy: ParallelCatchPolicy = {
      ErrorEquals: normalizedErrors,
      Next: materialized.next,
      ...(options.resultPath ? { ResultPath: options.resultPath } : {}),
      ...(options.output !== undefined ? { Output: options.output } : {}),
      ...(options.assign ? { Assign: options.assign } : {}),
      ...(materialized.inlineTarget ? { inlineTarget: materialized.inlineTarget } : {}),
    };

    this.node.catch = [...(this.node.catch ?? []), policy];
    return this;
  }

  catchAll(target: ParallelCatchTarget, options: ParallelCatchOptions = {}): this {
    return this.catch(["States.ALL"], target, options);
  }

  next(stepName: StepName): this {
    delete this.node.end;
    this.node.next = stepName;
    return this;
  }

  end(): this {
    delete this.node.next;
    this.node.end = true;
    return this;
  }

  build(): ParallelNode {
    if (this.node.branches.length === 0) {
      throw new Error(`Parallel state ${this.node.name} must declare at least one branch`);
    }

    if (this.node.next !== undefined && this.node.end === true) {
      throw new Error(`Parallel state ${this.node.name} cannot declare both next and end`);
    }

    return {
      kind: "parallel",
      name: this.node.name,
      queryLanguage: this.node.queryLanguage,
      branches: this.node.branches.map(cloneSubflowNode),
      comment: this.node.comment,
      arguments: cloneTaskArgumentValue(this.node.arguments),
      output: this.node.output,
      assign: this.node.assign ? { ...this.node.assign } : undefined,
      retry: this.node.retry ? this.node.retry.map((policy) => ({ ...policy, ErrorEquals: [...policy.ErrorEquals] })) : undefined,
      resultSelector: cloneTaskArgumentValue(this.node.resultSelector),
      resultPath: this.node.resultPath,
      catch: this.node.catch ? this.node.catch.map((policy) => ({
        ...policy,
        ErrorEquals: [...policy.ErrorEquals],
        Assign: policy.Assign ? { ...policy.Assign } : undefined,
        inlineTarget: policy.inlineTarget ? cloneSubflowNode(policy.inlineTarget) : undefined,
      })) : undefined,
      next: this.node.next,
      ...(this.node.end === true ? { end: true } : {}),
    };
  }
}

export function parallel(name: string): ParallelBuilder {
  return new ParallelBuilder(name);
}

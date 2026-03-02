import type { PassAssignMap, PassAssignValue, PassContent, PassNode } from "./steps";
import { PassBuilder } from "./steps";
import type { JsonataSlot } from "./jsonata";
import type { SubflowNode } from "./subflow";
import { SubflowBuilder, subflow } from "./subflow";

export type StepName = string;

export type TaskArgumentValue =
  | string
  | number
  | boolean
  | null
  | JsonataSlot
  | TaskArgumentValue[]
  | { [key: string]: TaskArgumentValue };

export type RetryPolicy = {
  ErrorEquals: string[];
  IntervalSeconds?: number;
  MaxAttempts?: number;
  BackoffRate?: number;
  MaxDelaySeconds?: number;
  JitterStrategy?: "FULL" | "NONE";
};

export type CatchPolicy = {
  ErrorEquals: string[];
  Next: StepName;
  /** JSONPath-only */
  ResultPath?: string;
  /** JSONata-only */
  Output?: PassContent;
  /** JSONata / Variables */
  Assign?: PassAssignMap;
  inlineTarget?: SubflowNode;
};

export type TaskNode = {
  kind: "task";
  name: string;
  resource: string;
  arguments?: TaskArgumentValue;
  /** JSONPath-only */
  resultSelector?: TaskArgumentValue;
  /** JSONPath-only */
  resultPath?: string;
  /** JSONata-only */
  output?: PassContent;
  /** Variables */
  assign?: PassAssignMap;
  timeoutSeconds?: number;
  heartbeatSeconds?: number;
  retry?: RetryPolicy[];
  catch?: CatchPolicy[];
  comment?: string;
  next?: StepName;
  end?: true;
};

export type InlineCatchStepLike = PassBuilder | PassNode | TaskBuilder | TaskNode;
export type InlineCatchTarget = InlineCatchStepLike | SubflowBuilder | SubflowNode;
export type CatchTarget = StepName | InlineCatchTarget;
export type CatchOptions = {
  /** JSONPath-only */
  resultPath?: string;
  /** JSONata-only */
  output?: PassContent;
  /** Variables */
  assign?: PassAssignMap;
};

function isTaskArgumentRecord(value: TaskArgumentValue | undefined): value is Record<string, TaskArgumentValue> {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && !("__kind" in value);
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
    return value.map((item) => cloneTaskArgumentValue(item) as never);
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

function cloneTaskNode(node: TaskNode): TaskNode {
  return {
    ...node,
    assign: node.assign ? { ...node.assign } : undefined,
    arguments: cloneTaskArgumentValue(node.arguments),
    resultSelector: cloneTaskArgumentValue(node.resultSelector),
    retry: node.retry ? node.retry.map((policy) => ({ ...policy, ErrorEquals: [...policy.ErrorEquals] })) : undefined,
    catch: node.catch ? node.catch.map(cloneCatchPolicy) : undefined,
  };
}

function cloneSubflowNode(node: SubflowNode): SubflowNode {
  return {
    kind: "subflow",
    states: node.states.map((state) => {
      if (state.kind === "pass") return clonePassNode(state);
      if (state.kind === "task") return cloneTaskNode(state);
      return {
        ...state,
        choices: state.choices.map((rule) => ({
          ...rule,
          inlineTarget: rule.inlineTarget ? cloneSubflowNode(rule.inlineTarget) : undefined,
        })),
        otherwiseInlineTarget: state.otherwiseInlineTarget ? cloneSubflowNode(state.otherwiseInlineTarget) : undefined,
      };
    }),
  };
}

function cloneCatchPolicy(policy: CatchPolicy): CatchPolicy {
  return {
    ...policy,
    ErrorEquals: [...policy.ErrorEquals],
    Assign: policy.Assign ? { ...policy.Assign } : undefined,
    inlineTarget: policy.inlineTarget ? cloneSubflowNode(policy.inlineTarget) : undefined,
  };
}

function isPassBuilder(target: InlineCatchStepLike): target is PassBuilder {
  return target instanceof PassBuilder;
}

function isTaskBuilder(target: InlineCatchStepLike): target is TaskBuilder {
  return target instanceof TaskBuilder;
}

function isSubflowBuilder(target: InlineCatchTarget): target is SubflowBuilder {
  return target instanceof SubflowBuilder;
}

function isSubflowNode(target: InlineCatchTarget): target is SubflowNode {
  return typeof target === "object" && target !== null && "kind" in target && target.kind === "subflow";
}

function materializeInlineCatchStep(target: InlineCatchStepLike): PassNode | TaskNode {
  if (isPassBuilder(target)) return target.build();
  if (isTaskBuilder(target)) return target.build();
  return target.kind === "pass" ? clonePassNode(target) : cloneTaskNode(target);
}

function materializeInlineCatchTarget(target: InlineCatchTarget): SubflowNode {
  if (isSubflowBuilder(target)) return target.build();
  if (isSubflowNode(target)) return cloneSubflowNode(target);
  return subflow(materializeInlineCatchStep(target)).build();
}

function materializeCatchTarget(target: CatchTarget): { next: StepName; inlineTarget?: SubflowNode } {
  if (typeof target === "string") {
    return { next: target };
  }

  const inlineTarget = materializeInlineCatchTarget(target);
  return {
    next: inlineTarget.states[0].name,
    inlineTarget,
  };
}

export class TaskBuilder {
  protected readonly node: Partial<TaskNode> & Pick<TaskNode, "kind" | "name">;

  constructor(name: string) {
    this.node = {
      kind: "task",
      name,
    };
  }

  resource(resource: string): this {
    this.node.resource = resource;
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

    if (!isTaskArgumentRecord(current)) {
      throw new Error(`Task state ${this.node.name} cannot merge argument ${name} into non-object arguments.`);
    }

    this.node.arguments = {
      ...current,
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

  resultSelector(selector: TaskArgumentValue): this {
    this.node.resultSelector = selector;
    return this;
  }

  resultPath(path: string): this {
    this.node.resultPath = path;
    return this;
  }


  retry(policy: RetryPolicy | RetryPolicy[]): this {
    this.node.retry = Array.isArray(policy) ? [...policy] : [policy];
    return this;
  }

  timeoutSeconds(seconds: number): this {
    this.node.timeoutSeconds = seconds;
    return this;
  }

  heartbeatSeconds(seconds: number): this {
    this.node.heartbeatSeconds = seconds;
    return this;
  }


  catch(errorEquals: string | string[], target: CatchTarget, options: CatchOptions = {}): this {
    const normalizedErrors = Array.isArray(errorEquals) ? [...errorEquals] : [errorEquals];
    if (normalizedErrors.length === 0) {
      throw new Error(`Task state ${this.node.name} cannot declare an empty catch policy.`);
    }

    const materialized = materializeCatchTarget(target);
    const policy: CatchPolicy = {
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

  catchAll(target: CatchTarget, options: CatchOptions = {}): this {
    return this.catch(["States.ALL"], target, options);
  }

  comment(value: string): this {
    this.node.comment = value;
    return this;
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

  build(): TaskNode {
    if (!this.node.resource) {
      throw new Error(`Task state ${this.node.name} must declare a resource`);
    }

    if (this.node.next !== undefined && this.node.end === true) {
      throw new Error(`Task state ${this.node.name} cannot declare both next and end`);
    }

    return {
      kind: "task",
      name: this.node.name,
      resource: this.node.resource,
      arguments: this.node.arguments,
      resultSelector: this.node.resultSelector,
      resultPath: this.node.resultPath,
      output: this.node.output,
      assign: this.node.assign ? { ...this.node.assign } : undefined,
      timeoutSeconds: this.node.timeoutSeconds,
      heartbeatSeconds: this.node.heartbeatSeconds,
      retry: this.node.retry ? [...this.node.retry] : undefined,
      catch: this.node.catch ? this.node.catch.map(cloneCatchPolicy) : undefined,
      comment: this.node.comment,
      next: this.node.next,
      ...(this.node.end === true ? { end: true } : {}),
    };
  }
}

export function task(name: string): TaskBuilder {
  return new TaskBuilder(name);
}

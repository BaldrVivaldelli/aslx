import type { JsonataSlot } from "./jsonata";
import type { PassContent } from "./steps";

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

export type TaskNode = {
  kind: "task";
  name: string;
  resource: string;
  arguments?: TaskArgumentValue;
  output?: PassContent;
  retry?: RetryPolicy[];
  comment?: string;
  next?: StepName;
  end?: true;
};

function isTaskArgumentRecord(value: TaskArgumentValue | undefined): value is Record<string, TaskArgumentValue> {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && !("__kind" in value);
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

  retry(policy: RetryPolicy | RetryPolicy[]): this {
    this.node.retry = Array.isArray(policy) ? [...policy] : [policy];
    return this;
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
      output: this.node.output,
      retry: this.node.retry ? [...this.node.retry] : undefined,
      comment: this.node.comment,
      next: this.node.next,
      ...(this.node.end === true ? { end: true } : {}),
    };
  }
}

export function task(name: string): TaskBuilder {
  return new TaskBuilder(name);
}

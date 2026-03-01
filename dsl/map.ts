import type { JsonataSlot } from "./jsonata";
import type { StepName } from "./steps";
import type { PassNode } from "./steps";
import { PassBuilder } from "./steps";
import type { SubflowNode } from "./subflow";
import { SubflowBuilder, subflow } from "./subflow";
import type { TaskArgumentValue, TaskNode } from "./task";
import { TaskBuilder } from "./task";

/**
 * Map state builder (Inline mode).
 *
 * This models AWS Step Functions `Map` using the newer `ItemProcessor` field.
 * It intentionally mirrors the ergonomics of `task(...)` and `parallel(...)`:
 *
 * - Supports inline `catch(...)` subflows
 * - Supports `resultSelector(...)` + `resultPath(...)` for result shaping
 */
export type MapCatchPolicy = {
  ErrorEquals: string[];
  Next: StepName;
  ResultPath?: string;
  inlineTarget?: SubflowNode;
};

export type MapNode = {
  kind: "map";
  name: string;

  // Dataset selection
  items?: TaskArgumentValue;   // JSONata (Items)
  itemsPath?: string;          // JSONPath (ItemsPath)

  // Per-item input shaping
  itemSelector?: TaskArgumentValue;

  // Concurrency control
  maxConcurrency?: number | JsonataSlot;

  // The workflow run for each item
  itemProcessor?: SubflowNode;

  comment?: string;

  // Result controls
  resultSelector?: TaskArgumentValue;
  resultPath?: string;

  // Error handling
  catch?: MapCatchPolicy[];

  // Transitions
  next?: StepName;
  end?: true;
};

export type InlineMapStepLike = PassBuilder | PassNode | TaskBuilder | TaskNode;
export type InlineMapTarget = InlineMapStepLike | SubflowBuilder | SubflowNode;
export type MapCatchTarget = StepName | InlineMapTarget;

export type MapCatchOptions = {
  resultPath?: string;
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
      return cloneChoiceNode(state);
    }),
  };
}

function isPassBuilder(target: InlineMapStepLike): target is PassBuilder {
  return target instanceof PassBuilder;
}

function isTaskBuilder(target: InlineMapStepLike): target is TaskBuilder {
  return target instanceof TaskBuilder;
}

function isSubflowBuilder(target: InlineMapTarget): target is SubflowBuilder {
  return target instanceof SubflowBuilder;
}

function isSubflowNode(target: InlineMapTarget): target is SubflowNode {
  return typeof target === "object" && target !== null && "kind" in target && target.kind === "subflow";
}

function materializeInlineMapStep(target: InlineMapStepLike): PassNode | TaskNode {
  if (isPassBuilder(target)) return target.build();
  if (isTaskBuilder(target)) return target.build();
  return target.kind === "pass" ? clonePassNode(target) : cloneTaskNode(target);
}

function materializeInlineMapTarget(target: InlineMapTarget): SubflowNode {
  if (isSubflowBuilder(target)) return target.build();
  if (isSubflowNode(target)) return cloneSubflowNode(target);
  return subflow(materializeInlineMapStep(target)).build();
}

function materializeCatchTarget(target: MapCatchTarget): { next: StepName; inlineTarget?: SubflowNode } {
  if (typeof target === "string") {
    return { next: target };
  }

  const inlineTarget = materializeInlineMapTarget(target);
  return {
    next: inlineTarget.states[0]!.name,
    inlineTarget,
  };
}

export class MapBuilder {
  private readonly node: MapNode;

  constructor(name: string) {
    this.node = {
      kind: "map",
      name,
    };
  }

  comment(value: string): this {
    this.node.comment = value;
    return this;
  }

  /**
   * JSONata-friendly dataset selection.
   * Compiles to `Items`.
   */
  items(value: TaskArgumentValue): this {
    this.node.items = value;
    return this;
  }

  /**
   * JSONPath dataset selection.
   * Compiles to `ItemsPath`.
   */
  itemsPath(value: string): this {
    this.node.itemsPath = value;
    return this;
  }

  /**
   * Shapes the per-iteration input.
   * Compiles to `ItemSelector`.
   */
  itemSelector(value: TaskArgumentValue): this {
    this.node.itemSelector = value;
    return this;
  }

  /**
   * Concurrency cap for Inline mode.
   * - `0` means "no explicit cap" (Step Functions default).
   * - `1` runs sequentially.
   */
  maxConcurrency(value: number | JsonataSlot): this {
    this.node.maxConcurrency = value;
    return this;
  }

  /**
   * Sets the workflow run for each item.
   * Compiles to `ItemProcessor`.
   */
  itemProcessor(flow: SubflowBuilder | SubflowNode): this {
    const materialized = flow instanceof SubflowBuilder ? flow.build() : cloneSubflowNode(flow);
    this.node.itemProcessor = materialized;
    return this;
  }

  /**
   * Alias for `itemProcessor(...)`.
   */
  processor(flow: SubflowBuilder | SubflowNode): this {
    return this.itemProcessor(flow);
  }

  resultSelector(selector: TaskArgumentValue): this {
    this.node.resultSelector = selector;
    return this;
  }

  resultPath(path: string): this {
    this.node.resultPath = path;
    return this;
  }

  catch(errorEquals: string | string[], target: MapCatchTarget, options: MapCatchOptions = {}): this {
    const normalizedErrors = Array.isArray(errorEquals) ? [...errorEquals] : [errorEquals];
    if (normalizedErrors.length === 0) {
      throw new Error(`Map state ${this.node.name} cannot declare an empty catch policy.`);
    }

    const materialized = materializeCatchTarget(target);
    const policy: MapCatchPolicy = {
      ErrorEquals: normalizedErrors,
      Next: materialized.next,
      ...(options.resultPath ? { ResultPath: options.resultPath } : {}),
      ...(materialized.inlineTarget ? { inlineTarget: materialized.inlineTarget } : {}),
    };

    this.node.catch = [...(this.node.catch ?? []), policy];
    return this;
  }

  catchAll(target: MapCatchTarget, options: MapCatchOptions = {}): this {
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

  build(): MapNode {
    if (this.node.items === undefined && this.node.itemsPath === undefined) {
      throw new Error(`Map state ${this.node.name} must declare items(...) or itemsPath(...)`);
    }

    if (this.node.items !== undefined && this.node.itemsPath !== undefined) {
      throw new Error(`Map state ${this.node.name} cannot declare both items(...) and itemsPath(...)`);
    }

    if (!this.node.itemProcessor) {
      throw new Error(`Map state ${this.node.name} must declare an item processor via itemProcessor(...)`);
    }

    if (this.node.next !== undefined && this.node.end === true) {
      throw new Error(`Map state ${this.node.name} cannot declare both next and end`);
    }

    return {
      kind: "map",
      name: this.node.name,
      items: cloneTaskArgumentValue(this.node.items),
      itemsPath: this.node.itemsPath,
      itemSelector: cloneTaskArgumentValue(this.node.itemSelector),
      maxConcurrency: this.node.maxConcurrency,
      itemProcessor: cloneSubflowNode(this.node.itemProcessor),
      comment: this.node.comment,
      resultSelector: cloneTaskArgumentValue(this.node.resultSelector),
      resultPath: this.node.resultPath,
      catch: this.node.catch ? this.node.catch.map((policy) => ({
        ...policy,
        ErrorEquals: [...policy.ErrorEquals],
        inlineTarget: policy.inlineTarget ? cloneSubflowNode(policy.inlineTarget) : undefined,
      })) : undefined,
      next: this.node.next,
      ...(this.node.end === true ? { end: true } : {}),
    };
  }
}

export function map(name: string): MapBuilder {
  return new MapBuilder(name);
}

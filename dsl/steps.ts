import type { JsonataSlot } from "./jsonata";
import type { StateMachineQueryLanguage } from "./state-machine";

export type StepName = string;
export type StepResultPath = string;

export type PassContent =
  | JsonataSlot
  | Record<string, unknown>
  | string
  | number
  | boolean
  | null;

export type PassAssignValue = PassContent;
export type PassAssignMap = Record<string, PassAssignValue>;

export type PassNode = {
  kind: "pass";
  name: string;
  queryLanguage?: StateMachineQueryLanguage;
  content?: PassContent;
  assign?: PassAssignMap;
  comment?: string;
  next?: StepName;
  end?: true;
};

export class PassBuilder {
  private readonly node: PassNode;

  constructor(name: string) {
    this.node = {
      kind: "pass",
      name,
    };
  }

  content(content: PassContent): this {
    this.node.content = content;
    return this;
  }

  queryLanguage(value: StateMachineQueryLanguage): this {
    this.node.queryLanguage = value;
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

  build(): PassNode {
    return {
      ...this.node,
      assign: this.node.assign ? { ...this.node.assign } : undefined,
    };
  }
}

export function pass(name: string): PassBuilder {
  return new PassBuilder(name);
}

import type { ChoiceNode } from "../dsl/choice";
import type { StateMachineNode, StepNode } from "../dsl/state-machine";
import type { PassNode } from "../dsl/steps";
import type { TaskNode } from "../dsl/task";
import type { NormalizedStateMachine } from "./normalize-state-machine";

export type ValidationSeverity = "error";

export type ValidationIssueCode =
  | "MACHINE_NO_STATES"
  | "INVALID_START_AT"
  | "DUPLICATE_STATE_NAME"
  | "UNKNOWN_TRANSITION_TARGET"
  | "UNREACHABLE_STATE"
  | "PASS_CONFLICTING_TRANSITION"
  | "PASS_MISSING_TRANSITION"
  | "TASK_MISSING_RESOURCE"
  | "TASK_CONFLICTING_TRANSITION"
  | "TASK_MISSING_TRANSITION"
  | "CHOICE_NO_BRANCHES";

export type ValidationIssue = {
  severity: ValidationSeverity;
  code: ValidationIssueCode;
  message: string;
  stateName?: string;
  path?: string;
};

export class StateMachineValidationError extends Error {
  readonly issues: ValidationIssue[];

  constructor(machineName: string, issues: ValidationIssue[]) {
    const lines = [`State machine ${machineName} failed validation:`];
    for (const issue of issues) {
      const where = issue.stateName ? ` [${issue.stateName}]` : "";
      const path = issue.path ? ` at ${issue.path}` : "";
      lines.push(`- ${issue.code}${where}${path}: ${issue.message}`);
    }
    super(lines.join("\n"));
    this.name = "StateMachineValidationError";
    this.issues = issues;
  }
}

function visitReachable(
  stateName: string,
  machine: NormalizedStateMachine,
  seen: Set<string>,
): void {
  if (seen.has(stateName)) return;
  seen.add(stateName);

  const state = machine.stateMap[stateName];
  if (!state) return;

  if (state.kind === "pass" || state.kind === "task") {
    if (state.next) visitReachable(state.next, machine, seen);
    return;
  }

  for (const choice of state.choices) {
    visitReachable(choice.next, machine, seen);
  }

  if (state.otherwise) {
    visitReachable(state.otherwise, machine, seen);
  }
}

function validatePassState(node: PassNode, issues: ValidationIssue[]): void {
  if (node.next && node.end) {
    issues.push({
      severity: "error",
      code: "PASS_CONFLICTING_TRANSITION",
      stateName: node.name,
      message: `Pass state ${node.name} cannot declare both next and end.`,
    });
  }

  if (!node.next && node.end !== true) {
    issues.push({
      severity: "error",
      code: "PASS_MISSING_TRANSITION",
      stateName: node.name,
      message: `Pass state ${node.name} must declare either next or end.`,
    });
  }
}

function validateTaskState(node: TaskNode, issues: ValidationIssue[]): void {
  if (!node.resource) {
    issues.push({
      severity: "error",
      code: "TASK_MISSING_RESOURCE",
      stateName: node.name,
      message: `Task state ${node.name} must declare a resource.`,
    });
  }

  if (node.next && node.end) {
    issues.push({
      severity: "error",
      code: "TASK_CONFLICTING_TRANSITION",
      stateName: node.name,
      message: `Task state ${node.name} cannot declare both next and end.`,
    });
  }

  if (!node.next && node.end !== true) {
    issues.push({
      severity: "error",
      code: "TASK_MISSING_TRANSITION",
      stateName: node.name,
      message: `Task state ${node.name} must declare either next or end.`,
    });
  }
}

function validateChoiceState(node: ChoiceNode, issues: ValidationIssue[]): void {
  if (node.choices.length === 0) {
    issues.push({
      severity: "error",
      code: "CHOICE_NO_BRANCHES",
      stateName: node.name,
      message: `Choice state ${node.name} must declare at least one branch.`,
    });
  }
}

export function collectValidationIssues(machine: NormalizedStateMachine): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (machine.states.length === 0) {
    issues.push({
      severity: "error",
      code: "MACHINE_NO_STATES",
      message: `State machine ${machine.name} must contain at least one state.`,
    });
    return issues;
  }

  const seenNames = new Set<string>();
  for (const state of machine.states) {
    if (seenNames.has(state.name)) {
      issues.push({
        severity: "error",
        code: "DUPLICATE_STATE_NAME",
        stateName: state.name,
        message: `Duplicate state name detected: ${state.name}.`,
      });
      continue;
    }

    seenNames.add(state.name);

    if (state.kind === "pass") validatePassState(state, issues);
    else if (state.kind === "task") validateTaskState(state, issues);
    else validateChoiceState(state, issues);
  }

  if (!machine.stateMap[machine.startAt]) {
    issues.push({
      severity: "error",
      code: "INVALID_START_AT",
      message: `StartAt points to unknown state ${machine.startAt}.`,
      path: "StartAt",
    });
  }

  for (const transition of machine.transitions) {
    if (!machine.stateMap[transition.to]) {
      const path = transition.kind === "choice"
        ? `States.${transition.from}.Choices[*].Next`
        : transition.kind === "default"
          ? `States.${transition.from}.Default`
          : `States.${transition.from}.Next`;

      issues.push({
        severity: "error",
        code: "UNKNOWN_TRANSITION_TARGET",
        stateName: transition.from,
        path,
        message: `State ${transition.from} points to unknown state ${transition.to}.`,
      });
    }
  }

  const reachable = new Set<string>();
  if (machine.stateMap[machine.startAt]) {
    visitReachable(machine.startAt, machine, reachable);
  }

  for (const state of machine.states) {
    if (!reachable.has(state.name)) {
      issues.push({
        severity: "error",
        code: "UNREACHABLE_STATE",
        stateName: state.name,
        message: `State ${state.name} is unreachable from StartAt (${machine.startAt}).`,
      });
    }
  }

  return issues;
}

export function validateStateMachine(machine: NormalizedStateMachine): NormalizedStateMachine {
  const issues = collectValidationIssues(machine);
  if (issues.length > 0) {
    throw new StateMachineValidationError(machine.name, issues);
  }
  return machine;
}

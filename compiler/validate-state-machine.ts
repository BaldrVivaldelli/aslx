import type { ChoiceNode } from "../dsl/choice";
import type { ParallelNode } from "../dsl/parallel";
import type { PassNode } from "../dsl/steps";
import type { TaskNode } from "../dsl/task";
import type { NormalizedStateMachine } from "./normalize-state-machine";
import { normalizeStateMachine } from "./normalize-state-machine";

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
  | "TASK_INVALID_RESULT_PATH"
  | "TASK_INVALID_TIMEOUT_SECONDS"
  | "TASK_INVALID_HEARTBEAT_SECONDS"
  | "TASK_HEARTBEAT_EXCEEDS_TIMEOUT"
  | "CHOICE_NO_BRANCHES"
  | "PARALLEL_NO_BRANCHES"
  | "PARALLEL_CONFLICTING_TRANSITION"
  | "PARALLEL_MISSING_TRANSITION"
  | "PARALLEL_INVALID_RESULT_PATH"
  | "PARALLEL_BRANCH_EMPTY"
  | "PARALLEL_BRANCH_INVALID";

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

  if (state.kind === "pass") {
    if (state.next) visitReachable(state.next, machine, seen);
    return;
  }

  if (state.kind === "task" || state.kind === "parallel") {
    if (state.next) visitReachable(state.next, machine, seen);
    for (const policy of state.catch ?? []) {
      visitReachable(policy.Next, machine, seen);
    }
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

function isInteger(value: number): boolean {
  return Number.isInteger(value);
}

function isLikelyJsonPath(value: string): boolean {
  return value === "$" || /^\$\.[A-Za-z0-9_\-]+(?:\.[A-Za-z0-9_\-]+)*$/.test(value);
}

function validateTaskState(node: TaskNode, issues: ValidationIssue[]): void {
  if (!node.resource) {
    issues.push({ severity: "error", code: "TASK_MISSING_RESOURCE", stateName: node.name, message: `Task state ${node.name} must declare a resource.` });
  }
  if (node.next && node.end) {
    issues.push({ severity: "error", code: "TASK_CONFLICTING_TRANSITION", stateName: node.name, message: `Task state ${node.name} cannot declare both next and end.` });
  }
  if (!node.next && node.end !== true) {
    issues.push({ severity: "error", code: "TASK_MISSING_TRANSITION", stateName: node.name, message: `Task state ${node.name} must declare either next or end.` });
  }
  if (node.resultPath !== undefined && (node.resultPath.trim() === "" || !isLikelyJsonPath(node.resultPath))) {
    issues.push({ severity: "error", code: "TASK_INVALID_RESULT_PATH", stateName: node.name, path: `States.${node.name}.ResultPath`, message: `Task state ${node.name} must declare a valid ResultPath like $.result or $.task.output.` });
  }
  if (node.timeoutSeconds !== undefined && (!isInteger(node.timeoutSeconds) || node.timeoutSeconds <= 0)) {
    issues.push({ severity: "error", code: "TASK_INVALID_TIMEOUT_SECONDS", stateName: node.name, path: `States.${node.name}.TimeoutSeconds`, message: `Task state ${node.name} must declare a positive integer TimeoutSeconds value.` });
  }
  if (node.heartbeatSeconds !== undefined && (!isInteger(node.heartbeatSeconds) || node.heartbeatSeconds <= 0)) {
    issues.push({ severity: "error", code: "TASK_INVALID_HEARTBEAT_SECONDS", stateName: node.name, path: `States.${node.name}.HeartbeatSeconds`, message: `Task state ${node.name} must declare a positive integer HeartbeatSeconds value.` });
  }
  if (
    node.timeoutSeconds !== undefined
    && node.heartbeatSeconds !== undefined
    && isInteger(node.timeoutSeconds)
    && isInteger(node.heartbeatSeconds)
    && node.timeoutSeconds > 0
    && node.heartbeatSeconds > 0
    && node.heartbeatSeconds >= node.timeoutSeconds
  ) {
    issues.push({ severity: "error", code: "TASK_HEARTBEAT_EXCEEDS_TIMEOUT", stateName: node.name, path: `States.${node.name}.HeartbeatSeconds`, message: `Task state ${node.name} must declare HeartbeatSeconds smaller than TimeoutSeconds.` });
  }
}

function validateChoiceState(node: ChoiceNode, issues: ValidationIssue[]): void {
  if (node.choices.length === 0) {
    issues.push({ severity: "error", code: "CHOICE_NO_BRANCHES", stateName: node.name, message: `Choice state ${node.name} must declare at least one branch.` });
  }
}

function materializeBranchMachine(node: ParallelNode, index: number): NormalizedStateMachine {
  const branch = node.branches[index]!;
  if (branch.states.length === 0) {
    throw new Error(`Parallel branch ${index} is empty.`);
  }

  const states = structuredClone(branch.states) as Array<PassNode | TaskNode | ChoiceNode>;

  for (let i = 0; i < states.length; i += 1) {
    const current = states[i]!;
    const next = states[i + 1];
    const fallbackNext = next?.name;

    if (current.kind === "pass" || current.kind === "task") {
      if (!current.next && current.end !== true) {
        if (fallbackNext) current.next = fallbackNext;
        else current.end = true;
      }
      continue;
    }

    if (current.otherwise === undefined && fallbackNext) {
      current.otherwise = fallbackNext;
    }
  }

  return normalizeStateMachine({
    kind: "stateMachine",
    name: `${node.name}__branch_${index}`,
    states,
  });
}

function validateParallelBranches(node: ParallelNode, issues: ValidationIssue[]): void {
  node.branches.forEach((branch, index) => {
    if (branch.states.length === 0) {
      issues.push({ severity: "error", code: "PARALLEL_BRANCH_EMPTY", stateName: node.name, path: `States.${node.name}.Branches[${index}]`, message: `Parallel state ${node.name} contains an empty branch at index ${index}.` });
      return;
    }

    try {
      validateStateMachine(materializeBranchMachine(node, index));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      issues.push({ severity: "error", code: "PARALLEL_BRANCH_INVALID", stateName: node.name, path: `States.${node.name}.Branches[${index}]`, message: `Parallel branch ${index} is invalid: ${message}` });
    }
  });
}

function validateParallelState(node: ParallelNode, issues: ValidationIssue[]): void {
  if (node.branches.length === 0) {
    issues.push({ severity: "error", code: "PARALLEL_NO_BRANCHES", stateName: node.name, message: `Parallel state ${node.name} must declare at least one branch.` });
  }
  if (node.next && node.end) {
    issues.push({ severity: "error", code: "PARALLEL_CONFLICTING_TRANSITION", stateName: node.name, message: `Parallel state ${node.name} cannot declare both next and end.` });
  }
  if (!node.next && node.end !== true) {
    issues.push({ severity: "error", code: "PARALLEL_MISSING_TRANSITION", stateName: node.name, message: `Parallel state ${node.name} must declare either next or end.` });
  }
  if (node.resultPath !== undefined && (node.resultPath.trim() === "" || !isLikelyJsonPath(node.resultPath))) {
    issues.push({ severity: "error", code: "PARALLEL_INVALID_RESULT_PATH", stateName: node.name, path: `States.${node.name}.ResultPath`, message: `Parallel state ${node.name} must declare a valid ResultPath like $.parallel or $.context.parallel.` });
  }
  validateParallelBranches(node, issues);
}

export function collectValidationIssues(machine: NormalizedStateMachine): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (machine.states.length === 0) {
    issues.push({ severity: "error", code: "MACHINE_NO_STATES", message: `State machine ${machine.name} must contain at least one state.` });
    return issues;
  }

  const seenNames = new Set<string>();
  for (const state of machine.states) {
    if (seenNames.has(state.name)) {
      issues.push({ severity: "error", code: "DUPLICATE_STATE_NAME", stateName: state.name, message: `Duplicate state name detected: ${state.name}.` });
      continue;
    }

    seenNames.add(state.name);

    if (state.kind === "pass") validatePassState(state, issues);
    else if (state.kind === "task") validateTaskState(state, issues);
    else if (state.kind === "choice") validateChoiceState(state, issues);
    else validateParallelState(state, issues);
  }

  if (!machine.stateMap[machine.startAt]) {
    issues.push({ severity: "error", code: "INVALID_START_AT", message: `StartAt points to unknown state ${machine.startAt}.`, path: "StartAt" });
  }

  for (const transition of machine.transitions) {
    if (!machine.stateMap[transition.to]) {
      const path = transition.kind === "choice"
        ? `States.${transition.from}.Choices[*].Next`
        : transition.kind === "default"
          ? `States.${transition.from}.Default`
          : transition.kind === "catch"
            ? `States.${transition.from}.Catch[*].Next`
            : `States.${transition.from}.Next`;

      issues.push({ severity: "error", code: "UNKNOWN_TRANSITION_TARGET", stateName: transition.from, path, message: `State ${transition.from} points to unknown state ${transition.to}.` });
    }
  }

  const reachable = new Set<string>();
  if (machine.stateMap[machine.startAt]) {
    visitReachable(machine.startAt, machine, reachable);
  }

  for (const state of machine.states) {
    if (!reachable.has(state.name)) {
      issues.push({ severity: "error", code: "UNREACHABLE_STATE", stateName: state.name, message: `State ${state.name} is unreachable from StartAt (${machine.startAt}).` });
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

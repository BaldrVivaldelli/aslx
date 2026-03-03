import type { ChoiceNode } from "../dsl/choice";
import type { ParallelNode } from "../dsl/parallel";
import type { MapNode } from "../dsl/map";
import type { RawStateNode } from "../dsl/raw-state";
import type { PassNode } from "../dsl/steps";
import type { TaskNode } from "../dsl/task";
import { normalizeStateMachine, type NormalizedStateMachine } from "./normalize-state-machine.js";

export type ValidationSeverity = "error";

export type ValidationIssueCode =
  | "MACHINE_NO_STATES"
  | "INVALID_START_AT"
  | "DUPLICATE_STATE_NAME"
  | "UNKNOWN_TRANSITION_TARGET"
  | "UNREACHABLE_STATE"
  | "STATE_QUERY_LANGUAGE_MIX_NOT_ALLOWED"
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
  | "CHOICE_CONDITION_JSONATA_ONLY"
  | "PARALLEL_NO_BRANCHES"
  | "PARALLEL_CONFLICTING_TRANSITION"
  | "PARALLEL_MISSING_TRANSITION"
  | "PARALLEL_INVALID_RESULT_PATH"
  | "PARALLEL_BRANCH_EMPTY"
  | "PARALLEL_BRANCH_INVALID"
  | "MAP_MISSING_ITEMS"
  | "MAP_MISSING_PROCESSOR"
  | "MAP_CONFLICTING_TRANSITION"
  | "MAP_MISSING_TRANSITION"
  | "MAP_INVALID_RESULT_PATH"
  | "MAP_INVALID_MAX_CONCURRENCY"
  | "MAP_PROCESSOR_EMPTY"
  | "MAP_PROCESSOR_INVALID"
  | "RAW_MISSING_TYPE"
  | "RAW_CONFLICTING_TRANSITION"
  | "RAW_MISSING_TRANSITION"
  | "RAW_TERMINAL_HAS_TRANSITION"
  | "RAW_CHOICE_INVALID"
  | "PASS_CONTENT_JSONATA_ONLY"
  | "TASK_RESULT_SELECTOR_JSONPATH_ONLY"
  | "TASK_RESULT_PATH_JSONPATH_ONLY"
  | "TASK_ARGUMENTS_JSONATA_ONLY"
  | "TASK_OUTPUT_JSONATA_ONLY"
  | "TASK_CATCH_RESULT_PATH_JSONPATH_ONLY"
  | "TASK_CATCH_OUTPUT_JSONATA_ONLY"
  | "PARALLEL_RESULT_SELECTOR_JSONPATH_ONLY"
  | "PARALLEL_RESULT_PATH_JSONPATH_ONLY"
  | "PARALLEL_ARGUMENTS_JSONATA_ONLY"
  | "PARALLEL_OUTPUT_JSONATA_ONLY"
  | "PARALLEL_CATCH_RESULT_PATH_JSONPATH_ONLY"
  | "PARALLEL_CATCH_OUTPUT_JSONATA_ONLY"
  | "MAP_RESULT_SELECTOR_JSONPATH_ONLY"
  | "MAP_RESULT_PATH_JSONPATH_ONLY"
  | "MAP_ITEMS_JSONATA_ONLY"
  | "MAP_ITEMSPATH_JSONPATH_ONLY"
  | "MAP_OUTPUT_JSONATA_ONLY"
  | "MAP_CATCH_RESULT_PATH_JSONPATH_ONLY"
  | "MAP_CATCH_OUTPUT_JSONATA_ONLY";

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

  if (state.kind === "task" || state.kind === "parallel" || state.kind === "map") {
    if (state.next) visitReachable(state.next, machine, seen);
    for (const policy of state.catch ?? []) {
      visitReachable(policy.Next, machine, seen);
    }
    return;
  }

  if (state.kind === "raw") {
    const raw = state.asl as any;
    const type = typeof raw?.Type === "string" ? raw.Type : undefined;

    if (type === "Choice") {
      if (Array.isArray(raw?.Choices)) {
        for (const choice of raw.Choices) {
          if (choice?.Next) visitReachable(String(choice.Next), machine, seen);
        }
      }
      if (raw?.Default) visitReachable(String(raw.Default), machine, seen);
      return;
    }

    if (raw?.Next) visitReachable(String(raw.Next), machine, seen);
    if (Array.isArray(raw?.Catch)) {
      for (const catcher of raw.Catch) {
        if (catcher?.Next) visitReachable(String(catcher.Next), machine, seen);
      }
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

function getDeclaredStateQueryLanguage(node: PassNode | TaskNode | ChoiceNode | ParallelNode | MapNode | RawStateNode): "JSONata" | "JSONPath" | undefined {
  if (node.kind === "raw") {
    if (node.queryLanguage) return node.queryLanguage;
    const raw = node.asl as any;
    return raw?.QueryLanguage === "JSONata" || raw?.QueryLanguage === "JSONPath" ? raw.QueryLanguage : undefined;
  }
  return (node as any).queryLanguage as any;
}

function resolveEffectiveQueryLanguage(
  machineQueryLanguage: "JSONata" | "JSONPath",
  node: PassNode | TaskNode | ChoiceNode | ParallelNode | MapNode | RawStateNode,
  issues: ValidationIssue[],
): "JSONata" | "JSONPath" {
  const declared = getDeclaredStateQueryLanguage(node);

  // AWS restriction: cannot mix JSONPath states inside a JSONata state machine.
  if (machineQueryLanguage === "JSONata" && declared === "JSONPath") {
    issues.push({
      severity: "error",
      code: "STATE_QUERY_LANGUAGE_MIX_NOT_ALLOWED",
      stateName: node.name,
      path: `States.${node.name}.QueryLanguage`,
      message: `State ${node.name} declares QueryLanguage=JSONPath but the state machine QueryLanguage is JSONata. AWS Step Functions does not allow mixing JSONPath states inside a JSONata state machine. Set the top-level QueryLanguage to JSONPath instead, and opt-in states to JSONata one-by-one.`,
    });
  }

  return declared ?? machineQueryLanguage;
}

function validatePassState(
  node: PassNode,
  issues: ValidationIssue[],
  queryLanguage: "JSONata" | "JSONPath",
): void {
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

  if (queryLanguage === "JSONPath" && node.content !== undefined) {
    issues.push({
      severity: "error",
      code: "PASS_CONTENT_JSONATA_ONLY",
      stateName: node.name,
      path: `States.${node.name}.Output`,
      message: `Pass state ${node.name} uses Output/content(), which is JSONata-only. Remove content() or switch QueryLanguage to JSONata.`,
    });
  }
}

function isInteger(value: number): boolean {
  return Number.isInteger(value);
}

function isLikelyJsonPath(value: string): boolean {
  // Acepta las formas más comunes:
  // - "$"
  // - "$.a.b"
  // - "$[0]"
  // - "$['a-b']"
  // - "$[\"a-b\"]"
  return (
    value === "$" ||
    value.startsWith("$.") ||
    value.startsWith("$[")
  );
}

function validateTaskState(
  node: TaskNode,
  issues: ValidationIssue[],
  queryLanguage: "JSONata" | "JSONPath",
): void {
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

  // QueryLanguage field compatibility
  if (queryLanguage === "JSONata") {
    if (node.resultSelector !== undefined) {
      issues.push({
        severity: "error",
        code: "TASK_RESULT_SELECTOR_JSONPATH_ONLY",
        stateName: node.name,
        path: `States.${node.name}.ResultSelector`,
        message: `Task state ${node.name} declares ResultSelector, which is only valid for QueryLanguage=JSONPath. Use Output instead.`,
      });
    }

    if (node.resultPath !== undefined) {
      issues.push({
        severity: "error",
        code: "TASK_RESULT_PATH_JSONPATH_ONLY",
        stateName: node.name,
        path: `States.${node.name}.ResultPath`,
        message: `Task state ${node.name} declares ResultPath, which is only valid for QueryLanguage=JSONPath. Use Output (and optionally Assign) instead.`,
      });
    }

    for (const policy of node.catch ?? []) {
      if (policy.ResultPath !== undefined) {
        issues.push({
          severity: "error",
          code: "TASK_CATCH_RESULT_PATH_JSONPATH_ONLY",
          stateName: node.name,
          path: `States.${node.name}.Catch[*].ResultPath`,
          message: `Task state ${node.name} declares Catch.ResultPath, which is only valid for QueryLanguage=JSONPath. In JSONata, use Catch.Output and/or Catch.Assign with $states.errorOutput.`,
        });
        break;
      }
    }
  } else {
    // JSONPath
    if (node.arguments !== undefined) {
      issues.push({
        severity: "error",
        code: "TASK_ARGUMENTS_JSONATA_ONLY",
        stateName: node.name,
        path: `States.${node.name}.Arguments`,
        message: `Task state ${node.name} declares Arguments, which is only valid for QueryLanguage=JSONata. In JSONPath, use Parameters instead.`,
      });
    }

    if (node.output !== undefined) {
      issues.push({
        severity: "error",
        code: "TASK_OUTPUT_JSONATA_ONLY",
        stateName: node.name,
        path: `States.${node.name}.Output`,
        message: `Task state ${node.name} declares Output, which is only valid for QueryLanguage=JSONata. In JSONPath, use OutputPath instead.`,
      });
    }

    for (const policy of node.catch ?? []) {
      if ((policy as any).Output !== undefined) {
        issues.push({
          severity: "error",
          code: "TASK_CATCH_OUTPUT_JSONATA_ONLY",
          stateName: node.name,
          path: `States.${node.name}.Catch[*].Output`,
          message: `Task state ${node.name} declares Catch.Output, which is only valid for QueryLanguage=JSONata. In JSONPath, use Catch.ResultPath instead.`,
        });
        break;
      }
    }
  }

  // JSONPath ResultPath format validation
  if (
    queryLanguage === "JSONPath"
    && node.resultPath !== undefined
    && (node.resultPath.trim() === "" || !isLikelyJsonPath(node.resultPath))
  ) {
    issues.push({
      severity: "error",
      code: "TASK_INVALID_RESULT_PATH",
      stateName: node.name,
      path: `States.${node.name}.ResultPath`,
      message: `Task state ${node.name} must declare a valid ResultPath like $.result or $.task.output.`,
    });
  }

  if (node.timeoutSeconds !== undefined && (!isInteger(node.timeoutSeconds) || node.timeoutSeconds <= 0)) {
    issues.push({
      severity: "error",
      code: "TASK_INVALID_TIMEOUT_SECONDS",
      stateName: node.name,
      path: `States.${node.name}.TimeoutSeconds`,
      message: `Task state ${node.name} must declare a positive integer TimeoutSeconds value.`,
    });
  }

  if (node.heartbeatSeconds !== undefined && (!isInteger(node.heartbeatSeconds) || node.heartbeatSeconds <= 0)) {
    issues.push({
      severity: "error",
      code: "TASK_INVALID_HEARTBEAT_SECONDS",
      stateName: node.name,
      path: `States.${node.name}.HeartbeatSeconds`,
      message: `Task state ${node.name} must declare a positive integer HeartbeatSeconds value.`,
    });
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
    issues.push({
      severity: "error",
      code: "TASK_HEARTBEAT_EXCEEDS_TIMEOUT",
      stateName: node.name,
      path: `States.${node.name}.HeartbeatSeconds`,
      message: `Task state ${node.name} must declare HeartbeatSeconds smaller than TimeoutSeconds.`,
    });
  }
}

function validateChoiceState(node: ChoiceNode, issues: ValidationIssue[], queryLanguage: "JSONata" | "JSONPath"): void {
  if (node.choices.length === 0) {
    issues.push({ severity: "error", code: "CHOICE_NO_BRANCHES", stateName: node.name, message: `Choice state ${node.name} must declare at least one branch.` });
  }

  if (queryLanguage === "JSONPath") {
    issues.push({
      severity: "error",
      code: "CHOICE_CONDITION_JSONATA_ONLY",
      stateName: node.name,
      path: `States.${node.name}.Choices[*].Condition`,
      message: `Choice state ${node.name} is authored using JSONata conditions (Condition), which requires QueryLanguage=JSONata. For JSONPath choices, use rawState(...) and author Variable/Operators explicitly.`,
    });
  }
}

function validateRawState(node: RawStateNode, issues: ValidationIssue[]): void {
  const raw = node.asl as any;

  const type = typeof raw?.Type === "string" ? raw.Type : undefined;
  if (!type) {
    issues.push({
      severity: "error",
      code: "RAW_MISSING_TYPE",
      stateName: node.name,
      path: `States.${node.name}.Type`,
      message: `Raw state ${node.name} must include a string Type field.`,
    });
    return;
  }

  const hasNext = raw?.Next !== undefined;
  const hasEnd = raw?.End === true;

  if (hasNext && hasEnd) {
    issues.push({
      severity: "error",
      code: "RAW_CONFLICTING_TRANSITION",
      stateName: node.name,
      message: `Raw state ${node.name} cannot declare both Next and End.`,
    });
  }

  const isTerminalType = type === "Succeed" || type === "Fail";
  if (isTerminalType && (hasNext || hasEnd)) {
    issues.push({
      severity: "error",
      code: "RAW_TERMINAL_HAS_TRANSITION",
      stateName: node.name,
      message: `Raw state ${node.name} is a terminal state (Type=${type}) and must not declare Next/End.`,
    });
  }

  if (type === "Choice") {
    if (!Array.isArray(raw?.Choices) || raw.Choices.length === 0) {
      issues.push({
        severity: "error",
        code: "RAW_CHOICE_INVALID",
        stateName: node.name,
        path: `States.${node.name}.Choices`,
        message: `Raw Choice state ${node.name} must declare a non-empty Choices array.`,
      });
    }
    return;
  }

  // Most non-terminal states require either Next or End.
  if (!isTerminalType && !hasNext && !hasEnd) {
    issues.push({
      severity: "error",
      code: "RAW_MISSING_TRANSITION",
      stateName: node.name,
      message: `Raw state ${node.name} must declare either Next or End (or be a terminal Type like Succeed/Fail).`,
    });
  }
}

function materializeBranchMachine(node: ParallelNode, index: number, queryLanguage: "JSONata" | "JSONPath"): NormalizedStateMachine {
  const branch = node.branches[index]!;
  if (branch.states.length === 0) {
    throw new Error(`Parallel branch ${index} is empty.`);
  }

  const states = structuredClone(branch.states) as Array<PassNode | TaskNode | ChoiceNode | RawStateNode>;

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

    if (current.kind === "raw") {
      const raw = current.asl as any;
      const type = typeof raw?.Type === "string" ? raw.Type : undefined;
      const hasExplicit = type === "Succeed" || type === "Fail"
        ? true
        : type === "Choice"
          ? (Boolean(raw?.Default) || (Array.isArray(raw?.Choices) && raw.Choices.length > 0))
          : (raw?.Next !== undefined || raw?.End === true);

      if (!hasExplicit) {
        if (type === "Choice") {
          if (fallbackNext) raw.Default = fallbackNext;
        } else if (type === "Succeed" || type === "Fail") {
          // terminal types cannot be auto-wired
        } else {
          if (fallbackNext) raw.Next = fallbackNext;
          else raw.End = true;
        }
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
    queryLanguage,
    states,
  });
}

function validateParallelBranches(node: ParallelNode, issues: ValidationIssue[], machineQueryLanguage: "JSONata" | "JSONPath"): void {
  node.branches.forEach((branch, index) => {
    if (branch.states.length === 0) {
      issues.push({ severity: "error", code: "PARALLEL_BRANCH_EMPTY", stateName: node.name, path: `States.${node.name}.Branches[${index}]`, message: `Parallel state ${node.name} contains an empty branch at index ${index}.` });
      return;
    }

    try {
      validateStateMachine(materializeBranchMachine(node, index, machineQueryLanguage));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      issues.push({ severity: "error", code: "PARALLEL_BRANCH_INVALID", stateName: node.name, path: `States.${node.name}.Branches[${index}]`, message: `Parallel branch ${index} is invalid: ${message}` });
    }
  });
}

function validateParallelState(
  node: ParallelNode,
  issues: ValidationIssue[],
  stateQueryLanguage: "JSONata" | "JSONPath",
  machineQueryLanguage: "JSONata" | "JSONPath",
): void {
  if (node.branches.length === 0) {
    issues.push({
      severity: "error",
      code: "PARALLEL_NO_BRANCHES",
      stateName: node.name,
      message: `Parallel state ${node.name} must declare at least one branch.`,
    });
  }

  if (node.next && node.end) {
    issues.push({
      severity: "error",
      code: "PARALLEL_CONFLICTING_TRANSITION",
      stateName: node.name,
      message: `Parallel state ${node.name} cannot declare both next and end.`,
    });
  }

  if (!node.next && node.end !== true) {
    issues.push({
      severity: "error",
      code: "PARALLEL_MISSING_TRANSITION",
      stateName: node.name,
      message: `Parallel state ${node.name} must declare either next or end.`,
    });
  }

  // QueryLanguage field compatibility
  if (stateQueryLanguage === "JSONata") {
    if (node.resultSelector !== undefined) {
      issues.push({
        severity: "error",
        code: "PARALLEL_RESULT_SELECTOR_JSONPATH_ONLY",
        stateName: node.name,
        path: `States.${node.name}.ResultSelector`,
        message: `Parallel state ${node.name} declares ResultSelector, which is only valid for QueryLanguage=JSONPath. Use Output instead.`,
      });
    }

    if (node.resultPath !== undefined) {
      issues.push({
        severity: "error",
        code: "PARALLEL_RESULT_PATH_JSONPATH_ONLY",
        stateName: node.name,
        path: `States.${node.name}.ResultPath`,
        message: `Parallel state ${node.name} declares ResultPath, which is only valid for QueryLanguage=JSONPath. Use Output (and optionally Assign) instead.`,
      });
    }

    for (const policy of node.catch ?? []) {
      if (policy.ResultPath !== undefined) {
        issues.push({
          severity: "error",
          code: "PARALLEL_CATCH_RESULT_PATH_JSONPATH_ONLY",
          stateName: node.name,
          path: `States.${node.name}.Catch[*].ResultPath`,
          message: `Parallel state ${node.name} declares Catch.ResultPath, which is only valid for QueryLanguage=JSONPath. In JSONata, use Catch.Output and/or Catch.Assign with $states.errorOutput.`,
        });
        break;
      }
    }
  } else {
    // JSONPath
    if (node.arguments !== undefined) {
      issues.push({
        severity: "error",
        code: "PARALLEL_ARGUMENTS_JSONATA_ONLY",
        stateName: node.name,
        path: `States.${node.name}.Arguments`,
        message: `Parallel state ${node.name} declares Arguments, which is only valid for QueryLanguage=JSONata. In JSONPath, use Parameters instead.`,
      });
    }

    if (node.output !== undefined) {
      issues.push({
        severity: "error",
        code: "PARALLEL_OUTPUT_JSONATA_ONLY",
        stateName: node.name,
        path: `States.${node.name}.Output`,
        message: `Parallel state ${node.name} declares Output, which is only valid for QueryLanguage=JSONata. In JSONPath, use OutputPath instead.`,
      });
    }

    for (const policy of node.catch ?? []) {
      if ((policy as any).Output !== undefined) {
        issues.push({
          severity: "error",
          code: "PARALLEL_CATCH_OUTPUT_JSONATA_ONLY",
          stateName: node.name,
          path: `States.${node.name}.Catch[*].Output`,
          message: `Parallel state ${node.name} declares Catch.Output, which is only valid for QueryLanguage=JSONata. In JSONPath, use Catch.ResultPath instead.`,
        });
        break;
      }
    }
  }

  // JSONPath ResultPath format validation
  if (
    stateQueryLanguage === "JSONPath"
    && node.resultPath !== undefined
    && (node.resultPath.trim() === "" || !isLikelyJsonPath(node.resultPath))
  ) {
    issues.push({
      severity: "error",
      code: "PARALLEL_INVALID_RESULT_PATH",
      stateName: node.name,
      path: `States.${node.name}.ResultPath`,
      message: `Parallel state ${node.name} must declare a valid ResultPath like $.parallel or $.context.parallel.`,
    });
  }

  // Branches inherit the *state machine* query language (not the Parallel state's QueryLanguage).
  validateParallelBranches(node, issues, machineQueryLanguage);
}

function materializeMapProcessorMachine(node: MapNode, queryLanguage: "JSONata" | "JSONPath"): NormalizedStateMachine {
  const processor = node.itemProcessor;
  if (!processor || processor.states.length === 0) {
    throw new Error(`Map itemProcessor is empty.`);
  }

  const states = structuredClone(processor.states) as Array<PassNode | TaskNode | ChoiceNode | RawStateNode>;

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

    if (current.kind === "raw") {
      const raw = current.asl as any;
      const type = typeof raw?.Type === "string" ? raw.Type : undefined;
      const hasExplicit = type === "Succeed" || type === "Fail"
        ? true
        : type === "Choice"
          ? (Boolean(raw?.Default) || (Array.isArray(raw?.Choices) && raw.Choices.length > 0))
          : (raw?.Next !== undefined || raw?.End === true);

      if (!hasExplicit) {
        if (type === "Choice") {
          if (fallbackNext) raw.Default = fallbackNext;
        } else if (type === "Succeed" || type === "Fail") {
          // terminal types cannot be auto-wired
        } else {
          if (fallbackNext) raw.Next = fallbackNext;
          else raw.End = true;
        }
      }
      continue;
    }

    if (current.otherwise === undefined && fallbackNext) {
      current.otherwise = fallbackNext;
    }
  }

  return normalizeStateMachine({
    kind: "stateMachine",
    name: `${node.name}__itemProcessor`,
    queryLanguage,
    states,
  });
}

function validateMapState(
  node: MapNode,
  issues: ValidationIssue[],
  stateQueryLanguage: "JSONata" | "JSONPath",
  machineQueryLanguage: "JSONata" | "JSONPath",
): void {
  // Dataset selection compatibility
  if (node.items !== undefined && node.itemsPath !== undefined) {
    issues.push({
      severity: "error",
      code: "MAP_MISSING_ITEMS",
      stateName: node.name,
      message: `Map state ${node.name} cannot declare both items and itemsPath.`,
    });
  } else if (stateQueryLanguage === "JSONata") {
    if (node.itemsPath !== undefined) {
      issues.push({
        severity: "error",
        code: "MAP_ITEMSPATH_JSONPATH_ONLY",
        stateName: node.name,
        path: `States.${node.name}.ItemsPath`,
        message: `Map state ${node.name} declares ItemsPath, which is only valid for QueryLanguage=JSONPath. Use Items instead.`,
      });
    }

    if (node.items === undefined) {
      issues.push({
        severity: "error",
        code: "MAP_MISSING_ITEMS",
        stateName: node.name,
        message: `Map state ${node.name} must declare items(...) when QueryLanguage=JSONata.`,
      });
    }
  } else {
    // JSONPath
    if (node.items !== undefined) {
      issues.push({
        severity: "error",
        code: "MAP_ITEMS_JSONATA_ONLY",
        stateName: node.name,
        path: `States.${node.name}.Items`,
        message: `Map state ${node.name} declares Items, which is only valid for QueryLanguage=JSONata. Use ItemsPath instead.`,
      });
    }

    if (node.itemsPath === undefined) {
      issues.push({
        severity: "error",
        code: "MAP_MISSING_ITEMS",
        stateName: node.name,
        message: `Map state ${node.name} must declare itemsPath(...) when QueryLanguage=JSONPath.`,
      });
    }
  }

  // Item processor validation
  if (!node.itemProcessor) {
    issues.push({
      severity: "error",
      code: "MAP_MISSING_PROCESSOR",
      stateName: node.name,
      message: `Map state ${node.name} must declare an itemProcessor.`,
    });
  } else if (node.itemProcessor.states.length === 0) {
    issues.push({
      severity: "error",
      code: "MAP_PROCESSOR_EMPTY",
      stateName: node.name,
      path: `States.${node.name}.ItemProcessor`,
      message: `Map state ${node.name} contains an empty itemProcessor.`,
    });
  } else {
    try {
      // ItemProcessor inherits the *state machine* query language (not the Map state's QueryLanguage).
      validateStateMachine(materializeMapProcessorMachine(node, machineQueryLanguage));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      issues.push({
        severity: "error",
        code: "MAP_PROCESSOR_INVALID",
        stateName: node.name,
        path: `States.${node.name}.ItemProcessor`,
        message: `Map itemProcessor is invalid: ${message}`,
      });
    }
  }

  if (node.next && node.end) {
    issues.push({
      severity: "error",
      code: "MAP_CONFLICTING_TRANSITION",
      stateName: node.name,
      message: `Map state ${node.name} cannot declare both next and end.`,
    });
  }

  if (!node.next && node.end !== true) {
    issues.push({
      severity: "error",
      code: "MAP_MISSING_TRANSITION",
      stateName: node.name,
      message: `Map state ${node.name} must declare either next or end.`,
    });
  }

  // QueryLanguage field compatibility
  if (stateQueryLanguage === "JSONata") {
    if (node.resultSelector !== undefined) {
      issues.push({
        severity: "error",
        code: "MAP_RESULT_SELECTOR_JSONPATH_ONLY",
        stateName: node.name,
        path: `States.${node.name}.ResultSelector`,
        message: `Map state ${node.name} declares ResultSelector, which is only valid for QueryLanguage=JSONPath. Use Output instead.`,
      });
    }

    if (node.resultPath !== undefined) {
      issues.push({
        severity: "error",
        code: "MAP_RESULT_PATH_JSONPATH_ONLY",
        stateName: node.name,
        path: `States.${node.name}.ResultPath`,
        message: `Map state ${node.name} declares ResultPath, which is only valid for QueryLanguage=JSONPath. Use Output (and optionally Assign) instead.`,
      });
    }

    for (const policy of node.catch ?? []) {
      if (policy.ResultPath !== undefined) {
        issues.push({
          severity: "error",
          code: "MAP_CATCH_RESULT_PATH_JSONPATH_ONLY",
          stateName: node.name,
          path: `States.${node.name}.Catch[*].ResultPath`,
          message: `Map state ${node.name} declares Catch.ResultPath, which is only valid for QueryLanguage=JSONPath. In JSONata, use Catch.Output and/or Catch.Assign with $states.errorOutput.`,
        });
        break;
      }
    }
  } else {
    // JSONPath
    if (node.output !== undefined) {
      issues.push({
        severity: "error",
        code: "MAP_OUTPUT_JSONATA_ONLY",
        stateName: node.name,
        path: `States.${node.name}.Output`,
        message: `Map state ${node.name} declares Output, which is only valid for QueryLanguage=JSONata. In JSONPath, use OutputPath instead.`,
      });
    }

    for (const policy of node.catch ?? []) {
      if ((policy as any).Output !== undefined) {
        issues.push({
          severity: "error",
          code: "MAP_CATCH_OUTPUT_JSONATA_ONLY",
          stateName: node.name,
          path: `States.${node.name}.Catch[*].Output`,
          message: `Map state ${node.name} declares Catch.Output, which is only valid for QueryLanguage=JSONata. In JSONPath, use Catch.ResultPath instead.`,
        });
        break;
      }
    }
  }

  // JSONPath ResultPath format validation
  if (
    stateQueryLanguage === "JSONPath"
    && node.resultPath !== undefined
    && (node.resultPath.trim() === "" || !isLikelyJsonPath(node.resultPath))
  ) {
    issues.push({
      severity: "error",
      code: "MAP_INVALID_RESULT_PATH",
      stateName: node.name,
      path: `States.${node.name}.ResultPath`,
      message: `Map state ${node.name} must declare a valid ResultPath like $.results or $.context.results.`,
    });
  }

  if (node.maxConcurrency !== undefined && typeof node.maxConcurrency === "number") {
    if (!isInteger(node.maxConcurrency) || node.maxConcurrency < 0) {
      issues.push({
        severity: "error",
        code: "MAP_INVALID_MAX_CONCURRENCY",
        stateName: node.name,
        path: `States.${node.name}.MaxConcurrency`,
        message: `Map state ${node.name} must declare a non-negative integer MaxConcurrency value.`,
      });
    }
  }
}

export function collectValidationIssues(machine: NormalizedStateMachine): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const machineQueryLanguage: "JSONata" | "JSONPath" = machine.queryLanguage ?? "JSONata";

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

    const stateQueryLanguage = resolveEffectiveQueryLanguage(machineQueryLanguage, state as any, issues);

    if (state.kind === "pass") validatePassState(state, issues, stateQueryLanguage);
    else if (state.kind === "task") validateTaskState(state, issues, stateQueryLanguage);
    else if (state.kind === "choice") validateChoiceState(state, issues, stateQueryLanguage);
    else if (state.kind === "parallel") validateParallelState(state, issues, stateQueryLanguage, machineQueryLanguage);
    else if (state.kind === "map") validateMapState(state, issues, stateQueryLanguage, machineQueryLanguage);
    else validateRawState(state, issues);
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
import assert from 'node:assert/strict';

import { choice } from '../dsl/choice';
import { stateMachine, type StateMachineNode, type StepNode } from '../dsl/state-machine';
import { pass } from '../dsl/steps';
import { task } from '../dsl/task';
import type { NormalizedStateMachine } from '../compiler/normalize-state-machine';
import { normalizeStateMachine } from '../compiler/normalize-state-machine';
import {
  StateMachineValidationError,
  type ValidationIssueCode,
  validateStateMachine,
} from '../compiler/validate-state-machine';

function expectValidationError(
  machine: NormalizedStateMachine,
  expectedCodes: ValidationIssueCode[],
  expectedMessageIncludes: string[] = [],
): void {
  let thrown: unknown;

  try {
    validateStateMachine(machine);
  } catch (error: unknown) {
    thrown = error;
  }

  assert.ok(
    thrown instanceof StateMachineValidationError,
    `Expected StateMachineValidationError, received ${thrown instanceof Error ? thrown.name : String(thrown)}`,
  );

  const actualCodes = thrown.issues.map((issue) => issue.code).sort();
  const sortedExpectedCodes = [...expectedCodes].sort();
  assert.deepEqual(actualCodes, sortedExpectedCodes, 'Validation issue codes did not match.');

  for (const fragment of expectedMessageIncludes) {
    assert.match(thrown.message, new RegExp(escapeRegExp(fragment)));
  }
}

function expectValid(machine: NormalizedStateMachine): void {
  assert.doesNotThrow(() => validateStateMachine(machine));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function asNormalized(machine: StateMachineNode): NormalizedStateMachine {
  return normalizeStateMachine(machine);
}

function cloneMachine(machine: NormalizedStateMachine): NormalizedStateMachine {
  return structuredClone(machine);
}

function minimalChoiceState(name: string): StepNode {
  return {
    kind: 'choice',
    name,
    choices: [
      {
        condition: {
          __kind: 'jsonata_slot',
          __slotId: 'tests:choice/alwaysTrue',
        },
        next: 'NextState',
      },
    ],
  };
}

const tests: Array<{ name: string; run: () => void }> = [
  {
    name: 'rejects unknown next targets',
    run: () => {
      const machine = asNormalized(
        stateMachine('UnknownNextTarget')
          .startWith(pass('Start').next('MissingState'))
          .build(),
      );

      expectValidationError(machine, ['UNKNOWN_TRANSITION_TARGET'], [
        'UNKNOWN_TRANSITION_TARGET',
        'Start points to unknown state MissingState',
      ]);
    },
  },
  {
    name: 'rejects unknown catch targets from task states',
    run: () => {
      const machine = asNormalized(
        stateMachine('UnknownCatchTarget')
          .startWith(
            task('Work')
              .resource('arn:aws:states:::lambda:invoke')
              .catchAll('MissingRecovery')
              .end(),
          )
          .build(),
      );

      expectValidationError(machine, ['UNKNOWN_TRANSITION_TARGET'], [
        'UNKNOWN_TRANSITION_TARGET',
        'Work points to unknown state MissingRecovery',
      ]);
    },
  },
  {
    name: 'rejects unknown default targets from choice states',
    run: () => {
      const machine = asNormalized(
        stateMachine('UnknownDefaultTarget')
          .startWith(
            choice('Route')
              .whenTrue(
                { __kind: 'jsonata_slot', __slotId: 'tests:choice/condition' },
                'KnownState',
              )
              .otherwise('MissingFallback'),
          )
          .then(pass('KnownState').end())
          .build(),
      );

      expectValidationError(machine, ['UNKNOWN_TRANSITION_TARGET'], [
        'UNKNOWN_TRANSITION_TARGET',
        'Route points to unknown state MissingFallback',
      ]);
    },
  },
  {
    name: 'rejects duplicate state names',
    run: () => {
      const normalized = asNormalized({
        kind: 'stateMachine',
        name: 'DuplicateStates',
        states: [
          { kind: 'pass', name: 'SameName', next: 'SameName' },
          { kind: 'pass', name: 'SameName', end: true },
        ],
      });

      expectValidationError(normalized, ['DUPLICATE_STATE_NAME'], [
        'Duplicate state name detected: SameName',
      ]);
    },
  },
  {
    name: 'rejects unreachable states',
    run: () => {
      const normalized = asNormalized({
        kind: 'stateMachine',
        name: 'UnreachableState',
        states: [
          { kind: 'pass', name: 'Start', end: true },
          { kind: 'pass', name: 'NeverReached', end: true },
        ],
      });

      expectValidationError(normalized, ['UNREACHABLE_STATE'], [
        'State NeverReached is unreachable from StartAt (Start)',
      ]);
    },
  },
  {
    name: 'rejects invalid StartAt references in normalized machines',
    run: () => {
      const base = asNormalized(
        stateMachine('InvalidStartAt')
          .startWith(pass('Start').end())
          .build(),
      );
      const tampered = cloneMachine(base);
      tampered.startAt = 'MissingStart';

      expectValidationError(tampered, ['INVALID_START_AT', 'UNREACHABLE_STATE'], [
        'StartAt points to unknown state MissingStart',
        'State Start is unreachable from StartAt (MissingStart)',
      ]);
    },
  },
  {
    name: 'rejects task states without resources',
    run: () => {
      const normalized = asNormalized({
        kind: 'stateMachine',
        name: 'TaskMissingResource',
        states: [
          {
            kind: 'task',
            name: 'BrokenTask',
            resource: '' as never,
            end: true,
          },
        ],
      });

      expectValidationError(normalized, ['TASK_MISSING_RESOURCE'], [
        'Task state BrokenTask must declare a resource',
      ]);
    },
  },
  {
    name: 'rejects conflicting task transitions',
    run: () => {
      const normalized = asNormalized({
        kind: 'stateMachine',
        name: 'TaskConflictingTransition',
        states: [
          {
            kind: 'task',
            name: 'BrokenTask',
            resource: 'arn:aws:states:::lambda:invoke',
            next: 'Done',
            end: true,
          },
          { kind: 'pass', name: 'Done', end: true },
        ],
      });

      expectValidationError(normalized, ['TASK_CONFLICTING_TRANSITION'], [
        'Task state BrokenTask cannot declare both next and end',
      ]);
    },
  },
  {
    name: 'rejects task states missing transitions',
    run: () => {
      const normalized = asNormalized({
        kind: 'stateMachine',
        name: 'TaskMissingTransition',
        states: [
          {
            kind: 'task',
            name: 'BrokenTask',
            resource: 'arn:aws:states:::lambda:invoke',
          },
        ],
      });

      expectValidationError(normalized, ['TASK_MISSING_TRANSITION'], [
        'Task state BrokenTask must declare either next or end',
      ]);
    },
  },
  {
    name: 'rejects pass states with conflicting transitions',
    run: () => {
      const normalized = asNormalized({
        kind: 'stateMachine',
        name: 'PassConflictingTransition',
        states: [
          { kind: 'pass', name: 'BrokenPass', next: 'Done', end: true },
          { kind: 'pass', name: 'Done', end: true },
        ],
      });

      expectValidationError(normalized, ['PASS_CONFLICTING_TRANSITION'], [
        'Pass state BrokenPass cannot declare both next and end',
      ]);
    },
  },
  {
    name: 'rejects pass states missing transitions',
    run: () => {
      const normalized = asNormalized({
        kind: 'stateMachine',
        name: 'PassMissingTransition',
        states: [
          { kind: 'pass', name: 'BrokenPass' },
        ],
      });

      expectValidationError(normalized, ['PASS_MISSING_TRANSITION'], [
        'Pass state BrokenPass must declare either next or end',
      ]);
    },
  },
  {
    name: 'rejects choice states without branches',
    run: () => {
      const normalized = asNormalized({
        kind: 'stateMachine',
        name: 'ChoiceWithoutBranches',
        states: [
          {
            kind: 'choice',
            name: 'BrokenChoice',
            choices: [],
            otherwise: 'Done',
          },
          { kind: 'pass', name: 'Done', end: true },
        ],
      });

      expectValidationError(normalized, ['CHOICE_NO_BRANCHES'], [
        'Choice state BrokenChoice must declare at least one branch',
      ]);
    },
  },
  {
    name: 'rejects invalid resultPath on task states',
    run: () => {
      const normalized = asNormalized({
        kind: 'stateMachine',
        name: 'InvalidResultPath',
        queryLanguage: 'JSONPath',
        states: [
          {
            kind: 'task',
            name: 'BrokenTask',
            resource: 'arn:aws:states:::lambda:invoke',
            resultPath: 'query_result',
            end: true,
          },
        ],
      });

      expectValidationError(normalized, ['TASK_INVALID_RESULT_PATH'], [
        'Task state BrokenTask must declare a valid ResultPath',
      ]);
    },
  },
  {
    name: 'rejects non-positive timeoutSeconds on task states',
    run: () => {
      const normalized = asNormalized({
        kind: 'stateMachine',
        name: 'InvalidTimeoutSeconds',
        states: [
          {
            kind: 'task',
            name: 'BrokenTask',
            resource: 'arn:aws:states:::lambda:invoke',
            timeoutSeconds: 0,
            end: true,
          },
        ],
      });

      expectValidationError(normalized, ['TASK_INVALID_TIMEOUT_SECONDS'], [
        'Task state BrokenTask must declare a positive integer TimeoutSeconds value',
      ]);
    },
  },
  {
    name: 'rejects non-positive heartbeatSeconds on task states',
    run: () => {
      const normalized = asNormalized({
        kind: 'stateMachine',
        name: 'InvalidHeartbeatSeconds',
        states: [
          {
            kind: 'task',
            name: 'BrokenTask',
            resource: 'arn:aws:states:::lambda:invoke',
            heartbeatSeconds: 0,
            end: true,
          },
        ],
      });

      expectValidationError(normalized, ['TASK_INVALID_HEARTBEAT_SECONDS'], [
        'Task state BrokenTask must declare a positive integer HeartbeatSeconds value',
      ]);
    },
  },
  {
    name: 'rejects heartbeatSeconds greater than or equal to timeoutSeconds',
    run: () => {
      const normalized = asNormalized({
        kind: 'stateMachine',
        name: 'HeartbeatExceedsTimeout',
        states: [
          {
            kind: 'task',
            name: 'BrokenTask',
            resource: 'arn:aws:states:::lambda:invoke',
            timeoutSeconds: 10,
            heartbeatSeconds: 10,
            end: true,
          },
        ],
      });

      expectValidationError(normalized, ['TASK_HEARTBEAT_EXCEEDS_TIMEOUT'], [
        'Task state BrokenTask must declare HeartbeatSeconds smaller than TimeoutSeconds',
      ]);
    },
  },
  {
    name: 'rejects map states missing items',
    run: () => {
      const machine = asNormalized({
        kind: 'stateMachine',
        name: 'BrokenMapMissingItems',
        states: [
          {
            kind: 'map',
            name: 'Process',
            itemProcessor: {
              kind: 'subflow',
              states: [
                { kind: 'pass', name: 'DoWork', end: true },
              ],
            },
            end: true,
          } as any,
        ],
      });

      expectValidationError(machine, ['MAP_MISSING_ITEMS'], [
        'Map state Process must declare items(',
      ]);
    },
  },
  {
    name: 'rejects map states missing processors',
    run: () => {
      const machine = asNormalized({
        kind: 'stateMachine',
        name: 'BrokenMapMissingProcessor',
        queryLanguage: 'JSONPath',
        states: [
          {
            kind: 'map',
            name: 'Process',
            itemsPath: '$.items',
            end: true,
          } as any,
        ],
      });

      expectValidationError(machine, ['MAP_MISSING_PROCESSOR'], [
        'Map state Process must declare an itemProcessor',
      ]);
    },
  },
  {
    name: 'rejects invalid map item processors',
    run: () => {
      const machine = asNormalized({
        kind: 'stateMachine',
        name: 'BrokenMapProcessorInvalid',
        queryLanguage: 'JSONPath',
        states: [
          {
            kind: 'map',
            name: 'Process',
            itemsPath: '$.items',
            itemProcessor: {
              kind: 'subflow',
              states: [
                { kind: 'task', name: 'BrokenTask', end: true } as any,
              ],
            },
            end: true,
          } as any,
        ],
      });

      expectValidationError(machine, ['MAP_PROCESSOR_INVALID'], [
        'Map itemProcessor is invalid',
      ]);
    },
  },
  {
    name: 'accepts a valid machine as a control case',
    run: () => {
      const machine = asNormalized(
        stateMachine('ValidControlCase')
          .startWith(task('Load').resource('arn:aws:states:::lambda:invoke'))
          .then(pass('Done').end())
          .build(),
      );

      expectValid(machine);
    },
  },
];

function main(): void {
  for (const test of tests) {
    test.run();
    console.log(`✓ ${test.name}`);
  }

  console.log(`Negative validator tests passed (${tests.length} cases).`);
}

main();

# State machine validation

The project now validates state-machine graphs before emitting ASL.

## Pipeline

The build pipeline is now conceptually split into four phases:

1. **builders** — author the flow with `stateMachine(...)`, `task(...)`, `choice(...)`, `pass(...)`, and `subflow(...)`
2. **normalize** — flatten inline subflows, preserve the final graph, and derive transitions
3. **validate** — reject invalid graphs with semantic errors
4. **emit** — generate the final AWS Step Functions definition

`npm run build:machine` performs all four phases.

## Dedicated validation command

Use this when you want to validate graph structure without emitting JSON files:

```bash
npm run validate:machine
```

## Current validation rules

The first validator pass checks the following:

- the machine contains at least one state
- `StartAt` points to a real state
- state names are unique
- `next(...)`, `otherwise(...)`, and `catch(...)` targets exist
- `Pass` states do not declare both `next` and `end`
- `Pass` states declare at least one transition strategy
- `Task` states declare a `resource`
- `Task` states do not declare both `next` and `end`
- `Task` states declare at least one transition strategy
- `Choice` states contain at least one branch
- all states are reachable from `StartAt`

## Error shape

Validation errors are grouped into a single report:

```text
State machine PackageComputationFlow failed validation:
- UNKNOWN_TRANSITION_TARGET [ComputeMany] at States.ComputeMany.Next: State ComputeMany points to unknown state MissingState.
- UNREACHABLE_STATE [FailValidation]: State FailValidation is unreachable from StartAt (GetPackage).
```

This is intentionally designed to feel like a compiler error report instead of a generic stack trace.

## What is not validated yet

This is the first semantic layer. The following are intentionally out of scope for now:

- slot type compatibility
- AWS service-specific shape validation for `Arguments`
- retry policy semantics
- warnings for `Choice` states without `otherwise(...)`
- cycle analysis beyond reachability
- advanced data-flow validation between state outputs and downstream inputs

These can be added later without changing the public DSL.

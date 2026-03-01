import {
  slot,
  exists,
  keys,
  merge,
  lookup,
  count,
  upper,
  reduce,
  $states,
} from "../dsl/jsonata";
import { emitStateMachine } from "../compiler/emit-asl";
import { subflow } from "../dsl/subflow";
import { choice } from "../dsl/choice";
import { stateMachine } from "../dsl/state-machine";
import { pass } from "../dsl/steps";
import type { RetryPolicy } from "../dsl/task";
import { task } from "../dsl/task";
import { lambdaInvoke } from "../dsl/lambda";
import { awsSdkTask } from "../dsl/aws-sdk";

import { bar } from "./lib/udfs";
import foo from "./lib/udfs";
import * as u from "./lib/udfs";

/** ---- Types (authoring-time only) ---- */

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
type JsonObject = { [k: string]: JsonValue };

type SchemaTypeName = "string" | "number" | "boolean" | "object" | "array";
type SchemaDef = { type: SchemaTypeName; required: boolean };
type Schema = Record<string, SchemaDef>;

type StatesParams = {
  path?: JsonObject;
  querystring?: JsonObject;
};

type StatesInput = {
  body?: JsonObject;
  params?: StatesParams;
  validation?: {
    valid?: boolean;
  };
};

export function exampleSlot() {
  return slot("example:Validate/param:validationExpr", () => {
    const EMPTY_OBJ: JsonObject = {};
    const EMPTY_PARAMS: StatesParams = {};

    const states = $states as { input: StatesInput };

    const coalesce = <T>(a: T | undefined, b: T): T => (exists(a) ? a : b);

    const body = coalesce(states.input.body, EMPTY_OBJ);
    const params = coalesce(states.input.params, EMPTY_PARAMS);
    const pathParams = coalesce(params.path, EMPTY_OBJ);
    const qs = coalesce(params.querystring, EMPTY_OBJ);

    const schema: Schema = {
      alias: { type: "string", required: true },
      slug: { type: "string", required: true },
      overrides: { type: "object", required: false },
    };

    const schemaKeys = keys(schema);

    const payload = merge([qs, pathParams, body]);

    const missing = schemaKeys.filter((k) => {
      const def = schema[k];
      const v = lookup(payload, k);
      return def.required === true && !exists(v);
    });

    const clean = reduce(
      schemaKeys,
      (acc: JsonObject, k: string) => {
        const v = lookup(payload, k);
        return exists(v) ? merge([acc, { [k]: v }]) : acc;
      },
      EMPTY_OBJ,
    );

    const noteA = bar();
    const noteB = foo("X");
    const noteC = u.foo_bar();
    const noteD = u.default("Y");

    const numericPlus = 1 + 2;
    const stringyPlus = "A" + "B";

    return {
      valid: count(missing) === 0,
      input: clean,
      errors: { missing },
      notes: { noteA, noteB, noteC, noteD },
      demoKey: `ALIAS#${upper("visa")}`,
      numericPlus,
      stringyPlus,
    };
  });
}

export function isValidationOk() {
  return slot("example:Choice/isValidationOk", () => {
    const states = $states as { input: StatesInput };
    const validation = states.input.validation;
    return exists(validation) && validation.valid === true;
  });
}


export function echoOutput() {
  return slot("example:Echo/output", () => ({
    body: ($states as { input: unknown }).input,
    statusCode: 200,
  }));
}

export const echoFlow = stateMachine("EchoFlow")
  .queryLanguage("JSONata")
  .comment("Echoes the input back")
  .startWith(
    pass("Echo")
      .content(echoOutput())
      .end(),
  );

export const validateInputPass = pass("ValidateInput")
  .assign("validation", exampleSlot())
  .content({
    ok: true,
    from: "ValidateInput",
  })
  .build();

export const persistDataPass = pass("PersistData")
  .content({
    status: "persisted",
  })
  .build();

export const failValidationPass = pass("FailValidation")
  .content({
    ok: false,
    reason: "validation_failed",
  })
  .build();

export const decideValidation = choice("IsValid")
  .whenTrue(isValidationOk(), "PersistData")
  .otherwise("FailValidation")
  .build();

export const exampleFlow = stateMachine("ExampleFlow")
  .queryLanguage("JSONata")
  .comment("Example flow with a linear pass and choice route")
  .startWith(
    pass("ValidateInput")
      .assign("validation", exampleSlot())
      .content({
        ok: true,
        from: "ValidateInput",
      }),
  )
  .then(
    choice("IsValid")
      .whenTrue(
        isValidationOk(),
        pass("PersistData").content({
          status: "persisted",
        }),
      )
      .otherwise(
        pass("FailValidation").content({
          ok: false,
          reason: "validation_failed",
        }),
      ),
  );

export const exampleFlowWithJoin = stateMachine("ExampleFlowWithJoin")
  .queryLanguage("JSONata")
  .comment("Choice inline targets that auto-join into the next state")
  .startWith(
    pass("ValidateInput")
      .assign("validation", exampleSlot())
      .content({
        ok: true,
        from: "ValidateInput",
      }),
  )
  .then(
    choice("RouteValidation")
      .whenTrue(
        isValidationOk(),
        pass("PersistDataInline").content({
          status: "persisted",
        }),
      )
      .otherwise(
        pass("FailValidationInline").content({
          ok: false,
          reason: "validation_failed",
        }),
      ),
  )
  .then(
    pass("AfterDecision").content({
      joined: true,
    }),
  );


export const exampleFlowWithSubflows = stateMachine("ExampleFlowWithSubflows")
  .queryLanguage("JSONata")
  .comment("Choice subflows with nested decisions and an explicit join")
  .startWith(
    pass("ValidateInput")
      .assign("validation", exampleSlot())
      .content({
        ok: true,
        from: "ValidateInput",
      }),
  )
  .then(
    choice("RouteValidationWithSubflows")
      .whenTrue(
        isValidationOk(),
        subflow(
          pass("PersistDataSubflowStart").content({
            status: "persisted",
          }),
        ).then(
          pass("AuditSuccessSubflow").content({
            audit: "success",
          }),
        ),
      )
      .otherwise(
        subflow(
          pass("FailValidationSubflowStart").content({
            ok: false,
            reason: "validation_failed",
          }),
        ).then(
          pass("AuditFailureSubflow").content({
            audit: "failure",
          }),
        ),
      ),
  )
  .then(
    pass("AfterSubflows").content({
      joined: true,
    }),
  );


export function packageKey() {
  return slot("package:task/getPackage/key", () => ($states as { input: { pk_sk: unknown } }).input.pk_sk);
}

export function getPackageOutput() {
  return slot("package:task/getPackage/output", () =>
    merge([
      ($states as { input: Record<string, unknown> }).input,
      { query_result: ($states as { result: unknown }).result },
    ]),
  );
}


export function statesInputSlot() {
  return slot("package:common/statesInput", () => ($states as { input: unknown }).input);
}

export function computeManyOutput() {
  return slot("package:task/computeMany/output", () =>
    ($states as { result: { Payload: unknown } }).result.Payload,
  );
}

export function lambdaServiceRetry(): RetryPolicy {
  return {
    ErrorEquals: [
      "Lambda.ServiceException",
      "Lambda.AWSLambdaException",
      "Lambda.SdkClientException",
      "Lambda.TooManyRequestsException",
    ],
    IntervalSeconds: 1,
    MaxAttempts: 3,
    BackoffRate: 2,
    JitterStrategy: "FULL",
  };
}


export function preparePackageModulesOutput() {
  return slot("package:task/preparePackageModules/output", () => ({
    input: (($states as { result: { Payload: { input: unknown; items_found: unknown; all_modules_valid: unknown } } }).result.Payload as any).input,
    items_found: (($states as { result: { Payload: { input: unknown; items_found: unknown; all_modules_valid: unknown } } }).result.Payload as any).items_found,
    all_modules_valid: (($states as { result: { Payload: { input: unknown; items_found: unknown; all_modules_valid: unknown } } }).result.Payload as any).all_modules_valid,
  }));
}

export function isPreparedModulesValid() {
  return slot("package:choice/isPreparedModulesValid", () =>
    (($states as { input: { all_modules_valid?: boolean } }).input.all_modules_valid === true),
  );
}

export const packageComputationFlow = stateMachine("PackageComputationFlow")
  .queryLanguage("JSONata")
  .comment(
    "Loads a package, prepares and validates its modules, and computes the final result.",
  )
  .startWith(
    awsSdkTask("GetPackage")
      .comment("Loads the package definition from DynamoDB.")
      .service("dynamodb")
      .action("getItem")
      .arguments({
        TableName: "${file(resources/index.json):tables.providers}",
        Key: packageKey(),
      })
      .output(getPackageOutput()),
  )
  .then(
    lambdaInvoke("PreparePackageModules")
      .comment(
        "Resolves, normalizes, and validates the package modules through a domain Lambda.",
      )
      .functionName("${file(resources/index.json):cross_lambdas.load_modules}")
      .payload({
        input: statesInputSlot(),
      })
      .output(preparePackageModulesOutput()),
  )
  .then(
    choice("ArePreparedModulesValid")
      .comment("Routes to the compute step only when the prepared modules are valid.")
      .whenTrue(isPreparedModulesValid(), "ComputeMany")
      .otherwise("FailValidation"),
  )
  .then(
    lambdaInvoke("ComputeMany")
      .comment("Invokes the computation Lambda with the prepared input.")
      .functionName("${file(resources/index.json):cross_lambdas.methods}")
      .payload({
        computeMany: statesInputSlot(),
      })
      .output(computeManyOutput())
      .retry(lambdaServiceRetry())
      .end(),
  )
  .then(
    pass("FailValidation")
      .comment("Terminates the flow when the prepared modules are invalid.")
      .content({
        ok: false,
        reason: "invalid_modules",
      })
      .end(),
  );

export const exampleSlots = exampleSlot()

export const exampleStateMachine = emitStateMachine(exampleFlow.build(), exampleSlots);

export const exampleStateMachineFromBuilder = exampleFlow.toDefinition(exampleSlots);


export const exampleStateMachineWithJoin = emitStateMachine(
  exampleFlowWithJoin.build(),
  exampleSlots,
);

export const exampleFlowWithNestedSubflows = stateMachine("ExampleFlowWithNestedSubflows")
  .startWith(
    pass("ValidateInputNested")
      .assign("validation", exampleSlot())
      .content({
        ok: true,
        from: "ValidateInputNested",
      }),
  )
  .then(
    choice("RouteValidationNested")
      .whenTrue(
        isValidationOk(),
        subflow(
          pass("PersistDataNested").content({
            status: "persisted",
          }),
        ).then(
          choice("ShouldAuditSuccess")
            .whenTrue(
              isValidationOk(),
              subflow(
                pass("AuditSuccessNested").content({
                  audit: "success",
                }),
              ).then(
                pass("PublishSuccessNested").content({
                  publish: "success",
                }),
              ),
            )
            .otherwise(
              pass("SkipSuccessAuditNested").content({
                audit: "skipped",
              }),
            ),
        ),
      )
      .otherwise(
        subflow(
          pass("FailValidationNested").content({
            ok: false,
            reason: "validation_failed",
          }),
        ).then(
          choice("ShouldAuditFailure")
            .whenFalse(
              isValidationOk(),
              subflow(
                pass("AuditFailureNested").content({
                  audit: "failure",
                }),
              ).then(
                pass("PublishFailureNested").content({
                  publish: "failure",
                }),
              ),
            )
            .otherwise(
              pass("SkipFailureAuditNested").content({
                audit: "skipped",
              }),
            ),
        ),
      ),
  )
  .then(
    pass("AfterNestedSubflows").content({
      joined: true,
    }),
  );

export const exampleStateMachineWithSubflows = emitStateMachine(
  exampleFlowWithSubflows.build(),
  exampleSlots,
);

export const exampleStateMachineWithNestedSubflows = emitStateMachine(
  exampleFlowWithNestedSubflows.build(),
  exampleSlots,
);

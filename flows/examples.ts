import { all, any, eq, neq } from "../dsl/jsonata";
import { choice } from "../dsl/choice";
import { stateMachine } from "../dsl/state-machine";
import { subflow } from "../dsl/subflow";
import { pass } from "../dsl/steps";

import { exampleSlot, isValidationOk, validationMode, validationSource } from "../slots/example-validate";

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

export const exampleFlowWithConditionHelpers = stateMachine("ExampleFlowWithConditionHelpers")
  .queryLanguage("JSONata")
  .comment("Composes choice conditions with all(...), any(...), eq(...), and neq(...)")
  .startWith(
    pass("PrepareValidationContext")
      .assign("validation", exampleSlot())
      .content({
        ok: true,
        from: "PrepareValidationContext",
      }),
  )
  .then(
    choice("RouteComposedValidation")
      .comment("Routes only when validation is ok, either strict or manually sourced, and not legacy sourced.")
      .whenTrue(
        all(
          isValidationOk(),
          any(
            eq(validationMode(), "strict"),
            eq(validationSource(), "manual"),
          ),
          neq(validationSource(), "legacy"),
        ),
        "PersistComposedValidation",
      )
      .otherwise("RejectComposedValidation"),
  )
  .then(
    pass("PersistComposedValidation")
      .content({
        status: "persisted",
        strategy: "composed_conditions",
      })
      .end(),
  )
  .then(
    pass("RejectComposedValidation")
      .content({
        ok: false,
        reason: "conditions_not_met",
      })
      .end(),
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


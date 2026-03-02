import { all, any, eq, neq } from "../dsl/jsonata";
import { choice } from "../dsl/choice";
import { lambdaInvoke } from "../dsl/lambda";
import { map } from "../dsl/map";
import { pass } from "../dsl/steps";
import { stateMachine } from "../dsl/state-machine";
import { subflow } from "../dsl/subflow";

import {
modulesValidationMode,
  validateModulesCatchOutput,
  validateModulesOutput,
  validateOneModuleOutput,
modulesValidationSource,
modulesItemsSlot,
modulesMapItemIndexSlot,
modulesMapItemValueSlot,
moduleIterationIndexSlot,
moduleIterationModuleSlot,
moduleIterationModeSlot,
moduleIterationSourceSlot,
validateOneModuleValidSlot,
validateOneModuleErrorsSlot,
moduleIterationValidationOutput,
areAllModulesValid,
invalidModuleValidations,
persistValidatedModulesOutput,
rejectInvalidModulesOutput,
failModuleValidationRuntimeOutput,
} from "../slots/modules-map";

export const validateModulesMapFlow = stateMachine("ValidateModulesMapFlow")
  .queryLanguage("JSONata")
  .comment(
    "Validates each requested module using Map + per-item Lambda validation, then routes the request based on aggregated validity.",
  )
  .startWith(
    map("ValidateModules")
      .comment("Validates each module concurrently and stores the per-item results under $.module_validations.")
      .items(modulesItemsSlot())
      .itemSelector({
        index: modulesMapItemIndexSlot(),
        module: modulesMapItemValueSlot(),
        mode: modulesValidationMode(),
        source: modulesValidationSource(),
      })
      .maxConcurrency(20)
      .itemProcessor(
        subflow(
          lambdaInvoke("ValidateOneModule")
            .comment("Validates one module in the current Map iteration.")
            .functionName("${file(resources/index.json):cross_lambdas.validate_module}")
            .payload({
              index: moduleIterationIndexSlot(),
              module: moduleIterationModuleSlot(),
              mode: moduleIterationModeSlot(),
              source: moduleIterationSourceSlot(),
            })
            .output(validateOneModuleOutput()),
        ).then(
          pass("ReturnModuleValidation")
            .comment("Emits the compact per-module validation object as the iteration output.")
            .content(moduleIterationValidationOutput())
            .end(),
        ),
      )
      .output(validateModulesOutput())
      .catchAll(
        subflow(
          pass("FailModuleValidationRuntime")
            .comment("Handles Map runtime failures with a stable error payload.")
            .content(failModuleValidationRuntimeOutput())
            .end(),
        ),
        { output: validateModulesCatchOutput() },
      ),
  )
  .then(
    choice("AreModulesValid")
      .comment(
        "Accepts only when every module is valid and the request is either strict-mode or manually sourced (and never legacy sourced).",
      )
      .whenTrue(
        all(
          areAllModulesValid(),
          any(
            eq(modulesValidationMode(), "strict"),
            eq(modulesValidationSource(), "manual"),
          ),
          neq(modulesValidationSource(), "legacy"),
        ),
        "PersistValidatedModules",
      )
      .otherwise("RejectInvalidModules"),
  )
  .then(
    pass("PersistValidatedModules")
      .comment("Represents the happy path after all modules validated successfully.")
      .content(persistValidatedModulesOutput())
      .end(),
  )
  .then(
    pass("RejectInvalidModules")
      .comment("Returns the invalid module subset when validation fails.")
      .content(rejectInvalidModulesOutput())
      .end(),
  );


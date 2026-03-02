import { slot, $states, merge, count, exists } from "../dsl/jsonata";
import type { JsonObject, StatesInput } from "./types";

/** ---- Map business example: Validate modules ---- */

export type ModuleDescriptor = {
  alias?: string;
  slug?: string;
  overrides?: JsonObject;
};

export type ModulesValidationInput = StatesInput & {
  modules?: ModuleDescriptor[];
};

export function modulesValidationMode() {
  return slot("modules:common/validationMode", () => {
    const states = $states as { input: ModulesValidationInput };
    return (states.input.validation as any).mode;
  });
}

export function modulesValidationSource() {
  return slot("modules:common/validationSource", () => {
    const states = $states as { input: ModulesValidationInput };
    return (states.input.validation as any).source;
  });
}

export function modulesItemsSlot() {
  return slot("modules:map/items", () => {
    const states = $states as { input: ModulesValidationInput };
    const modules = (states.input as any).modules as unknown;
    return exists(modules) ? (modules as any) : [];
  });
}

export function modulesMapItemIndexSlot() {
  return slot("modules:map/itemIndex", () => {
    const states = $states as any;
    return states.context.Map.Item.Index;
  });
}

export function modulesMapItemValueSlot() {
  return slot("modules:map/itemValue", () => {
    const states = $states as any;
    return states.context.Map.Item.Value;
  });
}

export function moduleIterationIndexSlot() {
  return slot("modules:map/processor/index", () => {
    const states = $states as any;
    return states.input.index;
  });
}

export function moduleIterationModuleSlot() {
  return slot("modules:map/processor/module", () => {
    const states = $states as any;
    return states.input.module;
  });
}

export function moduleIterationModeSlot() {
  return slot("modules:map/processor/mode", () => {
    const states = $states as any;
    return states.input.mode;
  });
}

export function moduleIterationSourceSlot() {
  return slot("modules:map/processor/source", () => {
    const states = $states as any;
    return states.input.source;
  });
}

export function validateOneModuleValidSlot() {
  return slot("modules:task/validateOneModule/valid", () => {
    const states = $states as any;
    return states.result.Payload.valid;
  });
}

export function validateOneModuleErrorsSlot() {
  return slot("modules:task/validateOneModule/errors", () => {
    const states = $states as any;
    return states.result.Payload.errors;
  });
}

export function moduleIterationValidationOutput() {
  return slot("modules:map/processor/returnValidation", () => {
    const states = $states as any;
    return states.input.validation;
  });
}

export function areAllModulesValid() {
  return slot("modules:choice/allValid", () => {
    const states = $states as any;
    const validations = states.input.module_validations;
    const invalid = validations.filter((v: any) => v.valid !== true);
    return count(invalid) === 0;
  });
}

export function invalidModuleValidations() {
  return slot("modules:choice/invalid", () => {
    const states = $states as any;
    const validations = states.input.module_validations;
    return validations.filter((v: any) => v.valid !== true);
  });
}

export function persistValidatedModulesOutput() {
  return slot("modules:pass/persistValidatedModules/output", () => {
    const states = $states as any;
    const validations = states.input.module_validations;
    return {
      ok: true,
      status: "modules_validated",
      total: count(validations),
      validations,
    };
  });
}

export function rejectInvalidModulesOutput() {
  return slot("modules:pass/rejectInvalidModules/output", () => {
    const states = $states as any;
    const validations = states.input.module_validations;
    const invalid = validations.filter((v: any) => v.valid !== true);
    return {
      ok: false,
      reason: "invalid_modules",
      total: count(validations),
      invalid_count: count(invalid),
      invalid,
    };
  });
}

export function failModuleValidationRuntimeOutput() {
  return slot("modules:pass/failModuleValidationRuntime/output", () => {
    const states = $states as any;
    return {
      ok: false,
      reason: "module_validation_failed",
      error: states.input.module_validation_error,
    };
  });
}

export function validateOneModuleOutput() {
  return slot("modules:task/validateOneModule/output", () => ({
    validation: {
      index: ($states as { input: { index: number } }).input.index,
      module: ($states as { input: { module: string } }).input.module,
      valid: ($states as { result: { Payload: { valid: boolean } } }).result.Payload.valid,
      errors: ($states as { result: { Payload: { errors: unknown[] } } }).result.Payload.errors,
    },
  }));
}

export function validateModulesOutput() {
  return slot("modules:map/validateModules/output", () =>
    merge([
      ($states as { input: Record<string, unknown> }).input,
      {
        module_validations: ($states as { result: unknown }).result,
      },
    ]),
  );
}

export function validateModulesCatchOutput() {
  return slot("modules:map/validateModules/catchOutput", () =>
    merge([
      ($states as { input: Record<string, unknown> }).input,
      {
        module_validation_error: ($states as { errorOutput: unknown }).errorOutput,
      },
    ]),
  );
}

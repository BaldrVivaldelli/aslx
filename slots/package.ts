import { slot, merge, $states } from "../dsl/jsonata";
import type { RetryPolicy } from "../dsl/task";

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

export function computeManyOutput() {
  return slot("package:task/computeMany/output", () =>
    ($states as { result: { Payload: unknown } }).result.Payload,
  );
}

export function lambdaPayloadSlot() {
  return slot("package:task/computeMany/resultSelectorPayload", () =>
    ($states as { result: { Payload: unknown } }).result.Payload,
  );
}

export function lambdaExecutedSource() {
  return slot("package:task/computeMany/resultSelectorSource", () => "lambda_invoke");
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

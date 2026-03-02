import { slot, $states } from "../dsl/jsonata";

export function merchantLookupKey() {
  return slot("merchant:task/getMerchantProfile/key", () => ({
    PK: "MERCHANT#" + (($states as { input: { merchant_id: string } }).input.merchant_id),
    SK: "PROFILE",
  }));
}

export function merchantProfileSlot() {
  return slot("merchant:task/getMerchantProfile/profile", () =>
    ($states as { input: { merchant_profile: unknown } }).input.merchant_profile,
  );
}

export function merchantDecisionApproved() {
  return slot("merchant:task/scoreMerchantOnboarding/approved", () =>
    ($states as { result: { Payload: { approved: boolean } } }).result.Payload.approved,
  );
}

export function merchantDecisionBand() {
  return slot("merchant:task/scoreMerchantOnboarding/band", () =>
    ($states as { result: { Payload: { band: string } } }).result.Payload.band,
  );
}

export function merchantDecisionReasons() {
  return slot("merchant:task/scoreMerchantOnboarding/reasons", () =>
    ($states as { result: { Payload: { reasons: unknown[] } } }).result.Payload.reasons,
  );
}

export function merchantDecisionSource() {
  return slot("merchant:task/scoreMerchantOnboarding/source", () => "risk_engine");
}

export function isMerchantAutoApproved() {
  return slot("merchant:choice/isMerchantAutoApproved", () =>
    (($states as { input: { decision: { approved?: boolean } } }).input.decision.approved === true),
  );
}

export function mergeMerchantContextOutput() {
  return slot("merchant:parallel/mergeContextOutput", () => ({
    merchant_context: ($states as any).input.parallel_results,
    merged: true,
  }));
}

export function isMerchantEligible() {
  return slot("merchant:parallel/isEligible", () => true);
}

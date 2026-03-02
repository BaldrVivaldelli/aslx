import { choice } from "../dsl/choice";
import { awsSdkTask } from "../dsl/aws-sdk";
import { lambdaInvoke } from "../dsl/lambda";
import { pass } from "../dsl/steps";
import { stateMachine } from "../dsl/state-machine";
import { parallel } from "../dsl/parallel";
import { subflow } from "../dsl/subflow";

import { statesInputSlot } from "../slots/common";
import { lambdaServiceRetry } from "../slots/package";
import {
merchantLookupKey,
  merchantParallelErrorOutput,
  merchantParallelResultsOutput,
  merchantDecisionOutput,
  merchantProfileOutput,
merchantProfileSlot,
merchantDecisionApproved,
merchantDecisionBand,
merchantDecisionReasons,
merchantDecisionSource,
isMerchantAutoApproved,
mergeMerchantContextOutput,
isMerchantEligible,
} from "../slots/merchant";

export const merchantOnboardingDecisionFlow = stateMachine("MerchantOnboardingDecisionFlow")
  .queryLanguage("JSONata")
  .comment("Fetches a merchant profile, scores onboarding risk, and routes the request using compact business result fields.")
  .startWith(
    awsSdkTask("GetMerchantProfile")
      .comment("Fetches the merchant profile and attaches the raw infrastructure result under $.merchant_profile.")
      .service("dynamodb")
      .action("getItem")
      .arguments({
        TableName: "${file(resources/index.json):tables.merchants}",
        Key: merchantLookupKey(),
      })
      .output(merchantProfileOutput()),
  )
  .then(
    lambdaInvoke("ScoreMerchantOnboarding")
      .comment("Scores onboarding risk and stores only the business decision fields under $.decision.")
      .functionName("${file(resources/index.json):cross_lambdas.score_merchant}")
      .payload({
        request: statesInputSlot(),
        merchantProfile: merchantProfileSlot(),
      })
      .output(merchantDecisionOutput())
      .timeoutSeconds(20)
      .retry(lambdaServiceRetry()),
  )
  .then(
    choice("IsMerchantAutoApproved")
      .comment("Routes auto-approved merchants directly to persistence and sends everything else to manual review.")
      .whenTrue(isMerchantAutoApproved(), "PersistAutoApproval")
      .otherwise("SendToManualReview"),
  )
  .then(
    pass("PersistAutoApproval")
      .comment("Represents the happy path for automatically approved merchants.")
      .content({
        ok: true,
        status: "auto_approved",
      })
      .end(),
  )
  .then(
    pass("SendToManualReview")
      .comment("Represents the fallback path when the decision is not an automatic approval.")
      .content({
        ok: true,
        status: "manual_review",
      })
      .end(),
  );

export const merchantOnboardingParallelFlow = stateMachine("MerchantOnboardingParallelFlow")
  .queryLanguage("JSONata")
  .comment("Loads merchant onboarding context concurrently before making an eligibility decision.")
  .startWith(
    parallel("PrepareMerchantContext")
      .comment("Loads merchant-related context concurrently.")
      .branch(
        subflow(
          lambdaInvoke("LoadMerchantProfile")
            .functionName("${file(resources/index.json):cross_lambdas.load_merchant_profile}")
            .payload({ input: statesInputSlot() }),
        ),
      )
      .branch(
        subflow(
          lambdaInvoke("LoadRiskProfile")
            .functionName("${file(resources/index.json):cross_lambdas.load_risk_profile}")
            .payload({ input: statesInputSlot() }),
        ),
      )
      .branch(
        subflow(
          lambdaInvoke("LoadOnboardingFlags")
            .functionName("${file(resources/index.json):cross_lambdas.load_onboarding_flags}")
            .payload({ input: statesInputSlot() }),
        ),
      )
      .output(merchantParallelResultsOutput()),
  )
  .then(
    pass("MergeMerchantContext")
      .content(mergeMerchantContextOutput()),
  )
  .then(
    choice("IsMerchantEligible")
      .whenTrue(isMerchantEligible(), "ApproveMerchant")
      .otherwise("RejectMerchant"),
  )
  .then(
    pass("ApproveMerchant")
      .content({ ok: true }),
  )
  .then(
    pass("RejectMerchant")
      .content({ ok: false })
      .end(),
  );


import { EXAMPLE_CONSENT_POLICY_VERSION } from "../../config/consent";
import {
  consentReceiptFrom,
  type ConsentReceipt,
} from "../../services/piiRedactor";

// ADR-0007 — the single place test fixtures obtain a `ConsentReceipt`.
//
// Before the consent flow existed these suites forged the brand with
// `{} as ConsentReceipt`. That is no longer necessary and no longer
// desirable: minting through the real `consentReceiptFrom` means a
// regression in the minter breaks every example-storage suite instead of
// being masked by a cast. The §5.2 "unique minter" invariant is guarded at
// source level in `piiRedactor.test.ts`.
export function mintTestReceipt(): ConsentReceipt {
  const receipt = consentReceiptFrom(
    {
      consentedAt: new Date(),
      revokedAt: null,
      policyVersion: EXAMPLE_CONSENT_POLICY_VERSION,
    },
    EXAMPLE_CONSENT_POLICY_VERSION,
  );
  if (!receipt) throw new Error("fixture consent must mint");
  return receipt;
}

import type { GeneratedSupportingDocument } from "./contracts.js";

const lifecycleClaims = [
  {
    id: "created",
    pattern:
      /\b(?:task|referral|message|handoff|request)\s+(?:(?:has|have)\s+been\s+|was\s+)?created\b/i,
  },
  {
    id: "sent",
    pattern:
      /\b(?:task|referral|message|handoff|request)\s+(?:(?:has|have)\s+been\s+|was\s+)?sent\b/i,
  },
  {
    id: "routed",
    pattern:
      /\b(?:task|referral|message|handoff|request)\s+(?:(?:has|have)\s+been\s+|was\s+)?routed\b/i,
  },
  {
    id: "assigned",
    pattern: /\b(?:task|action|follow-up)\s+(?:is\s+|was\s+|has been\s+)?assigned\b/i,
  },
  {
    id: "accepted",
    pattern: /\b(?:task|action|follow-up)\s+(?:is\s+|was\s+|has been\s+)?accepted\b/i,
  },
  {
    id: "completed",
    pattern: /\b(?:task|action|follow-up|check)\s+(?:is\s+|was\s+|has been\s+)?completed\b/i,
  },
  {
    id: "verified",
    pattern: /\b(?:task|action|follow-up|check|status)\s+(?:is\s+|was\s+|has been\s+)?verified\b/i,
  },
] as const;

export interface UnsupportedLifecycleClaim {
  id: (typeof lifecycleClaims)[number]["id"];
  text: string;
}

/**
 * Generated wording may repeat lifecycle claims only when the clinician-
 * approved source explicitly contains the same class of claim. This prevents a
 * draft handoff from turning an approved proposal into a fictional commit.
 */
export function findUnsupportedLifecycleClaims(
  approvedClinicalText: string,
  generatedText: string,
): UnsupportedLifecycleClaim[] {
  const unsupported: UnsupportedLifecycleClaim[] = [];
  for (const claim of lifecycleClaims) {
    const generatedMatch = generatedText.match(claim.pattern);
    if (
      generatedMatch?.[0] !== undefined &&
      !claim.pattern.test(approvedClinicalText)
    ) {
      unsupported.push({ id: claim.id, text: generatedMatch[0] });
    }
  }
  return unsupported;
}

export function evaluateSupportingDocumentSafety(
  document: GeneratedSupportingDocument,
  approvedClinicalText: string,
): {
  safe: boolean;
  unsupportedClaims: UnsupportedLifecycleClaim[];
} {
  const unsupportedClaims = document.sections.flatMap((section) =>
    findUnsupportedLifecycleClaims(approvedClinicalText, section.text),
  );
  return { safe: unsupportedClaims.length === 0, unsupportedClaims };
}

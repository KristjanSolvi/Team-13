import type { Corti } from "@corti/sdk";

import {
  codingSystems,
  type CodingResult,
  type CodingSystem,
  type NormalizedCodeSuggestion,
} from "./contracts.js";
import { validateCodingEvidence } from "./evidence.js";

function isCodingSystem(value: string): value is CodingSystem {
  return codingSystems.some((system) => system === value);
}

function normalizeCodeSuggestion(
  item: Corti.CodesGeneralReadResponse,
  contexts: readonly string[],
): NormalizedCodeSuggestion | null {
  if (!isCodingSystem(item.system)) {
    return null;
  }

  const evidences = (item.evidences ?? [])
    .map((evidence) =>
      validateCodingEvidence(contexts, {
        contextIndex: evidence.contextIndex,
        text: evidence.text,
        start: evidence.start,
        end: evidence.end,
      }),
    )
    .filter((evidence) => evidence !== null);

  return {
    system: item.system,
    code: item.code,
    display: item.display,
    evidences,
    alternatives: (item.alternatives ?? []).map((alternative) => ({
      code: alternative.code,
      display: alternative.display,
    })),
    evidenceStatus: evidences.length > 0 ? "validated" : "unavailable",
  };
}

export function normalizeCodingResult(input: {
  system: CodingSystem;
  approvedClinicalText: string;
  response: Corti.CodesGeneralResponse;
}): CodingResult {
  const contexts = [input.approvedClinicalText];
  return {
    system: input.system,
    codes: input.response.codes
      .map((item) => normalizeCodeSuggestion(item, contexts))
      .filter((item) => item !== null),
    candidates: input.response.candidates
      .map((item) => normalizeCodeSuggestion(item, contexts))
      .filter((item) => item !== null),
    creditsConsumed: input.response.usageInfo.creditsConsumed,
  };
}

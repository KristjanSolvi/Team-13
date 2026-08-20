import { randomUUID } from "node:crypto";

import { CortiAuth, CortiClient, type Corti } from "@corti/sdk";
import { normalizeGeneratedCandidates } from "./candidates.js";
import { normalizeCodingResult } from "./coding.js";
import { evaluateSupportingDocumentSafety } from "./document-safety.js";
import type { CortiCredentials } from "./config.js";
import {
  candidateCategories,
  type CodingResult,
  type GeneratedSupportingDocument,
  type SupportingDocumentType,
} from "./contracts.js";
import { PipelineError, upstreamPipelineError } from "./errors.js";
import type {
  CortiGateway,
  GenerateCandidatesInput,
  GenerateCandidatesResult,
  GenerateSupportingDocumentInput,
  PredictCodesInput,
} from "./gateway.js";
import { canonicalTranscriptText } from "./transcript.js";

const CORTI_TIMEOUT_MS = 180_000;

const documentProfiles: Record<
  SupportingDocumentType,
  { name: string; heading: string; contentPrompt: string; writingStylePrompt: string }
> = {
  "clinical-note": {
    name: "Follow-Through Clinical Note",
    heading: "Approved follow-through note",
    contentPrompt:
      "Summarize only the approved clinical context and follow-through action. Include the action, accountable owner or receiving team, and deadline only when explicitly present. Do not add diagnoses, recommendations, or facts.",
    writingStylePrompt: "Concise clinical prose. Mark uncertainty explicitly.",
  },
  "receiving-team-handoff": {
    name: "Follow-Through Receiving-Team Handoff",
    heading: "Receiving-team handoff",
    contentPrompt:
      "Create a brief handoff using only the approved context. State why follow-through is requested, the requested action, the receiving team, the deadline, and the source evidence only when present. Use request language. Do not say a task, referral, message, or handoff was created, sent, routed, assigned, accepted, completed, or verified unless that exact lifecycle status is explicitly present in the approved input.",
    writingStylePrompt: "Direct operational handoff language with short sentences.",
  },
  "patient-receipt": {
    name: "Follow-Through Patient Receipt",
    heading: "What happens next",
    contentPrompt:
      "Explain only the clinician-approved next step in plain language: what will happen, who is expected to do it, and by when when those details are present. Do not add clinical advice or reassurance.",
    writingStylePrompt: "Plain language, calm tone, short sentences.",
  },
};

async function withAbortTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CORTI_TIMEOUT_MS);
  try {
    return await operation(controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}

function firstStructuredSection(
  response: Corti.GuidedDocumentsCreateEphemeralResponse,
): unknown {
  const sectionId = response.document.sections?.[0]?.sectionId;
  if (sectionId === undefined) {
    return undefined;
  }
  return response.document.structuredDocument?.[sectionId];
}

export class CortiSdkGateway implements CortiGateway {
  readonly #config: CortiCredentials;
  readonly #client: CortiClient;
  readonly #auth: CortiAuth;

  constructor(config: CortiCredentials) {
    this.#config = config;
    this.#client = new CortiClient({
      environment: config.environment,
      tenantName: config.tenantName,
      auth: {
        clientId: config.clientId,
        clientSecret: config.clientSecret,
      },
      timeoutInSeconds: CORTI_TIMEOUT_MS / 1000,
      maxRetries: 1,
    });
    this.#auth = new CortiAuth({
      environment: config.environment,
      tenantName: config.tenantName,
    });
  }

  async #mintToken(scope: "streams" | "transcribe") {
    try {
      const token = await this.#auth.getToken({
        clientId: this.#config.clientId,
        clientSecret: this.#config.clientSecret,
        scopes: [scope],
      });
      return { accessToken: token.accessToken, expiresIn: token.expiresIn };
    } catch (error) {
      throw upstreamPipelineError(`${scope} token request`, error);
    }
  }

  async createAmbientSession(encounterIdentifier?: string) {
    try {
      const interaction = await this.#client.interactions.create({
        encounter: {
          identifier: encounterIdentifier ?? randomUUID(),
          status: "planned",
          type: "first_consultation",
        },
      });
      const token = await this.#mintToken("streams");
      return {
        interactionId: interaction.interactionId,
        ...token,
        tenantName: this.#config.tenantName,
        environment: this.#config.environment,
        primaryLanguage: this.#config.primaryLanguage,
        outputLanguage: this.#config.outputLanguage,
      };
    } catch (error) {
      if (error instanceof PipelineError) {
        throw error;
      }
      throw upstreamPipelineError("interaction creation", error);
    }
  }

  async mintAmbientToken() {
    return this.#mintToken("streams");
  }

  async mintDictationToken() {
    return this.#mintToken("transcribe");
  }

  async generateCandidates(
    input: GenerateCandidatesInput,
  ): Promise<GenerateCandidatesResult> {
    if (
      input.segments.some(
        (segment) => segment.interactionId !== input.interactionId,
      )
    ) {
      throw new PipelineError(
        "INTERACTION_EVIDENCE_MISMATCH",
        "Every transcript segment must belong to the requested interaction.",
        { status: 400, retryable: false },
      );
    }
    const transcript = canonicalTranscriptText(input.segments);
    if (transcript.length === 0) {
      throw new PipelineError(
        "FINAL_TRANSCRIPT_REQUIRED",
        "At least one final transcript segment is required.",
        { status: 422, retryable: false },
      );
    }
    try {
      const response = await withAbortTimeout((abortSignal) =>
        this.#client.documents.generate(
          {
            outputLanguage: this.#config.outputLanguage,
            context: [{ type: "text", text: transcript }],
            dynamicTemplate: {
              name: "Follow-Through Candidate Extraction",
              generation: {
                instructions: {
                  prompt:
                    "Select at most one explicit, high-value unresolved concern that may be lost without follow-through. Prefer a new symptom linked by the speaker to a medication change, an investigation or referral that lacks follow-up, or a practical barrier tied to a specific care step. Combine related clauses from the same concern into one item. Ignore generic discharge logistics, conversational framing, acknowledgements, and standalone uncertainty that does not change a care step. Do not diagnose, recommend care, select an action or owner, or invent a deadline. Return no item when no sufficiently specific candidate exists.",
                },
                sections: [
                  {
                    heading: "Candidate follow-through items",
                    instructions: {
                      contentPrompt:
                        "Return at most one conservative item. Copy sourceQuote exactly and contiguously from one transcript segment, including the related symptom and follow-up uncertainty when they occur together. Keep summary factual and close to the speaker's words.",
                      writingStylePrompt: "Short factual phrases without speculation.",
                    },
                    outputSchema: {
                      type: "array",
                      maxItems: 1,
                      items: {
                        type: "object",
                        fields: [
                          {
                            key: "category",
                            description: "The explicit follow-through category.",
                            value: {
                              type: "string",
                              enum: [...candidateCategories],
                            },
                          },
                          {
                            key: "summary",
                            description: "A short factual summary without a diagnosis.",
                            value: { type: "string" },
                          },
                          {
                            key: "sourceQuote",
                            description:
                              "An exact contiguous quote copied from one transcript segment.",
                            value: { type: "string" },
                          },
                        ],
                      },
                    },
                  },
                ],
              },
            },
          },
          { abortSignal, timeoutInSeconds: CORTI_TIMEOUT_MS / 1000 },
        ),
      );

      const {
        candidates,
        rejectedEvidenceCount,
        rejectedAudioQualityCount,
      } = normalizeGeneratedCandidates({
        generatedValue: firstStructuredSection(response),
        patientId: input.patientId,
        interactionId: input.interactionId,
        correlationId: input.correlationId,
        segments: input.segments,
      });

      return {
        candidates,
        rejectedEvidenceCount,
        rejectedAudioQualityCount,
        creditsConsumed: response.usageInfo.creditsConsumed,
      };
    } catch (error) {
      if (error instanceof PipelineError) {
        throw error;
      }
      throw upstreamPipelineError("candidate generation", error);
    }
  }

  async generateSupportingDocument(
    input: GenerateSupportingDocumentInput,
  ): Promise<GeneratedSupportingDocument> {
    const profile = documentProfiles[input.documentType];
    try {
      const response = await withAbortTimeout((abortSignal) =>
        this.#client.documents.generate(
          {
            outputLanguage: this.#config.outputLanguage,
            labels: [{ key: "approval-id", value: input.approvalId }],
            context: [{ type: "text", text: input.approvedClinicalText }],
            dynamicTemplate: {
              name: profile.name,
              generation: {
                instructions: {
                  prompt:
                    "Use only the supplied clinician-approved content. Omit missing information. Never add a diagnosis, treatment instruction, owner, deadline, assurance, or lifecycle status. An approved proposal is not a created, sent, routed, assigned, accepted, completed, or verified task.",
                },
                sections: [
                  {
                    heading: profile.heading,
                    instructions: {
                      contentPrompt: profile.contentPrompt,
                      writingStylePrompt: profile.writingStylePrompt,
                    },
                    outputSchema: {
                      type: "string",
                      description: "A draft based only on approved input.",
                    },
                  },
                ],
              },
            },
          },
          { abortSignal, timeoutInSeconds: CORTI_TIMEOUT_MS / 1000 },
        ),
      );

      const sections = (response.document.sections ?? []).map((section) => ({
        sectionId: section.sectionId,
        heading: section.heading,
        text: response.document.stringDocument[section.sectionId] ?? "",
      }));

      const document: GeneratedSupportingDocument = {
        documentType: input.documentType,
        name: response.document.name,
        sections,
        creditsConsumed: response.usageInfo.creditsConsumed,
        status: "draft",
      };
      const safety = evaluateSupportingDocumentSafety(
        document,
        input.approvedClinicalText,
      );
      if (!safety.safe) {
        throw new PipelineError(
          "UNSUPPORTED_LIFECYCLE_CLAIM",
          "The generated draft implied a workflow status that was not present in the approved input.",
          { status: 422, retryable: false },
        );
      }
      return document;
    } catch (error) {
      if (error instanceof PipelineError) {
        throw error;
      }
      throw upstreamPipelineError("document generation", error);
    }
  }

  async predictCodes(input: PredictCodesInput): Promise<CodingResult> {
    const system = input.system ?? this.#config.codingSystem;
    try {
      const response = await withAbortTimeout((abortSignal) =>
        this.#client.codes.predict(
          {
            system: [system],
            context: [{ type: "text", text: input.approvedClinicalText }],
          },
          { abortSignal, timeoutInSeconds: CORTI_TIMEOUT_MS / 1000 },
        ),
      );

      return normalizeCodingResult({
        system,
        approvedClinicalText: input.approvedClinicalText,
        response,
      });
    } catch (error) {
      throw upstreamPipelineError("medical coding", error);
    }
  }
}

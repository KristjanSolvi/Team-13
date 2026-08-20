import { z } from "zod";

import type {
  HandoverGroundedStatement,
  HandoverPacket,
  HandoverTaskItem,
  RenderedHandover,
  RenderHandoverInput,
} from "./contracts.js";
import { findUnsupportedLifecycleClaims } from "./document-safety.js";
import { PipelineError } from "./errors.js";

const narrativeSectionNames = [
  "situation",
  "background",
  "currentConcerns",
] as const;

type NarrativeSectionName = (typeof narrativeSectionNames)[number];

const generatedNarrativeItemSchema = z.strictObject({
  section: z.enum(narrativeSectionNames),
  text: z.string().trim().min(1).max(1_000),
  sourceRefs: z.array(z.string().min(1).max(240)).min(1).max(20),
});

const generatedNarrativeSchema = z
  .array(generatedNarrativeItemSchema)
  .min(1)
  .max(60);

const creditsConsumedSchema = z.number().finite().nonnegative();

const forbiddenClinicalClaims = [
  /\bdiagnos(?:is|ed)\b/i,
  /\brecommend(?:ed|ation)?\b/i,
  /\b(?:fit|ready|clear) for discharge\b/i,
] as const;

const operationalReference = /^(?:task|thread):/i;
const additionalLifecycleClaim =
  /\b(?:task|action|follow-up|check|referral|message|handoff|request)\s+(?:(?:has|have)\s+been\s+|(?:is|was)\s+)?(?:offered|escalated|drafted|in draft)\b/i;

const narrativeSections: ReadonlyArray<{
  input: NarrativeSectionName;
  sectionId: string;
  heading: string;
}> = [
  { input: "situation", sectionId: "situation", heading: "Situation" },
  { input: "background", sectionId: "background", heading: "Background" },
  {
    input: "currentConcerns",
    sectionId: "current-concerns",
    heading: "Current concerns",
  },
];

const taskSections: ReadonlyArray<{
  input: "outstandingTasks" | "awaitingVerification" | "escalations";
  sectionId: string;
  heading: string;
}> = [
  {
    input: "outstandingTasks",
    sectionId: "outstanding-tasks",
    heading: "Outstanding tasks",
  },
  {
    input: "awaitingVerification",
    sectionId: "awaiting-verification",
    heading: "Awaiting verification",
  },
  { input: "escalations", sectionId: "escalations", heading: "Escalations" },
];

export interface HandoverNarrativeContext {
  situation: HandoverGroundedStatement[];
  background: HandoverGroundedStatement[];
  currentConcerns: HandoverGroundedStatement[];
}

export interface GeneratedHandoverNarrative {
  generatedValue: unknown;
  creditsConsumed: number;
}

export type GenerateHandoverNarrative = (
  context: HandoverNarrativeContext,
) => Promise<GeneratedHandoverNarrative>;

export interface NormalizeGeneratedHandoverInput {
  input: RenderHandoverInput;
  generatedValue: unknown;
  creditsConsumed: number;
}

function invalidGeneratedOutput(): PipelineError {
  return new PipelineError(
    "INVALID_HANDOVER_RENDER",
    "Corti returned an invalid grounded handover narrative.",
    { status: 422, retryable: false },
  );
}

function unsupportedReference(sourceRef: string): PipelineError {
  return new PipelineError(
    "HANDOVER_UNSUPPORTED_REFERENCE",
    `The generated handover used a source reference outside its narrative section: ${sourceRef}`,
    { status: 422, retryable: false },
  );
}

function exactTaskStatement(task: HandoverTaskItem): string {
  return `${task.summary} — state: ${task.state}; team: ${task.targetTeamId}; owner: ${task.assignedMemberId ?? "unassigned"}; urgency: ${task.clinicalUrgency}; accept by: ${task.acceptBy}; due by: ${task.dueBy}.`;
}

function deterministicSections(packet: HandoverPacket): RenderedHandover["sections"] {
  const sections: RenderedHandover["sections"] = [];
  for (const definition of taskSections) {
    const tasks = packet[definition.input];
    if (tasks.length === 0) continue;
    sections.push({
      sectionId: definition.sectionId,
      heading: definition.heading,
      statements: tasks.map((task) => ({
        statement: exactTaskStatement(task),
        sourceRefs: [...task.sourceRefs],
      })),
    });
  }
  if (packet.unknowns.length > 0) {
    sections.push({
      sectionId: "unknowns",
      heading: "Unknowns",
      statements: packet.unknowns.map((statement) => ({
        statement,
        sourceRefs: [],
      })),
    });
  }
  return sections;
}

function narrativeContext(packet: HandoverPacket): HandoverNarrativeContext {
  return {
    situation: packet.situation,
    background: packet.background,
    currentConcerns: packet.currentConcerns,
  };
}

function hasNarrative(context: HandoverNarrativeContext): boolean {
  return (
    context.situation.length > 0 ||
    context.background.length > 0 ||
    context.currentConcerns.length > 0
  );
}

function validateNarrativeItem(
  item: z.infer<typeof generatedNarrativeItemSchema>,
  packet: HandoverPacket,
): HandoverGroundedStatement {
  const sourceStatements = packet[item.section].filter((statement) =>
    item.sourceRefs.some((sourceRef) => statement.sourceRefs.includes(sourceRef)),
  );
  const allowedRefs = new Set(
    packet[item.section].flatMap((statement) => statement.sourceRefs),
  );
  for (const sourceRef of item.sourceRefs) {
    if (operationalReference.test(sourceRef) || !allowedRefs.has(sourceRef)) {
      throw unsupportedReference(sourceRef);
    }
  }

  const sourceBasis = sourceStatements
    .map((statement) => statement.statement)
    .join("\n");
  for (const pattern of forbiddenClinicalClaims) {
    if (pattern.test(item.text) && !pattern.test(sourceBasis)) {
      throw new PipelineError(
        "HANDOVER_UNSUPPORTED_CLAIM",
        "The generated handover added a clinical or discharge claim that was absent from its cited source.",
        { status: 422, retryable: false },
      );
    }
  }
  if (
    findUnsupportedLifecycleClaims(sourceBasis, item.text).length > 0 ||
    (additionalLifecycleClaim.test(item.text) &&
      !additionalLifecycleClaim.test(sourceBasis))
  ) {
    throw new PipelineError(
      "HANDOVER_UNSUPPORTED_LIFECYCLE_CLAIM",
      "The generated handover added a lifecycle claim that was absent from its cited source.",
      { status: 422, retryable: false },
    );
  }

  const exactSource = packet[item.section].find(
    (statement) =>
      statement.statement === item.text &&
      item.sourceRefs.every((sourceRef) =>
        statement.sourceRefs.includes(sourceRef),
      ),
  );
  if (exactSource === undefined) {
    throw new PipelineError(
      "HANDOVER_UNSUPPORTED_CLAIM",
      "The generated handover narrative did not exactly match its cited source statement.",
      { status: 422, retryable: false },
    );
  }

  return { statement: item.text, sourceRefs: [...item.sourceRefs] };
}

function deterministicOnly(
  packet: HandoverPacket,
  creditsConsumed: number,
): RenderedHandover {
  return {
    title: "Current patient handover",
    sections: deterministicSections(packet),
    creditsConsumed,
  };
}

export function normalizeGeneratedHandover(
  value: NormalizeGeneratedHandoverInput,
): RenderedHandover {
  const generated = generatedNarrativeSchema.safeParse(value.generatedValue);
  const credits = creditsConsumedSchema.safeParse(value.creditsConsumed);
  if (!generated.success || !credits.success) throw invalidGeneratedOutput();

  const grouped = new Map<NarrativeSectionName, HandoverGroundedStatement[]>();
  for (const item of generated.data) {
    const statements = grouped.get(item.section) ?? [];
    statements.push(validateNarrativeItem(item, value.input.packet));
    grouped.set(item.section, statements);
  }

  const sections: RenderedHandover["sections"] = [];
  for (const definition of narrativeSections) {
    const statements = grouped.get(definition.input);
    if (statements === undefined || statements.length === 0) continue;
    sections.push({
      sectionId: definition.sectionId,
      heading: definition.heading,
      statements,
    });
  }
  sections.push(...deterministicSections(value.input.packet));

  return {
    title: "Current patient handover",
    sections,
    creditsConsumed: credits.data,
  };
}

export async function renderGroundedHandover(
  input: RenderHandoverInput,
  generate: GenerateHandoverNarrative,
): Promise<RenderedHandover> {
  const context = narrativeContext(input.packet);
  if (!hasNarrative(context)) return deterministicOnly(input.packet, 0);
  const generated = await generate(context);
  return normalizeGeneratedHandover({ input, ...generated });
}

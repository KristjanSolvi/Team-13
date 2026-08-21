import type {
  AmbientSession,
  CodingResult,
  CodingSystem,
  FollowThroughCandidate,
  GeneratedSupportingDocument,
  ScopedToken,
  SupportingDocumentType,
  TaskRevisionPreview,
  TranscriptReviewResult,
  TranscriptSegment,
} from "@pipeline/contracts.js";
import type { Thread } from "@/data/ward";

type IntegrationHealth = { status: "ok" };

export type IntegrationReadiness = {
  status: "ready" | "degraded";
  liveCortiReady: boolean;
  services: Record<
    string,
    {
      reachable: boolean;
      detail?: unknown;
      error?: unknown;
    }
  >;
};

export type WardCompanionOverview = {
  schemaVersion: "1";
  patientId: string;
  observedAt: string;
  threads: Thread[];
  changeImpacts: ChangeImpact[];
};

export type ChangeImpact = {
  impactId: string;
  revisionId: string;
  dependencyId: string;
  patientId: string;
  sourceItemId: string;
  sourceRef: string;
  artifactKind: "task" | "handover";
  artifactId: string;
  artifactVersion: number;
  status: "review_required";
  summary: string;
  detectedAt: string;
  changedAt: string;
  changedBy: string;
  reason: "new_result" | "medication_update" | "clinical_note_revision" | "other";
};

export type CandidateGenerationResult = {
  candidates: FollowThroughCandidate[];
  rejectedEvidenceCount: number;
  rejectedAudioQualityCount: number;
  creditsConsumed: number;
};

export type CandidateInvestigationResult = {
  candidateId: string;
  handoff: unknown;
};

export type DemoScenario = "meeting" | "discharge_coordination" | "ward_consultation";

export type DemoParticipant = {
  participantId: string;
  sessionId: string;
  groupId: string;
  displayName: string;
  memberId: string;
  joinedAt: string;
  assignedTaskCount?: number;
};

export type DemoRoutingCandidate = {
  memberId: string;
  teamId: string;
  eligible: boolean;
  rank: number | null;
  openTaskCount: number;
  capacity: number;
  capabilities: string[];
  missingCapabilities: string[];
  checks: {
    teamMatch: boolean;
    onShift: boolean;
    available: boolean;
    hasCapacity: boolean;
    capabilitiesMatch: boolean;
  };
  exclusionReasons: Array<
    "wrong_team" | "off_shift" | "unavailable" | "at_capacity" | "missing_capability"
  >;
};

export type DemoRoutingDecision = {
  policyVersion: "availability-capability-load-v1";
  selectedMemberId: string | null;
  requiredCapabilities: string[];
  candidates: DemoRoutingCandidate[];
};

export type DemoAssignment = {
  assignmentId: string;
  sessionId: string;
  groupId: string;
  participantId: string;
  taskId: string;
  assignedBy: string;
  assignedAt: string;
  routingDecision?: DemoRoutingDecision | null;
};

export type DemoSession = {
  sessionId: string;
  joinCode: string;
  joinPath: string;
  title: string;
  scenario: DemoScenario;
  groupSize: 1 | 2;
  targetTeamId: string;
  createdAt: string;
  groups: Array<{ groupId: string; participants: DemoParticipant[] }>;
  assignments: DemoAssignment[];
};

export type DemoAssignedTask = {
  taskId: string;
  summary: string;
  state:
    | "draft"
    | "offered_to_team"
    | "assigned_to_member"
    | "accepted"
    | "completed"
    | "verified"
    | "escalated"
    | "dismissed";
  assignedMemberId: string | null;
  dueBy: string;
  version: number;
};

export type DemoParticipantView = {
  participant: DemoParticipant;
  session: Omit<DemoSession, "groups" | "assignments">;
  assignments: Array<{ assignment: DemoAssignment; task: DemoAssignedTask }>;
};

export type DemoAssignmentResult = {
  assignment: DemoAssignment;
  participant: DemoParticipant;
  task: DemoAssignedTask;
};

export type ClinicalDocument = {
  schemaVersion: "1";
  documentId: string;
  patientId: string;
  category: "medical" | "discharge";
  title: string;
  content: string;
  source: "clinician" | "agent" | "scribe";
  status: "draft" | "filed";
  version: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  filedAt: string | null;
  filedBy: string | null;
  correlationId: string;
  codingReview: ClinicalCodingReview | null;
};

export type CodingReviewInput = {
  outcome: "accepted" | "rejected" | "no-suggestions" | "unavailable";
  approvalId: string;
  system: CodingSystem;
  selectedCode: {
    suggestionKind: "supported" | "candidate";
    code: string;
    display: string;
    evidenceStatus: "validated" | "unavailable";
    evidences: Array<{ text: string; start: number; end: number }>;
  } | null;
};

export type ClinicalCodingReview = CodingReviewInput & {
  reviewedAt: string;
  reviewedBy: string;
};

export type ClinicalDocumentVersion = ClinicalDocument & {
  changeReason: string;
};

export type EhrPatientRecord = {
  schemaVersion: "1";
  patientId: string;
  profile: unknown;
  documents: ClinicalDocument[];
  observedAt: string;
};

export class FollowThroughApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
    readonly correlationId?: string,
  ) {
    super(message);
  }
}

function browserOrigin(): string {
  return window.location.origin;
}

function integrationUrl(path: string): URL {
  return new URL(`/follow-through-api${path}`, browserOrigin());
}

async function responseJson<T>(response: Response, acceptedStatuses: number[] = []): Promise<T> {
  const value = (await response.json().catch(() => null)) as unknown;
  if (!response.ok && !acceptedStatuses.includes(response.status)) {
    const error =
      typeof value === "object" && value !== null && "error" in value
        ? (value as { error?: Record<string, unknown> }).error
        : undefined;
    throw new FollowThroughApiError(
      typeof error?.["message"] === "string"
        ? error["message"]
        : "Follow-Through service request failed.",
      typeof error?.["code"] === "string" ? error["code"] : "REQUEST_FAILED",
      error?.["retryable"] === true,
      typeof error?.["correlationId"] === "string"
        ? error["correlationId"]
        : (response.headers.get("x-correlation-id") ?? undefined),
    );
  }
  return value as T;
}

function jsonHeaders(correlationId: string): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-correlation-id": correlationId,
  };
}

function attributedJsonHeaders(correlationId: string, actorId: string): Record<string, string> {
  return {
    ...jsonHeaders(correlationId),
    "x-actor-id": actorId,
  };
}

export async function getIntegrationHealth(): Promise<IntegrationHealth> {
  return responseJson<IntegrationHealth>(await fetch(integrationUrl("/healthz")));
}

export async function getIntegrationReadiness(): Promise<IntegrationReadiness> {
  return responseJson<IntegrationReadiness>(
    await fetch(integrationUrl("/readyz")),
    // The integration API deliberately returns 503 when an optional downstream
    // service is degraded. Its body still tells us whether live Corti capture is ready.
    [503],
  );
}

export async function createAmbientSession(
  encounterIdentifier: string,
  correlationId: string,
): Promise<AmbientSession> {
  return responseJson<AmbientSession>(
    await fetch(integrationUrl("/api/corti/ambient/session"), {
      method: "POST",
      headers: jsonHeaders(correlationId),
      body: JSON.stringify({ encounterIdentifier }),
    }),
  );
}

export async function refreshAmbientToken(correlationId: string): Promise<ScopedToken> {
  return responseJson<ScopedToken>(
    await fetch(integrationUrl("/api/corti/ambient/token"), {
      method: "POST",
      headers: jsonHeaders(correlationId),
      body: "{}",
    }),
  );
}

export async function getDictationToken(correlationId: string): Promise<ScopedToken> {
  return responseJson<ScopedToken>(
    await fetch(integrationUrl("/api/corti/dictation/token"), {
      method: "POST",
      headers: jsonHeaders(correlationId),
      body: "{}",
    }),
  );
}

export async function buildDictationRevisionPreview(input: {
  taskId: string;
  expectedVersion: number;
  idempotencyKey: string;
  transcript: string;
  recipientTeams: Array<{ id: string; label: string; aliases: string[] }>;
  correlationId: string;
}): Promise<TaskRevisionPreview> {
  return responseJson<TaskRevisionPreview>(
    await fetch(integrationUrl("/api/corti/dictation/revision-preview"), {
      method: "POST",
      headers: jsonHeaders(input.correlationId),
      body: JSON.stringify({
        taskId: input.taskId,
        expectedVersion: input.expectedVersion,
        idempotencyKey: input.idempotencyKey,
        transcript: input.transcript,
        recipientTeams: input.recipientTeams,
      }),
    }),
  );
}

export async function generateCandidates(input: {
  patientId: string;
  interactionId: string;
  correlationId: string;
  segments: TranscriptSegment[];
}): Promise<CandidateGenerationResult> {
  return responseJson<CandidateGenerationResult>(
    await fetch(integrationUrl("/api/corti/candidates/generate"), {
      method: "POST",
      headers: jsonHeaders(input.correlationId),
      body: JSON.stringify({
        patientId: input.patientId,
        interactionId: input.interactionId,
        segments: input.segments,
      }),
    }),
  );
}

export async function reviewTranscript(input: {
  interactionId: string;
  correlationId: string;
  segments: TranscriptSegment[];
  contextTerms: string[];
  protectedTerms: string[];
}): Promise<TranscriptReviewResult> {
  return responseJson<TranscriptReviewResult>(
    await fetch(integrationUrl("/api/corti/transcripts/review"), {
      method: "POST",
      headers: jsonHeaders(input.correlationId),
      body: JSON.stringify({
        interactionId: input.interactionId,
        segments: input.segments,
        contextTerms: input.contextTerms,
        protectedTerms: input.protectedTerms,
      }),
    }),
  );
}

export async function investigateCandidate(
  candidate: FollowThroughCandidate,
): Promise<CandidateInvestigationResult> {
  return responseJson<CandidateInvestigationResult>(
    await fetch(integrationUrl("/api/candidates/investigate"), {
      method: "POST",
      headers: jsonHeaders(candidate.correlationId),
      body: JSON.stringify(candidate),
    }),
  );
}

export type WardTaskCommand = NonNullable<Thread["backend"]>["availableCommands"][number];

export type TaskCommandResult = {
  agentState?: string;
  credits?: number;
  recordDraft?:
    | {
        status: "created" | "existing";
        document: ClinicalDocument;
        creditsConsumed: number;
      }
    | { status: "unavailable"; retryable: boolean };
  [key: string]: unknown;
};

export type DownstreamDelivery = {
  schemaVersion: "1";
  deliveryId: string;
  sourceTaskId: string;
  patientId: string;
  targetSystem: string;
  kind: "team-task" | "referral" | "callback";
  summary: string;
  instructions: string | null;
  dueAt: string;
  referralSnapshotId: string | null;
  status:
    | "pending_submission"
    | "submission_failed"
    | "submitted"
    | "accepted"
    | "completed"
    | "rejected";
  externalReference: string | null;
  outcomeReference: string | null;
  sourceAcknowledgedAt: string | null;
  statusReason: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  correlationId: string;
};

/**
 * Demo actor identities seeded by the agentic backend's Karen fixture.
 * Clinician commands (approve/correct/dismiss/reopen) are attributed to the
 * clinician; accept/decline/complete must come from an eligible team member.
 */
export const demoActors = {
  clinician: "clinician-1",
  teamMember: "nurse-a",
} as const;

export async function executeTaskCommand(input: {
  taskId: string;
  command: WardTaskCommand;
  actorId: string;
  correlationId: string;
  body: Record<string, unknown>;
}): Promise<TaskCommandResult> {
  return responseJson<TaskCommandResult>(
    await fetch(integrationUrl(`/api/tasks/${encodeURIComponent(input.taskId)}/${input.command}`), {
      method: "POST",
      headers: {
        ...jsonHeaders(input.correlationId),
        "x-actor-id": input.actorId,
      },
      body: JSON.stringify(input.body),
    }),
  );
}

export async function getTaskDeliveries(
  taskId: string,
  correlationId: string,
): Promise<{ deliveries: DownstreamDelivery[] }> {
  return responseJson<{ deliveries: DownstreamDelivery[] }>(
    await fetch(integrationUrl(`/api/tasks/${encodeURIComponent(taskId)}/deliveries`), {
      headers: { "x-correlation-id": correlationId },
    }),
  );
}

export type HandoverStatement = { statement: string; sourceRefs: string[] };
export type HandoverSection = {
  sectionId: string;
  heading: string;
  statements: HandoverStatement[];
};
export type GroundedHandover = {
  handoverId: string;
  patientId: string;
  status: "draft";
  renderingStatus: "pending" | "rendered";
  sourceSnapshotHash: string;
  rendered: {
    title: string;
    sections: HandoverSection[];
    creditsConsumed: number;
  } | null;
};

export type WardMeeting = {
  meetingId: string;
  wardId: string;
  interactionId: string;
  status: "recording" | "completed" | "failed";
  startedBy: string;
  startedAt: string;
  completedAt: string | null;
  version: number;
};

export type PatientMeetingSegment = {
  segmentId: string;
  meetingId: string;
  patientId: string;
  status: "recording" | "closed" | "reconciling" | "reconciled" | "failed";
  openedBy: string;
  openedAt: string;
  closedAt: string | null;
  version: number;
};

export type MeetingDraftTask = {
  taskId: string;
  summary: string;
  state:
    | "draft"
    | "offered_to_team"
    | "assigned_to_member"
    | "accepted"
    | "completed"
    | "verified"
    | "escalated"
    | "dismissed";
  version: number;
};

export type MeetingCarryForward = {
  warningId: string;
  taskRef: string;
  reason: "unresolved" | "not_discussed" | "overdue";
};

export type WardMeetingStartResult = {
  meeting: WardMeeting;
  replayed: boolean;
  ambientSession: AmbientSession;
};

export type WardMeetingSegmentResult = {
  meeting: WardMeeting;
  segment: PatientMeetingSegment;
  replayed: boolean;
};

export type WardMeetingTranscriptResult = {
  evidence: Array<{
    evidenceId: string;
    meetingId: string;
    patientSegmentId: string | null;
    interactionId: string;
    segmentKey: string;
    text: string;
    startSeconds: number;
    endSeconds: number;
    speakerId?: number;
    isFinal: boolean;
    audioQuality: "clear" | "uncertain";
    eligible: boolean;
    sourceRef: string | null;
    recordedAt: string;
  }>;
  ignoredInterimCount: number;
  replayed: boolean;
};

export type WardMeetingReconciliationResult = WardMeetingSegmentResult & {
  reconciliation: {
    reconciliationId: string;
    meetingId: string;
    patientSegmentId: string;
    patientId: string;
    status: "requested" | "saved" | "failed";
    newDraftTaskIds: string[];
    carryForwardTaskRefs: string[];
    version: number;
  };
  newDraftTasks: MeetingDraftTask[];
  carryForwards: MeetingCarryForward[];
};

export async function startWardMeeting(input: {
  wardId: string;
  encounterIdentifier: string;
  idempotencyKey: string;
  actorId: string;
  correlationId: string;
}): Promise<WardMeetingStartResult> {
  return responseJson<WardMeetingStartResult>(
    await fetch(integrationUrl("/api/ward-meetings"), {
      method: "POST",
      headers: attributedJsonHeaders(input.correlationId, input.actorId),
      body: JSON.stringify({
        wardId: input.wardId,
        encounterIdentifier: input.encounterIdentifier,
        idempotencyKey: input.idempotencyKey,
      }),
    }),
  );
}

export async function openWardMeetingSegment(input: {
  meetingId: string;
  patientId: string;
  expectedMeetingVersion: number;
  idempotencyKey: string;
  actorId: string;
  correlationId: string;
}): Promise<WardMeetingSegmentResult> {
  return responseJson<WardMeetingSegmentResult>(
    await fetch(
      integrationUrl(`/api/ward-meetings/${encodeURIComponent(input.meetingId)}/segments`),
      {
        method: "POST",
        headers: attributedJsonHeaders(input.correlationId, input.actorId),
        body: JSON.stringify({
          patientId: input.patientId,
          expectedMeetingVersion: input.expectedMeetingVersion,
          idempotencyKey: input.idempotencyKey,
        }),
      },
    ),
  );
}

export async function appendWardMeetingTranscript(input: {
  meetingId: string;
  patientSegmentId: string;
  segments: TranscriptSegment[];
  idempotencyKey: string;
  actorId: string;
  correlationId: string;
}): Promise<WardMeetingTranscriptResult> {
  return responseJson<WardMeetingTranscriptResult>(
    await fetch(
      integrationUrl(
        `/api/ward-meetings/${encodeURIComponent(input.meetingId)}/transcript-segments`,
      ),
      {
        method: "POST",
        headers: attributedJsonHeaders(input.correlationId, input.actorId),
        body: JSON.stringify({
          patientSegmentId: input.patientSegmentId,
          segments: input.segments.map((segment) => ({
            segmentKey: segment.segmentKey,
            text: segment.text,
            startSeconds: segment.startSeconds,
            endSeconds: segment.endSeconds,
            ...(segment.speakerId === undefined ? {} : { speakerId: segment.speakerId }),
            isFinal: segment.isFinal,
            // Missing quality is never upgraded to clear evidence.
            audioQuality: segment.audioQuality ?? "uncertain",
          })),
          idempotencyKey: input.idempotencyKey,
        }),
      },
    ),
  );
}

export async function closeAndReconcileWardMeetingSegment(input: {
  meetingId: string;
  segmentId: string;
  expectedMeetingVersion: number;
  expectedSegmentVersion: number;
  idempotencyKey: string;
  actorId: string;
  correlationId: string;
}): Promise<WardMeetingReconciliationResult> {
  return responseJson<WardMeetingReconciliationResult>(
    await fetch(
      integrationUrl(
        `/api/ward-meetings/${encodeURIComponent(input.meetingId)}/segments/${encodeURIComponent(input.segmentId)}/close`,
      ),
      {
        method: "POST",
        headers: attributedJsonHeaders(input.correlationId, input.actorId),
        body: JSON.stringify({
          expectedMeetingVersion: input.expectedMeetingVersion,
          expectedSegmentVersion: input.expectedSegmentVersion,
          idempotencyKey: input.idempotencyKey,
        }),
      },
    ),
  );
}

export async function completeWardMeeting(input: {
  meetingId: string;
  expectedMeetingVersion: number;
  idempotencyKey: string;
  actorId: string;
  correlationId: string;
}): Promise<{ meeting: WardMeeting; replayed: boolean }> {
  return responseJson<{ meeting: WardMeeting; replayed: boolean }>(
    await fetch(
      integrationUrl(`/api/ward-meetings/${encodeURIComponent(input.meetingId)}/complete`),
      {
        method: "POST",
        headers: attributedJsonHeaders(input.correlationId, input.actorId),
        body: JSON.stringify({
          expectedMeetingVersion: input.expectedMeetingVersion,
          idempotencyKey: input.idempotencyKey,
        }),
      },
    ),
  );
}

/**
 * Ask the handover Corti agent for a fresh, evidence-linked patient handover.
 * The integration API refuses stale drafts, so a success is current by
 * construction. Requires the dev proxy to hold the integration bearer.
 */
export async function requestPatientHandover(input: {
  patientId: string;
  actorId: string;
  correlationId: string;
  focus?: string;
}): Promise<GroundedHandover> {
  const focus = input.focus?.trim();
  return responseJson<GroundedHandover>(
    await fetch(integrationUrl(`/api/patients/${encodeURIComponent(input.patientId)}/handovers`), {
      method: "POST",
      headers: {
        ...jsonHeaders(input.correlationId),
        "x-actor-id": input.actorId,
      },
      body: JSON.stringify({
        idempotencyKey: `handover-${crypto.randomUUID()}`,
        reason: "on_demand",
        focus: focus !== undefined && focus.length > 0 ? focus : null,
      }),
    }),
  );
}

export async function getWardCompanionOverview(
  patientId: string,
  correlationId: string,
): Promise<WardCompanionOverview> {
  return responseJson<WardCompanionOverview>(
    await fetch(integrationUrl(`/api/patients/${encodeURIComponent(patientId)}/companion`), {
      headers: { "x-correlation-id": correlationId },
    }),
  );
}

export async function simulateSyntheticSourceRevision(input: {
  patientId: string;
  actorId: string;
  correlationId: string;
  idempotencyKey: string;
}): Promise<unknown> {
  return responseJson<unknown>(
    await fetch(
      integrationUrl(`/api/demo/patients/${encodeURIComponent(input.patientId)}/source-revisions`),
      {
        method: "POST",
        headers: attributedJsonHeaders(input.correlationId, input.actorId),
        body: JSON.stringify({ idempotencyKey: input.idempotencyKey }),
      },
    ),
  );
}

export async function createDemoSession(input: {
  title: string;
  scenario: DemoScenario;
  groupSize: 1 | 2;
  targetTeamId: string;
  actorId: string;
  correlationId: string;
}): Promise<DemoSession> {
  return responseJson<DemoSession>(
    await fetch(integrationUrl("/api/demo/sessions"), {
      method: "POST",
      headers: attributedJsonHeaders(input.correlationId, input.actorId),
      body: JSON.stringify({
        title: input.title,
        scenario: input.scenario,
        groupSize: input.groupSize,
        targetTeamId: input.targetTeamId,
        idempotencyKey: `demo-session-${crypto.randomUUID()}`,
      }),
    }),
  );
}

export async function getDemoSession(
  sessionId: string,
  correlationId: string,
): Promise<DemoSession> {
  return responseJson<DemoSession>(
    await fetch(integrationUrl(`/api/demo/sessions/${encodeURIComponent(sessionId)}`), {
      headers: { "x-correlation-id": correlationId },
    }),
  );
}

export async function joinDemoSession(input: {
  joinCode: string;
  displayName: string;
  joinKey: string;
  correlationId: string;
}): Promise<{
  participant: DemoParticipant;
  participantToken: string;
  session: Omit<DemoSession, "groups" | "assignments">;
}> {
  return responseJson(
    await fetch(integrationUrl(`/api/demo/join/${encodeURIComponent(input.joinCode)}`), {
      method: "POST",
      headers: jsonHeaders(input.correlationId),
      body: JSON.stringify({ displayName: input.displayName, joinKey: input.joinKey }),
    }),
  );
}

export async function assignDemoTask(input: {
  sessionId: string;
  groupId: string;
  taskId: string;
  expectedVersion: number;
  actorId: string;
  correlationId: string;
}): Promise<DemoAssignmentResult> {
  return responseJson<DemoAssignmentResult>(
    await fetch(
      integrationUrl(`/api/demo/sessions/${encodeURIComponent(input.sessionId)}/assign`),
      {
        method: "POST",
        headers: attributedJsonHeaders(input.correlationId, input.actorId),
        body: JSON.stringify({
          groupId: input.groupId,
          taskId: input.taskId,
          expectedVersion: input.expectedVersion,
          idempotencyKey: `demo-assign-${crypto.randomUUID()}`,
        }),
      },
    ),
  );
}

export async function getDemoParticipantView(
  participantToken: string,
  correlationId: string,
): Promise<DemoParticipantView> {
  return responseJson<DemoParticipantView>(
    await fetch(integrationUrl("/api/demo/participants/me"), {
      headers: {
        authorization: `Bearer ${participantToken}`,
        "x-correlation-id": correlationId,
      },
    }),
  );
}

export async function generateSupportingDocument(input: {
  approvalId: string;
  approvedClinicalText: string;
  documentType: SupportingDocumentType;
  correlationId: string;
}): Promise<GeneratedSupportingDocument> {
  return responseJson<GeneratedSupportingDocument>(
    await fetch(integrationUrl("/api/corti/documents/generate"), {
      method: "POST",
      headers: jsonHeaders(input.correlationId),
      body: JSON.stringify({
        approvalId: input.approvalId,
        approvedClinicalText: input.approvedClinicalText,
        documentType: input.documentType,
      }),
    }),
  );
}

export async function predictMedicalCodes(input: {
  approvalId: string;
  approvedClinicalText: string;
  system?: CodingSystem;
  correlationId: string;
}): Promise<CodingResult> {
  return responseJson<CodingResult>(
    await fetch(integrationUrl("/api/corti/coding/predict"), {
      method: "POST",
      headers: jsonHeaders(input.correlationId),
      body: JSON.stringify({
        approvalId: input.approvalId,
        approvedClinicalText: input.approvedClinicalText,
        ...(input.system === undefined ? {} : { system: input.system }),
      }),
    }),
  );
}

export async function getEhrPatientRecord(
  patientId: string,
  correlationId: string,
): Promise<EhrPatientRecord> {
  return responseJson<EhrPatientRecord>(
    await fetch(integrationUrl(`/api/ehr/patients/${encodeURIComponent(patientId)}`), {
      headers: { "x-correlation-id": correlationId },
    }),
  );
}

export async function createEhrDocument(input: {
  patientId: string;
  actorId: string;
  correlationId: string;
  idempotencyKey: string;
  category: ClinicalDocument["category"];
  title: string;
  content: string;
  source: ClinicalDocument["source"];
  codingReview: CodingReviewInput | null;
}): Promise<ClinicalDocument> {
  return responseJson<ClinicalDocument>(
    await fetch(
      integrationUrl(`/api/ehr/patients/${encodeURIComponent(input.patientId)}/documents`),
      {
        method: "POST",
        headers: attributedJsonHeaders(input.correlationId, input.actorId),
        body: JSON.stringify({
          idempotencyKey: input.idempotencyKey,
          category: input.category,
          title: input.title,
          content: input.content,
          source: input.source,
          codingReview: input.codingReview,
        }),
      },
    ),
  );
}

export async function reviseEhrDocument(input: {
  documentId: string;
  actorId: string;
  correlationId: string;
  expectedVersion: number;
  idempotencyKey: string;
  reason: string;
  changes: { title?: string; content?: string; codingReview?: CodingReviewInput | null };
}): Promise<ClinicalDocument> {
  return responseJson<ClinicalDocument>(
    await fetch(integrationUrl(`/api/ehr/documents/${encodeURIComponent(input.documentId)}`), {
      method: "PATCH",
      headers: attributedJsonHeaders(input.correlationId, input.actorId),
      body: JSON.stringify({
        expectedVersion: input.expectedVersion,
        idempotencyKey: input.idempotencyKey,
        reason: input.reason,
        changes: input.changes,
      }),
    }),
  );
}

export async function fileEhrDocument(input: {
  documentId: string;
  actorId: string;
  correlationId: string;
  expectedVersion: number;
  idempotencyKey: string;
  reason: string;
}): Promise<ClinicalDocument> {
  return responseJson<ClinicalDocument>(
    await fetch(integrationUrl(`/api/ehr/documents/${encodeURIComponent(input.documentId)}/file`), {
      method: "POST",
      headers: attributedJsonHeaders(input.correlationId, input.actorId),
      body: JSON.stringify({
        expectedVersion: input.expectedVersion,
        idempotencyKey: input.idempotencyKey,
        reason: input.reason,
      }),
    }),
  );
}

export async function getEhrDocumentHistory(
  documentId: string,
  correlationId: string,
): Promise<{ versions: ClinicalDocumentVersion[] }> {
  return responseJson<{ versions: ClinicalDocumentVersion[] }>(
    await fetch(integrationUrl(`/api/ehr/documents/${encodeURIComponent(documentId)}/history`), {
      headers: { "x-correlation-id": correlationId },
    }),
  );
}

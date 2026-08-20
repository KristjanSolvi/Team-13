import { createHash, randomBytes, randomUUID } from "node:crypto";

import { chooseMember } from "../domain/routing.js";
import { DomainError } from "../domain/errors.js";
import type {
  DemoAssignment,
  DemoGroupSize,
  DemoParticipant,
  DemoScenario,
  DemoSession,
} from "../demo/types.js";
import type { Clock } from "../infra/clock.js";
import type { SqliteStore } from "../infra/store.js";

export interface CreateDemoSessionInput {
  title: string;
  scenario: DemoScenario;
  groupSize: DemoGroupSize;
  targetTeamId: string;
  idempotencyKey: string;
  actorId: string;
}

export interface JoinDemoSessionInput {
  joinCode: string;
  displayName: string;
  joinKey: string;
}

export interface AssignDemoTaskInput {
  sessionId: string;
  groupId: string;
  taskId: string;
  expectedVersion: number;
  idempotencyKey: string;
  actorId: string;
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function publicParticipant(participant: DemoParticipant) {
  return {
    participantId: participant.participantId,
    sessionId: participant.sessionId,
    groupId: participant.groupId,
    displayName: participant.displayName,
    memberId: participant.memberId,
    joinedAt: participant.joinedAt,
  };
}

export class DemoAudienceService {
  constructor(
    private readonly store: SqliteStore,
    private readonly clock: Clock,
  ) {}

  createSession(input: CreateDemoSessionInput) {
    const commandScope = `demo-session-create:${input.actorId}`;
    return this.store.transaction(() => {
      const replay = this.store.getProcessedCommand(
        commandScope,
        input.idempotencyKey,
      );
      if (replay) {
        return this.getSession(String(replay.sessionId));
      }

      const team = this.store.getTeam(input.targetTeamId);
      if (!team) {
        throw new DomainError(
          "TEAM_NOT_FOUND",
          "Target team not found",
          false,
          404,
        );
      }

      const createdAt = this.clock.now().toISOString();
      const session: DemoSession = {
        sessionId: randomUUID(),
        joinCode: this.uniqueJoinCode(),
        title: input.title,
        scenario: input.scenario,
        groupSize: input.groupSize,
        targetTeamId: team.teamId,
        createdBy: input.actorId,
        createdAt,
      };
      this.store.putDemoSession(session);
      this.store.saveProcessedCommand(
        commandScope,
        input.idempotencyKey,
        { sessionId: session.sessionId },
        createdAt,
      );
      this.store.appendEvent({
        eventType: "demo.session_created",
        occurredAt: createdAt,
        correlationId: session.sessionId,
        patientId: "synthetic-system",
        interactionId: session.sessionId,
        contextId: null,
        actor: { type: "clinician", id: input.actorId },
        payload: {
          sessionId: session.sessionId,
          scenario: session.scenario,
          groupSize: session.groupSize,
          targetTeamId: session.targetTeamId,
        },
      });
      return this.getSession(session.sessionId);
    });
  }

  joinSession(input: JoinDemoSessionInput) {
    return this.store.transaction(() => {
      const session = this.store.getDemoSessionByJoinCode(input.joinCode);
      if (!session) {
        throw new DomainError(
          "DEMO_SESSION_NOT_FOUND",
          "Demo session not found",
          false,
          404,
        );
      }
      const team = this.store.getTeam(session.targetTeamId);
      if (!team) {
        throw new DomainError(
          "TEAM_NOT_FOUND",
          "Target team not found",
          false,
          404,
        );
      }

      const participantToken = randomBytes(32).toString("base64url");
      const existing = this.store.getDemoParticipantByJoinKey(
        session.sessionId,
        input.joinKey,
      );
      if (existing) {
        const rotated = {
          ...existing,
          displayName: input.displayName,
          tokenHash: tokenHash(participantToken),
        };
        this.store.putDemoParticipant(rotated);
        return {
          participant: publicParticipant(rotated),
          participantToken,
          session: this.sessionSummary(session),
        };
      }

      const participants = this.store.listDemoParticipants(session.sessionId);
      const participantId = randomUUID();
      const participant: DemoParticipant = {
        participantId,
        sessionId: session.sessionId,
        groupId: `group-${Math.floor(participants.length / session.groupSize) + 1}`,
        displayName: input.displayName,
        memberId: `audience:${participantId}`,
        joinKey: input.joinKey,
        tokenHash: tokenHash(participantToken),
        joinedAt: this.clock.now().toISOString(),
      };
      this.store.putMember({
        memberId: participant.memberId,
        teamId: team.teamId,
        capabilities: team.capabilities,
        onShift: true,
        available: true,
        openTaskCount: 0,
        capacity: 100,
        tieBreakKey: `${String(participants.length).padStart(6, "0")}:${participant.participantId}`,
      });
      this.store.putDemoParticipant(participant);
      this.store.appendEvent({
        eventType: "demo.participant_joined",
        occurredAt: participant.joinedAt,
        correlationId: session.sessionId,
        patientId: "synthetic-system",
        interactionId: session.sessionId,
        contextId: null,
        actor: { type: "system", id: participant.memberId },
        payload: {
          sessionId: session.sessionId,
          participantId: participant.participantId,
          groupId: participant.groupId,
        },
      });
      return {
        participant: publicParticipant(participant),
        participantToken,
        session: this.sessionSummary(session),
      };
    });
  }

  getSession(sessionId: string) {
    const session = this.requireSession(sessionId);
    const participants = this.store.listDemoParticipants(sessionId);
    const assignments = this.store.listDemoAssignments(sessionId);
    const assignmentCounts = new Map<string, number>();
    for (const assignment of assignments) {
      assignmentCounts.set(
        assignment.participantId,
        (assignmentCounts.get(assignment.participantId) ?? 0) + 1,
      );
    }
    const groups = new Map<string, DemoParticipant[]>();
    for (const participant of participants) {
      const members = groups.get(participant.groupId) ?? [];
      members.push(participant);
      groups.set(participant.groupId, members);
    }
    return {
      ...this.sessionSummary(session),
      groups: [...groups.entries()].map(([groupId, members]) => ({
        groupId,
        participants: members.map((participant) => ({
          ...publicParticipant(participant),
          assignedTaskCount:
            assignmentCounts.get(participant.participantId) ?? 0,
        })),
      })),
      assignments,
    };
  }

  assignTask(input: AssignDemoTaskInput) {
    const commandScope = `demo-task-assign:${input.sessionId}:${input.taskId}`;
    return this.store.transaction(() => {
      const replay = this.store.getProcessedCommand(
        commandScope,
        input.idempotencyKey,
      );
      if (replay) {
        return this.assignmentResult(String(replay.assignmentId));
      }

      const session = this.requireSession(input.sessionId);
      const task = this.store.requireTask(input.taskId);
      if (task.targetTeamId !== session.targetTeamId) {
        throw new DomainError(
          "DEMO_TASK_TEAM_MISMATCH",
          "Task target team does not match the demo session",
          false,
          409,
        );
      }
      const existing = this.store.getDemoAssignmentByTask(task.taskId);
      if (existing) {
        if (
          existing.sessionId !== session.sessionId ||
          existing.groupId !== input.groupId
        ) {
          throw new DomainError(
            "DEMO_TASK_ALREADY_ASSIGNED",
            "Task is already assigned in another demo group",
            false,
            409,
          );
        }
        return this.assignmentResult(existing.assignmentId);
      }
      if (
        task.version !== input.expectedVersion ||
        task.state !== "offered_to_team"
      ) {
        throw new DomainError(
          "DEMO_TASK_NOT_ASSIGNABLE",
          "Task must be an unchanged published team task",
          false,
          409,
        );
      }

      const participants = this.store
        .listDemoParticipants(session.sessionId)
        .filter((participant) => participant.groupId === input.groupId);
      if (participants.length === 0) {
        throw new DomainError(
          "DEMO_GROUP_EMPTY",
          "Demo group has no participants",
          false,
          409,
        );
      }
      const assignmentCounts = new Map<string, number>();
      for (const assignment of this.store.listDemoAssignments(
        session.sessionId,
      )) {
        assignmentCounts.set(
          assignment.participantId,
          (assignmentCounts.get(assignment.participantId) ?? 0) + 1,
        );
      }
      const teamMembers = this.store.listMembers(session.targetTeamId);
      const members = participants
        .map((participant) => {
          const member = teamMembers.find(
            (candidate) => candidate.memberId === participant.memberId,
          );
          return member
            ? {
                ...member,
                openTaskCount:
                  assignmentCounts.get(participant.participantId) ?? 0,
              }
            : undefined;
        })
        .filter((member) => member !== undefined);
      const selected = chooseMember(task, members);
      if (!selected) {
        throw new DomainError(
          "DEMO_GROUP_INELIGIBLE",
          "Demo group has no eligible participant for this task",
          false,
          409,
        );
      }
      const participant = participants.find(
        (candidate) => candidate.memberId === selected.memberId,
      );
      if (!participant) {
        throw new DomainError(
          "DEMO_GROUP_INELIGIBLE",
          "Demo participant mapping is unavailable",
          false,
          409,
        );
      }

      const assignedAt = this.clock.now().toISOString();
      const assignment: DemoAssignment = {
        assignmentId: randomUUID(),
        sessionId: session.sessionId,
        groupId: input.groupId,
        participantId: participant.participantId,
        taskId: task.taskId,
        assignedBy: input.actorId,
        assignedAt,
      };
      this.store.assignMemberForDemo(
        task.taskId,
        task.version,
        participant.memberId,
        assignedAt,
        session.sessionId,
        input.groupId,
      );
      this.store.putDemoAssignment(assignment);
      this.store.saveProcessedCommand(
        commandScope,
        input.idempotencyKey,
        { assignmentId: assignment.assignmentId },
        assignedAt,
      );
      return this.assignmentResult(assignment.assignmentId);
    });
  }

  participantView(participantToken: string) {
    const participant = this.store.getDemoParticipantByTokenHash(
      tokenHash(participantToken),
    );
    if (!participant) {
      throw new DomainError(
        "DEMO_PARTICIPANT_UNAUTHORIZED",
        "Demo participant authentication is required",
        false,
        401,
      );
    }
    const session = this.requireSession(participant.sessionId);
    const assignments = this.store
      .listDemoAssignments(participant.sessionId)
      .filter(
        (assignment) => assignment.participantId === participant.participantId,
      )
      .map((assignment) => ({
        assignment,
        task: this.store.requireTask(assignment.taskId),
      }));
    return {
      participant: publicParticipant(participant),
      session: this.sessionSummary(session),
      assignments,
    };
  }

  private assignmentResult(assignmentId: string) {
    const assignment = this.store.requireDemoAssignment(assignmentId);
    const participant = this.store.requireDemoParticipant(
      assignment.participantId,
    );
    return {
      assignment,
      participant: publicParticipant(participant),
      task: this.store.requireTask(assignment.taskId),
    };
  }

  private requireSession(sessionId: string): DemoSession {
    const session = this.store.getDemoSession(sessionId);
    if (!session) {
      throw new DomainError(
        "DEMO_SESSION_NOT_FOUND",
        "Demo session not found",
        false,
        404,
      );
    }
    return session;
  }

  private sessionSummary(session: DemoSession) {
    return {
      sessionId: session.sessionId,
      joinCode: session.joinCode,
      joinPath: `/demo/join/${session.joinCode}`,
      title: session.title,
      scenario: session.scenario,
      groupSize: session.groupSize,
      targetTeamId: session.targetTeamId,
      createdAt: session.createdAt,
    };
  }

  private uniqueJoinCode(): string {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const code = randomBytes(6).toString("base64url").toUpperCase();
      if (!this.store.getDemoSessionByJoinCode(code)) return code;
    }
    throw new DomainError(
      "DEMO_JOIN_CODE_UNAVAILABLE",
      "Could not allocate a demo join code",
      true,
      503,
    );
  }
}

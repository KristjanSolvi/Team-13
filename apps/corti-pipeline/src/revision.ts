import type {
  DirectoryOption,
  RevisionPatch,
  TaskRevisionPreview,
} from "./contracts.js";

export interface ParseDictatedRevisionInput {
  taskId: string;
  transcript: string;
  recipientTeams: DirectoryOption[];
  owners: DirectoryOption[];
  now?: Date;
}

function normalizedTerms(option: DirectoryOption): string[] {
  return [option.label, ...(option.aliases ?? [])].map((term) =>
    term.toLocaleLowerCase(),
  );
}

function findMention(
  transcript: string,
  options: readonly DirectoryOption[],
  cue: RegExp,
): DirectoryOption | null {
  if (!cue.test(transcript)) {
    return null;
  }

  const lowered = transcript.toLocaleLowerCase();
  return (
    options.find((option) =>
      normalizedTerms(option).some((term) => lowered.includes(term)),
    ) ?? null
  );
}

function parseDueAt(transcript: string, now: Date): string | null {
  const match = transcript.match(/\bwithin\s+(\d{1,3})\s+hours?\b/i);
  if (match?.[1] === undefined) {
    return null;
  }

  const hours = Number.parseInt(match[1], 10);
  if (!Number.isFinite(hours) || hours < 1 || hours > 168) {
    return null;
  }

  return new Date(now.getTime() + hours * 60 * 60 * 1000).toISOString();
}

function parseDescription(transcript: string): string | null {
  const match = transcript.match(
    /\b(?:change\s+(?:the\s+)?action\s+to|action\s+is)\s+(.+?)(?=\s+(?:assign\s+to|route\s+to|owner\s+is|within\s+\d+\s+hours?|mark\s+(?:as\s+)?(?:urgent|routine)|because)\b|[.!?]?$)/i,
  );
  const description = match?.[1]?.trim();
  return description === undefined || description.length === 0
    ? null
    : description;
}

function parseReason(transcript: string): string | null {
  const match = transcript.match(/\bbecause\s+(.+?)[.!?]?$/i);
  const reason = match?.[1]?.trim();
  return reason === undefined || reason.length === 0 ? null : reason;
}

export function parseDictatedRevision(
  input: ParseDictatedRevisionInput,
): TaskRevisionPreview {
  const transcript = input.transcript.trim();
  const lowered = transcript.toLocaleLowerCase();
  const warnings: string[] = [];
  const patch: RevisionPatch = {};

  const description = parseDescription(transcript);
  if (description !== null) {
    patch.description = description;
  }

  const recipientTeam = findMention(
    transcript,
    input.recipientTeams,
    /\b(?:assign|route)\s+to\b/i,
  );
  if (recipientTeam !== null) {
    patch.recipientTeamId = recipientTeam.id;
  } else if (/\b(?:assign|route)\s+to\b/i.test(transcript)) {
    warnings.push("The receiving team was not found in the allowed directory.");
  }

  const owner = findMention(transcript, input.owners, /\bowner\s+is\b/i);
  if (owner !== null) {
    patch.ownerUserId = owner.id;
  } else if (/\bowner\s+is\b/i.test(transcript)) {
    warnings.push("The owner was not found in the allowed directory.");
  }

  const dueAt = parseDueAt(transcript, input.now ?? new Date());
  if (dueAt !== null) {
    patch.dueAt = dueAt;
  } else if (/\bwithin\b/i.test(transcript)) {
    warnings.push("Use a deadline between 1 and 168 hours for this prototype.");
  }

  if (/\bmark\s+(?:as\s+)?urgent\b/i.test(transcript)) {
    patch.priority = "urgent";
  } else if (/\bmark\s+(?:as\s+)?routine\b/i.test(transcript)) {
    patch.priority = "routine";
  }

  if (Object.keys(patch).length === 0) {
    warnings.push("No supported task fields were recognized; nothing will change.");
  }

  const reason = parseReason(transcript);
  const draft: TaskRevisionPreview["draft"] = {
    taskId: input.taskId,
    inputMethod: "dictated",
    transcript,
    patch,
  };

  if (reason !== null) {
    draft.reason = reason;
  }

  if (lowered.length === 0) {
    warnings.push("The final dictation transcript was empty.");
  }

  return { draft, warnings, requiresConfirmation: true };
}

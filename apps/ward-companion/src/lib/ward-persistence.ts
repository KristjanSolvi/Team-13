import type { CaseNote, Thread } from "@/data/ward";

const STORAGE_KEY = "ward-threads:ward-state:v1";
const STORAGE_VERSION = 1;

export type PersistedWardState = {
  threads: Thread[];
  notes: Record<string, CaseNote[]>;
};

type StorageReader = Pick<Storage, "getItem">;
type StorageWriter = Pick<Storage, "setItem">;

export function loadWardState(storage: StorageReader): PersistedWardState | null {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!isStoredEnvelope(parsed)) return null;
    return { threads: parsed.threads, notes: parsed.notes };
  } catch {
    return null;
  }
}

export function saveWardState(storage: StorageWriter, state: PersistedWardState): boolean {
  try {
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: STORAGE_VERSION,
        savedAt: new Date().toISOString(),
        threads: state.threads,
        notes: state.notes,
      }),
    );
    return true;
  } catch {
    return false;
  }
}

function isStoredEnvelope(value: unknown): value is {
  version: 1;
  savedAt: string;
  threads: Thread[];
  notes: Record<string, CaseNote[]>;
} {
  if (
    !isRecord(value) ||
    value["version"] !== STORAGE_VERSION ||
    !Array.isArray(value["threads"])
  ) {
    return false;
  }
  if (typeof value["savedAt"] !== "string" || !isRecord(value["notes"])) return false;
  if (!value["threads"].every(isThread)) return false;
  return Object.values(value["notes"]).every(
    (entries) => Array.isArray(entries) && entries.every(isCaseNote),
  );
}

function isThread(value: unknown): value is Thread {
  if (!isRecord(value)) return false;
  return (
    typeof value["id"] === "string" &&
    typeof value["patientId"] === "string" &&
    typeof value["title"] === "string" &&
    isThreadStatus(value["status"]) &&
    typeof value["heard"] === "string" &&
    typeof value["matters"] === "string" &&
    typeof value["suggestion"] === "string" &&
    (value["assignee"] === null || typeof value["assignee"] === "string") &&
    typeof value["due"] === "string" &&
    Array.isArray(value["candidates"]) &&
    Array.isArray(value["activity"])
  );
}

function isCaseNote(value: unknown): value is CaseNote {
  if (!isRecord(value)) return false;
  return (
    typeof value["id"] === "string" &&
    (value["doc"] === "medical" || value["doc"] === "discharge") &&
    typeof value["at"] === "string" &&
    typeof value["author"] === "string" &&
    (value["source"] === "clinician" ||
      value["source"] === "agent" ||
      value["source"] === "scribe") &&
    typeof value["text"] === "string"
  );
}

function isThreadStatus(value: unknown): value is Thread["status"] {
  return (
    value === "pending" || value === "tracking" || value === "verified" || value === "escalated"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

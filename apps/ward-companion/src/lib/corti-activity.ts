export const cortiProductDefinitions = [
  { id: "ambient", label: "Ambient", role: "Live clinical capture" },
  { id: "factsr", label: "FactsR", role: "Structured facts" },
  { id: "text-generation", label: "Text Generation", role: "Grounded review and drafts" },
  { id: "agentic", label: "Agentic + MCP", role: "Scoped context and task checks" },
  { id: "dictation", label: "Dictation", role: "Clinician corrections" },
  { id: "medical-coding", label: "Medical Coding", role: "Evidence-linked code review" },
] as const;

export type CortiProductId = (typeof cortiProductDefinitions)[number]["id"];
export type CortiActivityStatus = "active" | "completed" | "unavailable";

export type CortiActivityEntry = {
  product: CortiProductId;
  status: CortiActivityStatus;
  action: string;
  occurredAt: string;
  credits?: number;
};

export type CortiActivitySnapshot = Partial<Record<CortiProductId, CortiActivityEntry>>;

export const cortiActivityEvent = "ward-threads:corti-activity";
const storageKey = "ward-threads:corti-activity:v1";

export function readCortiActivity(): CortiActivitySnapshot {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (raw === null) return {};
    const value = JSON.parse(raw) as unknown;
    if (!isRecord(value) || value["version"] !== 1 || !isRecord(value["products"])) return {};
    const snapshot: CortiActivitySnapshot = {};
    for (const product of cortiProductDefinitions) {
      const entry = value["products"][product.id];
      if (isActivityEntry(entry, product.id)) snapshot[product.id] = entry;
    }
    return snapshot;
  } catch {
    return {};
  }
}

export function recordCortiActivity(
  entry: Omit<CortiActivityEntry, "occurredAt"> & { occurredAt?: string },
): void {
  if (typeof window === "undefined") return;
  const nextEntry: CortiActivityEntry = {
    ...entry,
    occurredAt: entry.occurredAt ?? new Date().toISOString(),
  };
  const products = { ...readCortiActivity(), [entry.product]: nextEntry };
  try {
    window.localStorage.setItem(storageKey, JSON.stringify({ version: 1, products }));
  } catch {
    // The visible in-session event still works when storage is unavailable.
  }
  window.dispatchEvent(
    new CustomEvent<CortiActivityEntry>(cortiActivityEvent, { detail: nextEntry }),
  );
}

function isActivityEntry(value: unknown, product: CortiProductId): value is CortiActivityEntry {
  if (!isRecord(value)) return false;
  return (
    value["product"] === product &&
    (value["status"] === "active" ||
      value["status"] === "completed" ||
      value["status"] === "unavailable") &&
    typeof value["action"] === "string" &&
    typeof value["occurredAt"] === "string" &&
    (value["credits"] === undefined || typeof value["credits"] === "number")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

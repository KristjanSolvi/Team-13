import { useEffect, useState, type ReactNode } from "react";
import { RecordClosure } from "@/components/ehr/RecordClosure";
import type { ActivityEntry, CaseNote, DocId, Patient } from "@/data/ward";
import { documents, patients } from "@/data/ward";
import { getEhrPatientRecord, type ClinicalDocument } from "@/lib/follow-through-api";

const tabs = ["Summary", "Notes", "Investigations", "Procedures", "Discharge"];

const obsRows: { label: string; values: string[] }[] = [
  { label: "Resp rate", values: ["18", "17", "20", "19", "18"] },
  { label: "SpO2", values: ["96%", "95%", "94%", "96%", "97%"] },
  { label: "O2 delivery", values: ["Air", "Air", "2L", "2L", "Air"] },
  { label: "Pulse", values: ["88", "92", "101", "94", "87"] },
  { label: "BP", values: ["124/78", "118/74", "132/85", "126/80", "122/76"] },
  { label: "Temp", values: ["36.8", "37.1", "37.6", "37.2", "36.9"] },
  { label: "Consciousness", values: ["A", "A", "A", "A", "A"] },
  { label: "NEWS2", values: ["1", "2", "5", "3", "1"] },
];

function Panel({
  title,
  children,
  className = "",
  onClick,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
  onClick?: (() => void) | undefined;
}) {
  const [open, setOpen] = useState(true);
  return (
    <section className={`flex flex-col border border-ehr-line bg-ehr-panel ${className}`}>
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          onClick?.();
        }}
        className="flex w-full items-center justify-between bg-ehr-chrome px-2 py-1 text-left text-[11px] font-semibold text-ehr-chrome-foreground transition-opacity hover:opacity-90"
      >
        {title}
        <span className="text-ehr-chrome-foreground/60">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="flex-1 overflow-hidden p-2 text-[11px] leading-tight text-ehr-foreground">
          {children}
        </div>
      )}
    </section>
  );
}

function Row({ left, right }: { left: string; right?: ReactNode }) {
  return (
    <div className="flex cursor-default justify-between gap-3 border-b border-ehr-line/70 py-[3px] last:border-0 hover:bg-ehr-accent/5">
      <span className="truncate">{left}</span>
      {right && <span className="shrink-0 text-ehr-muted">{right}</span>}
    </div>
  );
}

type ShellProps = {
  patient?: Patient | undefined;
  onSelectPatient?: ((id: string) => void) | undefined;
  notes?: CaseNote[] | undefined;
  onAddNote?: ((doc: DocId, text: string) => void) | undefined;
  activity?: ActivityEntry[] | undefined;
};

export function NervecentreShell({
  patient,
  onSelectPatient,
  notes = [],
  onAddNote,
  activity = [],
}: ShellProps) {
  const current = patient ?? patients[0]!;
  const [activeTab, setActiveTab] = useState("Summary");
  const [ehrDocuments, setEhrDocuments] = useState<ClinicalDocument[]>([]);
  const [ehrConnected, setEhrConnected] = useState<boolean | null>(null);

  useEffect(() => {
    let currentRequest = true;
    setEhrDocuments([]);
    if (current.backendLinked !== true) {
      setEhrConnected(false);
      return () => {
        currentRequest = false;
      };
    }
    setEhrConnected(null);
    void getEhrPatientRecord(current.pipelinePatientId, crypto.randomUUID())
      .then((record) => {
        if (!currentRequest || record.patientId !== current.pipelinePatientId) return;
        setEhrDocuments(record.documents);
        setEhrConnected(true);
      })
      .catch(() => {
        if (currentRequest) setEhrConnected(false);
      });
    return () => {
      currentRequest = false;
    };
  }, [current.backendLinked, current.pipelinePatientId]);

  const handleDocumentChange = (document: ClinicalDocument) => {
    setEhrConnected(true);
    setEhrDocuments((existing) => [
      document,
      ...existing.filter((candidate) => candidate.documentId !== document.documentId),
    ]);
  };
  return (
    <div className="min-h-screen bg-ehr-bg text-ehr-foreground">
      <div className="flex items-center justify-between bg-ehr-chrome px-3 py-1.5">
        <div className="flex items-center gap-6">
          <span className="text-[13px] font-semibold lowercase tracking-tight text-ehr-chrome-foreground">
            nervecentre
          </span>
        </div>
        <span className="text-[11px] text-ehr-chrome-foreground/70">
          S. Marriott · North Wing L4
        </span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ehr-line bg-ehr-banner px-3 py-2">
        <div className="flex min-w-0 items-baseline gap-3">
          <span className="truncate text-[15px] font-bold text-ehr-foreground">
            {current.name.split(" ").slice(-1)[0]!.toUpperCase()}, {current.name.split(" ")[0]}
          </span>
          <span className="text-[11px] text-ehr-muted">NHS 943 476 5919 · 62y</span>
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-ehr-line bg-ehr-panel px-3 py-1.5">
        {patients.map((p) => (
          <button
            key={p.id}
            onClick={() => onSelectPatient?.(p.id)}
            className={`shrink-0 rounded px-2 py-1 text-[11px] transition-colors ${
              p.id === current.id
                ? "bg-ehr-accent/15 font-semibold text-ehr-foreground"
                : "text-ehr-muted hover:bg-ehr-line/50"
            }`}
          >
            {p.bed} · {p.name.split(" ").slice(-1)[0]}
          </button>
        ))}
      </div>

      <div className="flex gap-3 overflow-x-auto border-b border-ehr-line bg-ehr-panel px-3 py-1 text-[11px] text-ehr-muted">
        {tabs.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setActiveTab(t)}
            className={
              t === activeTab
                ? "shrink-0 border-b-2 border-ehr-accent pb-1 font-semibold text-ehr-foreground"
                : "shrink-0 pb-1 hover:text-ehr-foreground"
            }
          >
            {t}
          </button>
        ))}
      </div>

      {activeTab === "Notes" ? (
        <NotesWorkspace
          patientId={current.pipelinePatientId}
          patientName={current.name}
          notes={notes}
          ehrDocuments={ehrDocuments}
          ehrConnected={ehrConnected}
          activity={activity}
          onAddNote={onAddNote}
          onDocumentChange={handleDocumentChange}
        />
      ) : (
        <div className="grid grid-cols-1 gap-2 p-2 lg:grid-cols-[1fr_1.6fr_1fr]">
          <div className="space-y-2">
            <Panel title="ED Clinical">
              <Row left="Triage category" right="Amber" />
              <Row left="Presenting complaint" right="Breathlessness" />
              <Row left="Allergies" right="Penicillin" />
              <Row left="Comorbidities" right="COPD, T2DM" />
              <Row left="Diagnosis" right="Infective exacerbation" />
            </Panel>
            <Panel title="Clinical Documents">
              {documents.map((d) => (
                <Row
                  key={d.id}
                  left={d.title}
                  right={`${
                    notes.filter((n) => n.doc === d.id).length +
                    ehrDocuments.filter((document) => document.category === d.id).length
                  } items`}
                />
              ))}
              {ehrDocuments.slice(0, 3).map((document) => (
                <button
                  key={document.documentId}
                  type="button"
                  onClick={() => setActiveTab("Notes")}
                  className="mt-1 flex w-full items-center justify-between gap-2 border border-ehr-line bg-ehr-bg px-2 py-1 text-left text-[10px] hover:border-ehr-accent"
                >
                  <span className="truncate">{document.title}</span>
                  <span
                    className={
                      document.status === "filed" ? "text-verified-strong" : "text-pending-strong"
                    }
                  >
                    {document.status} · v{document.version}
                  </span>
                </button>
              ))}
              <div className="mt-2 space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-ehr-muted">
                  Latest entries
                </p>
                {notes.length === 0 && <p className="text-ehr-muted">No entries yet.</p>}
                {notes
                  .slice(-3)
                  .reverse()
                  .map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => setActiveTab("Notes")}
                      className="block w-full border border-ehr-line bg-ehr-bg px-2 py-1 text-left hover:border-ehr-accent"
                    >
                      <span className="flex items-center justify-between gap-2 text-[10px] text-ehr-muted">
                        <span className="truncate font-semibold text-ehr-foreground">
                          {n.author}
                        </span>
                        <span className="tabular-nums">{n.at}</span>
                      </span>
                      <span className="mt-[2px] line-clamp-2 block text-[10px] leading-snug">
                        {n.text}
                      </span>
                    </button>
                  ))}
              </div>
              <button
                type="button"
                onClick={() => setActiveTab("Notes")}
                className="mt-2 w-full bg-ehr-chrome px-2 py-1 text-[10px] font-semibold text-ehr-chrome-foreground"
              >
                Open Notes
              </button>
            </Panel>
            <Panel title="Alerts & Flags">
              <Row left="Falls risk" right="Moderate" />
              <Row left="Infection control" right="Side room" />
              <Row left="DNACPR" right="Not in place" />
            </Panel>
            <Panel title="Fluid Balance">
              <Row left="Input 24h" right="1450 ml" />
              <Row left="Output 24h" right="1120 ml" />
              <Row left="Balance" right="+330 ml" />
            </Panel>
          </div>

          <div className="space-y-2">
            <Panel title="e-Observations">
              <table className="w-full border-collapse text-[10px]">
                <thead>
                  <tr className="text-ehr-muted">
                    <th className="border border-ehr-line px-1 py-[2px] text-left font-medium">
                      Obs
                    </th>
                    {["06:00", "10:00", "14:00", "18:00", "22:00"].map((h) => (
                      <th key={h} className="border border-ehr-line px-1 py-[2px] font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {obsRows.map((r) => (
                    <tr key={r.label}>
                      <td className="border border-ehr-line px-1 py-[2px] text-left">{r.label}</td>
                      {r.values.map((v, i) => (
                        <td
                          key={i}
                          className="border border-ehr-line px-1 py-[2px] text-center tabular-nums"
                        >
                          {v}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
            <Panel title="Current Medications (EPMA)">
              <Row left="Salbutamol 5mg NEB" right="QDS · due 12:00" />
              <Row left="Prednisolone 30mg PO" right="OD · given 08:10" />
              <Row left="Amoxicillin 500mg PO" right="TDS · due 14:00" />
              <Row left="Enoxaparin 40mg SC" right="ON" />
            </Panel>
            <Panel title="Assessments">
              <Row left="MUST score" right="1 · 04 Jul" />
              <Row left="Waterlow" right="12 · 04 Jul" />
              <Row left="Sepsis screen" right="Negative" />
            </Panel>
          </div>

          <div className="space-y-2">
            <Panel title="Location">
              <Row left="Location" right={current.bay} />
              <Row left="Bed" right={current.bed} />
              <Row left="Admitted" right="05 Jul 2026 10:57" />
              <Row left="NEWS2" right={<span className="font-semibold text-ehr-alert">3</span>} />
            </Panel>
            <Panel title="Care Plans">
              <Row left="COPD exacerbation" right="Active" />
              <Row left="Pressure area care" right="Active" />
              <Row left="Discharge planning" right="Started" />
            </Panel>
            <Panel title="All Tasks">
              <Row left="Repeat obs (NEWS 3)" right="Due 12:00" />
              <Row left="Chase CT chest report" right="Unassigned" />
              <Row left="Physio review" right="Accepted" />
              <Row left="Bloods — U&E" right="Overdue" />
            </Panel>
            <Panel title="Staff">
              <Row left="Consultant" right="Dr R. Duthagray" />
              <Row left="Nurse in charge" right="V. Kilfoy" />
              <Row left="Ward clerk" right="S. Marriott" />
            </Panel>
            <Panel title="Visit History">
              <Row left="ED attendance" right="12 Mar 2026" />
              <Row left="Resp clinic" right="28 Jan 2026" />
              <Row left="Inpatient — COPD" right="09 Nov 2025" />
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}

function sourceLabel(source: CaseNote["source"]) {
  if (source === "scribe") return "Auto-scribed";
  if (source === "agent") return "Ward Threads";
  return null;
}

function splitEntry(text: string) {
  const idx = text.search(/\bPlan\s*:/i);
  if (idx === -1) return { body: text.trim(), plan: null as string | null };
  return {
    body: text.slice(0, idx).trim(),
    plan: text
      .slice(idx)
      .replace(/^\s*Plan\s*:\s*/i, "")
      .trim(),
  };
}

function NotesWorkspace({
  patientId,
  patientName,
  notes,
  ehrDocuments,
  ehrConnected,
  activity,
  onAddNote,
  onDocumentChange,
}: {
  patientId: string;
  patientName: string;
  notes: CaseNote[];
  ehrDocuments: ClinicalDocument[];
  ehrConnected: boolean | null;
  activity: ActivityEntry[];
  onAddNote?: ((doc: DocId, text: string) => void) | undefined;
  onDocumentChange: (document: ClinicalDocument) => void;
}) {
  const [activeDoc, setActiveDoc] = useState<DocId>("medical");
  const [draft, setDraft] = useState("");
  const doc = documents.find((d) => d.id === activeDoc)!;
  const docNotes = notes.filter((n) => n.doc === activeDoc);
  const storedDocuments = ehrDocuments.filter((document) => document.category === activeDoc);
  const plans = docNotes.map((n) => ({ note: n, ...splitEntry(n.text) })).filter((e) => e.plan);
  const latestPlan = plans[plans.length - 1] ?? null;
  const fallback = docNotes[docNotes.length - 1];
  const planText = latestPlan?.plan ?? fallback?.text ?? null;
  const planNote = latestPlan?.note ?? fallback;

  return (
    <div className="mx-auto grid max-w-[1180px] grid-cols-1 gap-3 p-3 lg:grid-cols-[220px_minmax(0,1fr)]">
      <nav className="space-y-1">
        <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-ehr-muted">
          Documents
        </p>
        {documents.map((d) => {
          const count =
            notes.filter((n) => n.doc === d.id).length +
            ehrDocuments.filter((document) => document.category === d.id).length;
          const active = d.id === activeDoc;
          return (
            <button
              key={d.id}
              type="button"
              onClick={() => setActiveDoc(d.id)}
              className={`w-full border px-2 py-2 text-left text-[11px] leading-tight transition-colors ${
                active
                  ? "border-ehr-accent bg-ehr-accent/10 text-ehr-foreground"
                  : "border-ehr-line bg-ehr-panel text-ehr-muted hover:text-ehr-foreground"
              }`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className={active ? "font-semibold" : ""}>{d.title}</span>
                <span className="tabular-nums text-ehr-muted">{count}</span>
              </span>
              <span className="mt-[2px] block text-[10px] text-ehr-muted">{d.subtitle}</span>
            </button>
          );
        })}
      </nav>

      <section className="border border-ehr-line bg-ehr-panel">
        <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-ehr-line bg-ehr-chrome px-3 py-2">
          <span className="text-[12px] font-semibold text-ehr-chrome-foreground">{doc.title}</span>
          <span className="text-[10px] text-ehr-chrome-foreground/70">
            {patientName} · {docNotes.length + storedDocuments.length} items ·{" "}
            {ehrConnected === false ? "demo notes available" : "versioned record connected"}
          </span>
        </header>

        <div className="space-y-3 p-3">
          <div className="space-y-2">
            <h3 className="text-[10px] font-semibold uppercase tracking-wide text-ehr-muted">
              Entries
            </h3>
            {docNotes.length === 0 && (
              <p className="text-[11px] text-ehr-muted">Nothing recorded in this document yet.</p>
            )}
            {docNotes.map((n) => {
              const { body, plan } = splitEntry(n.text);
              const badge = sourceLabel(n.source);
              return (
                <article key={n.id} className="border border-ehr-line bg-ehr-bg">
                  <header className="flex flex-wrap items-center justify-between gap-2 border-b border-ehr-line px-2 py-1 text-[10px] text-ehr-muted">
                    <span className="flex items-center gap-1.5">
                      <span className="font-semibold text-ehr-foreground">{n.author}</span>
                      {badge && (
                        <span className="rounded bg-ehr-accent/15 px-1 text-ehr-accent">
                          {badge}
                        </span>
                      )}
                    </span>
                    <span className="tabular-nums">{n.at}</span>
                  </header>
                  <div className="space-y-1 px-2 py-1.5 text-[11px] leading-snug">
                    {body && <p className="whitespace-pre-line">{body}</p>}
                    {plan && (
                      <p className="whitespace-pre-line">
                        <span className="font-semibold text-ehr-foreground">Plan: </span>
                        {plan}
                      </p>
                    )}
                  </div>
                </article>
              );
            })}
          </div>

          <div className="border border-ehr-accent/40 bg-ehr-accent/5 p-2">
            <h3 className="text-[10px] font-semibold uppercase tracking-wide text-ehr-accent">
              Current plan
            </h3>
            <p className="mt-1 text-[11px] leading-snug text-ehr-foreground">
              {planText ?? "No plan documented in this document yet."}
            </p>
            {planNote && (
              <p className="mt-1 text-[10px] text-ehr-muted">
                {planNote.author} · {planNote.at}
              </p>
            )}
          </div>

          {storedDocuments.length > 0 && (
            <div className="space-y-1.5">
              <h3 className="text-[10px] font-semibold uppercase tracking-wide text-ehr-muted">
                Versioned EHR documents
              </h3>
              {storedDocuments.map((stored) => (
                <article key={stored.documentId} className="border border-ehr-line bg-ehr-bg p-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[10px]">
                    <span className="font-semibold text-ehr-foreground">{stored.title}</span>
                    <span
                      className={
                        stored.status === "filed" ? "text-verified-strong" : "text-pending-strong"
                      }
                    >
                      {stored.status} · v{stored.version}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-4 whitespace-pre-line text-[10px] leading-snug text-ehr-muted">
                    {stored.content}
                  </p>
                  <p className="mt-1 text-[9px] text-ehr-muted">
                    {stored.updatedBy} · {new Date(stored.updatedAt).toLocaleString()}
                  </p>
                </article>
              ))}
            </div>
          )}

          <form
            className="flex gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              const text = draft.trim();
              if (!text) return;
              onAddNote?.(activeDoc, text);
              setDraft("");
            }}
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={`Add an entry to ${doc.title.toLowerCase()}…`}
              className="min-w-0 flex-1 border border-ehr-line bg-ehr-bg px-2 py-1.5 text-[11px] outline-none focus:border-ehr-accent"
            />
            <button
              type="submit"
              className="shrink-0 bg-ehr-chrome px-3 py-1.5 text-[10px] font-semibold text-ehr-chrome-foreground"
            >
              Save entry
            </button>
          </form>

          <RecordClosure
            patientId={patientId}
            category={activeDoc}
            notes={docNotes}
            onDocumentChange={onDocumentChange}
          />

          <div className="border-t border-ehr-line pt-2">
            <h3 className="text-[10px] font-semibold uppercase tracking-wide text-ehr-muted">
              Activity feed
            </h3>
            <ol className="mt-1.5 space-y-1.5">
              {activity.length === 0 && (
                <li className="text-[11px] text-ehr-muted">
                  No tracked activity for this patient.
                </li>
              )}
              {activity.map((a) => (
                <li key={a.id} className="flex gap-2 text-[11px] leading-snug">
                  <span className="w-10 shrink-0 tabular-nums text-ehr-muted">{a.at}</span>
                  <span className="min-w-0">
                    <span className="text-ehr-foreground">{a.text}</span>{" "}
                    <span className="text-ehr-muted">— {a.actor}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>
    </div>
  );
}

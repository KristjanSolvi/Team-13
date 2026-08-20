import { useState } from "react";
import type { CaseNote, DocId, Patient } from "@/data/ward";
import { documents, patients } from "@/data/ward";

const tabs = [
  "Summary",
  "Obs",
  "Assessments",
  "Investigations",
  "Procedures",
  "Fluids",
  "Charts",
  "Case Notes",
  "Discharge",
  "Primary Care",
  "Patient App",
];

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

function Row({ left, right }: { left: string; right?: string }) {
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
};

export function NervecentreShell({ patient, onSelectPatient, notes = [], onAddNote }: ShellProps) {
  const current = patient ?? patients[0]!;
  const [activeTab, setActiveTab] = useState("Obs");
  const [activeDoc, setActiveDoc] = useState<DocId>("ward-round");
  const [draft, setDraft] = useState("");
  const doc = documents.find((d) => d.id === activeDoc)!;
  const docNotes = notes.filter((n) => n.doc === activeDoc);
  return (
    <div className="min-h-screen bg-ehr-bg text-ehr-foreground">
      <div className="flex items-center justify-between bg-ehr-chrome px-3 py-1.5">
        <div className="flex items-center gap-6">
          <span className="text-[13px] font-semibold lowercase tracking-tight text-ehr-chrome-foreground">
            nervecentre
          </span>
          <nav className="hidden gap-4 text-[11px] text-ehr-chrome-foreground/80 md:flex">
            {[
              "Home",
              "Patient List",
              "Bed Board",
              "All Tasks",
              "e-Observations",
              "EPMA",
              "Orders",
              "Handover",
              "Flow",
              "Search",
            ].map((i) => (
              <button key={i} type="button" className="hover:text-ehr-chrome-foreground">
                {i}
              </button>
            ))}
          </nav>
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
        <div className="flex gap-4 text-[11px] text-ehr-muted">
          <span>Admitted 05 Jul 2026 10:57</span>
          <span>
            Bed {current.bed} · {current.bay}
          </span>
          <span className="font-semibold text-ehr-alert">NEWS2 3</span>
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

      <div className="grid grid-cols-1 gap-2 p-2 lg:grid-cols-[1fr_1.6fr_1fr]">
        <div className="space-y-2">
          <Panel title="ED Clinical">
            <Row left="Triage category" right="Amber" />
            <Row left="Presenting complaint" right="Breathlessness" />
            <Row left="Allergies" right="Penicillin" />
            <Row left="Comorbidities" right="COPD, T2DM" />
            <Row left="Management plan" right="Nebs + steroids" />
            <Row left="Diagnosis" right="Infective exacerbation" />
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
          <Panel title="Clinical Documents">
            <div className="mb-2 flex gap-1">
              {documents.map((d) => {
                const count = notes.filter((n) => n.doc === d.id).length;
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => setActiveDoc(d.id)}
                    className={`flex-1 border px-1.5 py-1 text-[10px] leading-tight ${
                      d.id === activeDoc
                        ? "border-ehr-accent bg-ehr-accent/10 font-semibold text-ehr-foreground"
                        : "border-ehr-line text-ehr-muted hover:text-ehr-foreground"
                    }`}
                  >
                    {d.title}
                    <span className="ml-1 text-ehr-muted">{count}</span>
                  </button>
                );
              })}
            </div>
            <p className="mb-1 text-[10px] text-ehr-muted">
              {doc.subtitle} · {current.name} · updated live by Ward Threads
            </p>
            <div className="max-h-72 space-y-2 overflow-y-auto border border-ehr-line bg-ehr-bg p-2">
              {docNotes.length === 0 && (
                <p className="text-ehr-muted">Nothing recorded in this document yet.</p>
              )}
              {docNotes.map((n) => (
                <article
                  key={n.id}
                  className={`border-l-2 pl-2 ${
                    n.source === "clinician" ? "border-ehr-line" : "border-ehr-accent"
                  }`}
                >
                  <header className="flex justify-between gap-2 text-[10px] text-ehr-muted">
                    <span>
                      {n.author}
                      {n.source !== "clinician" && (
                        <span className="ml-1 rounded bg-ehr-accent/15 px-1 text-ehr-accent">
                          {n.source === "scribe" ? "Auto-scribed" : "Ward Threads"}
                        </span>
                      )}
                    </span>
                    <span>{n.at}</span>
                  </header>
                  <p className="mt-[2px] whitespace-pre-line leading-snug">{n.text}</p>
                </article>
              ))}
            </div>
            <form
              className="mt-2 flex gap-1"
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
                placeholder={`Add to ${doc.title.toLowerCase()}…`}
                className="min-w-0 flex-1 border border-ehr-line bg-ehr-bg px-1.5 py-1 text-[11px] outline-none focus:border-ehr-accent"
              />
              <button
                type="submit"
                className="shrink-0 bg-ehr-chrome px-2 py-1 text-[10px] font-semibold text-ehr-chrome-foreground"
              >
                Save
              </button>
            </form>
          </Panel>
        </div>
      </div>
    </div>
  );
}

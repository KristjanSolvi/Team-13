import type { CaseNote, Patient, Thread } from "@/data/ward";
import { bays, patients } from "@/data/ward";

type Props = {
  threads: Thread[];
  notes?: Record<string, CaseNote[]>;
  onOpenThread: (threadId: string) => void;
  onOpenPatient: (patientId: string) => void;
  activePatientId?: string | null;
};

function isDueTodayOrOverdue(due: string) {
  const d = due.toLowerCase();
  return d.startsWith("today") || d.startsWith("yesterday");
}

function dueStyle(due: string) {
  if (due.toLowerCase().startsWith("yesterday")) {
    return "bg-escalated-soft text-escalated-strong";
  }
  return "bg-tracking-soft text-tracking-strong";
}

export function WardBoard({ threads, notes, onOpenPatient, onOpenThread, activePatientId }: Props) {
  const latestPlanFor = (p: Patient) => {
    const list = notes?.[p.id] ?? [];
    const candidates = list.filter((n) => n.doc === "medical");
    const note = (candidates.length ? candidates : list).at(-1);
    return note ? { text: note.text, at: note.at } : null;
  };
  const openThreadsFor = (p: Patient) =>
    threads.filter(
      (t) => t.patientId === p.id && t.status !== "verified" && isDueTodayOrOverdue(t.due),
    );

  return (
    <div className="space-y-12">
      {bays.map((bay) => (
        <section key={bay.id}>
          <h2 className="mb-6 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            {bay.name}
          </h2>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
            {bay.beds.map((slot) => {
              const patient = patients.find((p) => p.id === slot.patientId) ?? null;
              if (!patient) {
                return (
                  <div
                    key={slot.bed}
                    className="flex items-center justify-center rounded-xl border-2 border-dotted border-border p-5"
                  >
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground/60">
                      Empty bed {slot.bed}
                    </span>
                  </div>
                );
              }
              const open = openThreadsFor(patient);
              return (
                <article
                  key={slot.bed}
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpenPatient(patient.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onOpenPatient(patient.id);
                    }
                  }}
                  className={`cursor-pointer rounded-xl border bg-panel p-5 text-left shadow-sm transition-colors hover:border-tracking/40 hover:shadow-md ${
                    activePatientId === patient.id
                      ? "border-tracking/60 ring-1 ring-tracking/30"
                      : "border-border"
                  }`}
                >
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <h3 className="text-[17px] font-medium leading-tight text-foreground">
                      {patient.name}
                    </h3>
                    <span className="mt-0.5 shrink-0 text-[10px] font-medium text-muted-foreground">
                      Bed {patient.bed}
                    </span>
                  </div>

                  {(() => {
                    const plan = latestPlanFor(patient);
                    return plan ? (
                      <p className="mb-2 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                        <span className="font-medium text-foreground/80">Latest plan:</span>{" "}
                        {plan.text}
                      </p>
                    ) : null;
                  })()}

                  {open.length > 0 ? (
                    <div className="space-y-1">
                      {open.map((t) => (
                        <button
                          key={t.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenThread(t.id);
                          }}
                          className={`flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-[11px] transition-opacity hover:opacity-80 ${dueStyle(t.due)}`}
                        >
                          <span className="truncate">{t.title}</span>
                          <span className="shrink-0 pl-2 opacity-90">{t.due}</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] font-medium italic text-muted-foreground">
                      Clear for discharge
                    </p>
                  )}

                  <dl className="mt-3 space-y-1 border-t border-border pt-2 text-[11px] text-muted-foreground">
                    {patient.homeTomorrow && (
                      <div className="flex justify-between gap-3">
                        <dt>Estimate date of discharge</dt>
                        <dd className="text-right font-medium text-foreground">Tomorrow</dd>
                      </div>
                    )}
                  </dl>
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

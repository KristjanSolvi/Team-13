type Props = {
  text: string;
  label?: string;
  timestamp?: string;
};

export function LiveInterimText({ text, label = "Corti is hearing", timestamp }: Props) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="rounded-lg border border-teal/20 bg-tracking-soft/35 px-3 py-2.5"
    >
      <span className="mb-1 flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-wide text-teal">
        <span className="size-1.5 animate-pulse rounded-full bg-teal" aria-hidden="true" />
        {label}
      </span>
      <p className="text-[13px] leading-relaxed">
        {timestamp !== undefined && (
          <span className="mr-2 text-[11.5px] tabular-nums text-muted-foreground">{timestamp}</span>
        )}
        <span className="transcript-ghost">{text}</span>
        <span
          className="transcript-caret ml-0.5 inline-block h-[1em] w-px bg-teal align-[-0.1em]"
          aria-hidden="true"
        />
      </p>
    </div>
  );
}

import { Check, ShieldCheck } from "lucide-react";
import type { TranscriptReviewSuggestion } from "@pipeline/contracts.js";

export type TranscriptReviewDecision = "keep" | "use-suggestion";

type Props = {
  suggestions: TranscriptReviewSuggestion[];
  decisions: Record<string, TranscriptReviewDecision>;
  onDecision: (suggestion: TranscriptReviewSuggestion, decision: TranscriptReviewDecision) => void;
};

export function TranscriptReviewPanel({ suggestions, decisions, onDecision }: Props) {
  if (suggestions.length === 0) return null;

  return (
    <section
      aria-label="Transcript wording review"
      className="space-y-2 border-t border-border px-4 py-3"
    >
      <div className="flex items-start gap-2">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-teal" />
        <div>
          <h3 className="text-[13px] font-medium text-foreground">
            Check {suggestions.length === 1 ? "this phrase" : "these phrases"}
          </h3>
          <p className="text-[11.5px] text-muted-foreground">
            Corti found possible wording mismatches. Nothing changes without your choice.
          </p>
        </div>
      </div>

      {suggestions.map((suggestion) => {
        const decision = decisions[suggestion.suggestionId];
        return (
          <article
            key={suggestion.suggestionId}
            className="rounded-lg border border-teal/20 bg-tracking-soft/25 p-3"
          >
            <p className="text-[13px] leading-relaxed text-foreground">
              Did they actually say <strong>“{suggestion.originalText}”</strong>, or did they mean{" "}
              <strong>“{suggestion.suggestedText}”</strong>?
            </p>
            <p className="mt-1 text-[11.5px] text-muted-foreground">{suggestion.reason}</p>

            {decision === undefined ? (
              <div className="mt-2.5 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onDecision(suggestion, "keep")}
                  className="rounded-md border border-border bg-panel px-2.5 py-1.5 text-[11.5px] font-medium text-foreground hover:bg-background"
                >
                  Keep “{suggestion.originalText}”
                </button>
                <button
                  type="button"
                  onClick={() => onDecision(suggestion, "use-suggestion")}
                  className="rounded-md bg-teal px-2.5 py-1.5 text-[11.5px] font-medium text-panel hover:opacity-90"
                >
                  Use “{suggestion.suggestedText}”
                </button>
              </div>
            ) : (
              <p
                role="status"
                className="mt-2 flex items-center gap-1.5 text-[11.5px] font-medium text-teal"
              >
                <Check className="size-3.5" />
                {decision === "keep"
                  ? `Original wording kept: “${suggestion.originalText}”`
                  : `Suggested interpretation confirmed: “${suggestion.suggestedText}”`}
              </p>
            )}
          </article>
        );
      })}

      <p className="text-[10.5px] text-muted-foreground">
        The raw Corti transcript remains unchanged for traceability.
      </p>
    </section>
  );
}

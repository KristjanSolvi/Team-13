import { Sparkles } from "lucide-react";

export function FloatingLauncher({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      data-ward-threads-launcher="true"
      aria-label={open ? "Close Fluence" : "Open Fluence"}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      className="liquid-glass-subtle fixed right-6 top-8 z-50 flex cursor-pointer items-center gap-0.5 rounded-full border border-teal/20 bg-white/70 py-1.5 pl-1.5 pr-3 text-sm font-medium text-foreground shadow-lg backdrop-blur-xl transition-all hover:-translate-y-0.5 hover:bg-white/90 hover:shadow-xl active:scale-95"
    >
      <span className="flex items-center gap-0">
        <span className="flex size-12 items-center justify-center">
          <span className="flex size-9 items-center justify-center rounded-full border border-teal/20 bg-teal/10">
            <Sparkles className="size-4 text-teal" aria-hidden="true" />
          </span>
        </span>
        <span className="text-[14px] font-semibold text-foreground">Fluence</span>
      </span>
    </button>
  );
}

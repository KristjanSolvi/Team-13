import { Sparkles } from "lucide-react";

export function FloatingLauncher({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="liquid-glass-subtle liquid-press fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-full py-2.5 pl-3 pr-4 text-sm font-medium text-foreground hover:-translate-y-0.5"
    >
      <span className="relative flex size-7 items-center justify-center rounded-full bg-teal/10">
        <Sparkles className="size-4 text-teal" />
        <span className="absolute -right-0.5 -top-0.5 size-2 animate-pulse rounded-full bg-pending" />
      </span>
      Ward Threads
      <kbd className="liquid-glass-track rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
        ⇧ ⇧
      </kbd>
    </button>
  );
}

import { Sparkles } from "lucide-react";
import { useRef } from "react";

export function FloatingLauncher({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openedByHover = useRef(false);

  const clearHoverTimer = () => {
    if (hoverTimer.current !== null) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  };

  const handlePointerEnter = () => {
    if (open || hoverTimer.current !== null) return;
    hoverTimer.current = setTimeout(() => {
      openedByHover.current = true;
      hoverTimer.current = null;
      onToggle();
    }, 150);
  };

  const handlePointerLeave = () => {
    clearHoverTimer();
    openedByHover.current = false;
  };

  const handleClick = () => {
    clearHoverTimer();
    if (openedByHover.current) {
      openedByHover.current = false;
      return;
    }
    onToggle();
  };

  return (
    <button
      type="button"
      data-ward-launcher
      aria-expanded={open}
      aria-label={open ? "Hide Ward Threads" : "Open Ward Threads"}
      onClick={handleClick}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      className="liquid-glass-subtle liquid-press fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-full py-2.5 pl-3 pr-4 text-sm font-medium text-foreground hover:-translate-y-0.5"
    >
      {open ? (
        <span className="flex items-center gap-2">
          <span className="relative flex size-5 items-center justify-center rounded-full bg-teal/10">
            <Sparkles className="size-3.5 text-teal" />
            <span className="absolute -right-0.5 -top-0.5 size-1.5 animate-pulse rounded-full bg-pending" />
          </span>
          <span className="text-xs">Ward Threads</span>
        </span>
      ) : (
        <>
          <span className="relative flex size-7 items-center justify-center rounded-full bg-teal/10">
            <Sparkles className="size-4 text-teal" />
            <span className="absolute -right-0.5 -top-0.5 size-2 animate-pulse rounded-full bg-pending" />
          </span>
          Ward Threads
          <kbd className="liquid-glass-track rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
            ⇧ ⇧
          </kbd>
        </>
      )}
    </button>
  );
}

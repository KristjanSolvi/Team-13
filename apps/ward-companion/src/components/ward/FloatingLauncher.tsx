import { Maximize2, Minimize2, Sparkles, X } from "lucide-react";
import { useRef } from "react";

type Props = {
  open: boolean;
  maximized: boolean;
  onToggle: () => void;
  onMaximize: () => void;
  onClose: () => void;
};

export function FloatingLauncher({ open, maximized, onToggle, onMaximize, onClose }: Props) {
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openedByHover = useRef(false);
  const suppressHoverUntilLeave = useRef(false);

  const clearHoverTimer = () => {
    if (hoverTimer.current !== null) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  };

  const handlePointerEnter = () => {
    if (open || suppressHoverUntilLeave.current || hoverTimer.current !== null) return;
    hoverTimer.current = setTimeout(() => {
      openedByHover.current = true;
      hoverTimer.current = null;
      onToggle();
    }, 150);
  };

  const handlePointerLeave = () => {
    clearHoverTimer();
    openedByHover.current = false;
    suppressHoverUntilLeave.current = false;
  };

  const handleClick = () => {
    clearHoverTimer();
    if (openedByHover.current) {
      openedByHover.current = false;
      return;
    }
    onToggle();
  };

  const handleClose = () => {
    clearHoverTimer();
    suppressHoverUntilLeave.current = true;
    onClose();
  };

  return (
    <div
      data-ward-launcher
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      className="liquid-glass-subtle fixed right-6 top-8 z-50 flex items-center gap-1.5 rounded-full py-2 pl-2 pr-4 text-sm font-medium text-foreground transition-transform hover:-translate-y-0.5"
    >
      {open && (
        <>
          <button
            type="button"
            onClick={onMaximize}
            aria-label={maximized ? "Restore panel size" : "Maximise panel"}
            title={maximized ? "Restore panel size" : "Maximise panel"}
            className="flex size-7 items-center justify-center rounded-full border border-white/40 bg-white/50 text-foreground shadow-sm transition-all hover:bg-white/80 active:scale-95"
          >
            {maximized ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
          </button>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Hide panel"
            title="Hide panel"
            className="flex size-7 items-center justify-center rounded-full border border-white/40 bg-white/50 text-foreground shadow-sm transition-all hover:bg-white/80 active:scale-95"
          >
            <X className="size-3.5" />
          </button>
        </>
      )}
      {open ? (
        <span className="flex items-center gap-2">
          <span className="relative flex size-5 items-center justify-center rounded-full bg-teal/10">
            <Sparkles className="size-3.5 text-teal" />
            <span className="absolute -right-0.5 -top-0.5 size-1.5 animate-pulse rounded-full bg-pending" />
          </span>
          <span className="text-xs underline decoration-teal/40 underline-offset-2">
            Ward Threads
          </span>
        </span>
      ) : (
        <button
          type="button"
          aria-expanded={false}
          aria-label="Open Ward Threads"
          onClick={handleClick}
          className="liquid-press flex items-center gap-3"
        >
          <span className="relative flex size-7 items-center justify-center rounded-full bg-teal/10">
            <Sparkles className="size-4 text-teal" />
            <span className="absolute -right-0.5 -top-0.5 size-2 animate-pulse rounded-full bg-pending" />
          </span>
          <span className="underline decoration-teal/40 underline-offset-2">Ward Threads</span>
          <kbd className="liquid-glass-track rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
            ⇧ ⇧
          </kbd>
        </button>
      )}
    </div>
  );
}

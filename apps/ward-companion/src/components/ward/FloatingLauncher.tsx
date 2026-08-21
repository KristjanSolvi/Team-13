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
      className="liquid-glass-subtle fluence-launcher-glass fixed right-6 top-8 z-50 flex cursor-pointer items-center gap-0.5 rounded-full border py-1.5 pl-1.5 pr-3 text-sm font-medium text-foreground transition-all hover:-translate-y-0.5 hover:brightness-[1.03] hover:saturate-[1.12] active:scale-95"
    >
      <span className="flex items-center gap-0">
        <span className="flex size-12 items-center justify-center">
          <span className="flex size-9 items-center justify-center rounded-full border border-white/75 bg-white/35 shadow-[0_1px_0_rgba(255,255,255,0.9)_inset] backdrop-blur-sm">
            <img
              src="/corti-hack-logo.png"
              alt=""
              aria-hidden="true"
              className="size-6 object-contain"
            />
          </span>
        </span>
        <span className="text-[14px] font-semibold text-foreground">Fluence</span>
      </span>
    </button>
  );
}

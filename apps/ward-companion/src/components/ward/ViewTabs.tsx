import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { BarChart3, LayoutGrid, ListChecks, Users } from "lucide-react";

export type ViewKey = "board" | "activity" | "insights" | "demo";

const TABS = [
  { key: "activity", label: "Main", Icon: ListChecks },
  { key: "board", label: "Board ward", Icon: LayoutGrid },
  { key: "insights", label: "Insights", Icon: BarChart3 },
  { key: "demo", label: "Demo", Icon: Users },
] as const;

export function ViewTabs({ value, onChange }: { value: ViewKey; onChange: (v: ViewKey) => void }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [rect, setRect] = useState<{ left: number; width: number } | null>(null);
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    const measure = () => {
      const el = refs.current[value];
      const track = trackRef.current;
      if (!el || !track) return;
      setRect({
        left: el.offsetLeft,
        width: el.offsetWidth,
      });
    };
    measure();
    const raf = requestAnimationFrame(() => setReady(true));
    const ro = new ResizeObserver(measure);
    if (trackRef.current) ro.observe(trackRef.current);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [value]);

  useEffect(() => {
    const t = setTimeout(() => setReady(true), 120);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      ref={trackRef}
      role="tablist"
      aria-label="Fluence views"
      className="liquid-glass-track relative flex items-center gap-1 rounded-full p-1"
    >
      {rect && (
        <span
          aria-hidden
          className="liquid-glass-pill pointer-events-none absolute inset-y-1 rounded-full"
          style={{
            left: rect.left,
            width: rect.width,
            transition: ready
              ? "left 380ms cubic-bezier(0.22, 1, 0.36, 1), width 380ms cubic-bezier(0.22, 1, 0.36, 1)"
              : undefined,
          }}
        />
      )}
      {TABS.map(({ key, label, Icon }) => {
        const active = value === key;
        return (
          <button
            key={key}
            ref={(el) => {
              refs.current[key] = el;
            }}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(key)}
            className={`liquid-press relative z-10 flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors duration-200 ${
              active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon
              className={`size-3.5 transition-opacity duration-200 ${active ? "opacity-100" : "opacity-70"}`}
            />
            {label}
          </button>
        );
      })}
    </div>
  );
}

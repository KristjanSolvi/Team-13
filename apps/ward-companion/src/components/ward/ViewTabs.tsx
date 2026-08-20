import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { BarChart3, LayoutGrid, ListChecks } from "lucide-react";

export type ViewKey = "board" | "activity" | "insights";

const tabs = [
  { key: "board", label: "Ward board", Icon: LayoutGrid },
  { key: "activity", label: "Activity", Icon: ListChecks },
  { key: "insights", label: "Insights", Icon: BarChart3 },
] as const;

export function ViewTabs({
  value,
  onChange,
}: {
  value: ViewKey;
  onChange: (value: ViewKey) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [rect, setRect] = useState<{ left: number; width: number } | null>(null);
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    const measure = () => {
      const tab = tabRefs.current[value];
      const track = trackRef.current;
      if (!tab || !track) return;
      setRect({ left: tab.offsetLeft, width: tab.offsetWidth });
    };
    measure();
    const frame = requestAnimationFrame(() => setReady(true));
    const observer = new ResizeObserver(measure);
    if (trackRef.current) observer.observe(trackRef.current);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [value]);

  useEffect(() => {
    const timer = setTimeout(() => setReady(true), 120);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div
      ref={trackRef}
      role="tablist"
      aria-label="Ward Threads views"
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
      {tabs.map(({ key, label, Icon }) => {
        const active = value === key;
        return (
          <button
            key={key}
            ref={(element) => {
              tabRefs.current[key] = element;
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

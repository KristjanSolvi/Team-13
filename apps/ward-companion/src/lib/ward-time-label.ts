const backendTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u;
const wardTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "UTC",
});

export function wardTimestampLabel(value: string): string {
  if (!backendTimestamp.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const parts = new Map(
    wardTimeFormatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return `${parts.get("day")} ${parts.get("month")} · ${parts.get("hour")}:${parts.get("minute")}`;
}

export function memberLabel(memberId: string): string {
  return memberId
    .split(/[-_:]+/u)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

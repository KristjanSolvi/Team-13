const CORTI_ENCOUNTER_IDENTIFIER_MAX_LENGTH = 120;

export function wardMeetingEncounterIdentifier(correlationId: string): string {
  const identifier = `ward-meeting-${correlationId}`;
  if (identifier.length > CORTI_ENCOUNTER_IDENTIFIER_MAX_LENGTH) {
    throw new Error("The ward-meeting correlation ID is too long for a Corti encounter.");
  }
  return identifier;
}

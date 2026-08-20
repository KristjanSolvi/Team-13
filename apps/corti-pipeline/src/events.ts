import type {
  PipelineEvent,
  PipelineEventMap,
  PipelineEventType,
} from "./contracts.js";

export function pipelineEvent<TType extends PipelineEventType>(input: {
  type: TType;
  correlationId: string;
  interactionId?: string;
  payload: PipelineEventMap[TType];
  occurredAt?: Date;
  eventId?: string;
}): PipelineEvent<TType> {
  const base = {
    type: input.type,
    schemaVersion: "1" as const,
    eventId: input.eventId ?? `evt_${globalThis.crypto.randomUUID()}`,
    occurredAt: (input.occurredAt ?? new Date()).toISOString(),
    correlationId: input.correlationId,
    payload: input.payload,
  };

  return input.interactionId === undefined
    ? base
    : { ...base, interactionId: input.interactionId };
}

/**
 * Something that happened, stated in the past tense. Events are how one module
 * tells another that the world changed without either one importing the other.
 * They are written to the outbox inside the same transaction as the change, so
 * a delivered event always corresponds to committed data.
 */
export interface DomainEvent<TName extends string = string, TPayload = unknown> {
  readonly name: TName;
  readonly aggregateId: string;
  readonly occurredAt: Date;
  readonly payload: TPayload;
}

export function domainEvent<TName extends string, TPayload>(
  name: TName,
  aggregateId: string,
  occurredAt: Date,
  payload: TPayload,
): DomainEvent<TName, TPayload> {
  return { name, aggregateId, occurredAt, payload };
}

export interface EventPublisher {
  publish(events: readonly DomainEvent[]): Promise<void>;
}

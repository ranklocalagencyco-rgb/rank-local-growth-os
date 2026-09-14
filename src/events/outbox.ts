export type DomainEvent = {
  id: string;
  workspaceId: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  occurredAt: string;
  publishedAt?: string;
  attempts: number;
};

export class InMemoryOutbox {
  private readonly events: DomainEvent[] = [];
  private readonly keys = new Set<string>();

  append(input: Omit<DomainEvent, "id" | "occurredAt" | "attempts"> & { idempotencyKey: string }): DomainEvent {
    const existing = this.events.find((event) => event.id === input.idempotencyKey);
    if (existing) return existing;

    const event: DomainEvent = {
      id: input.idempotencyKey,
      workspaceId: input.workspaceId,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      eventType: input.eventType,
      payload: input.payload,
      occurredAt: new Date().toISOString(),
      attempts: 0,
      publishedAt: input.publishedAt,
    };
    this.events.push(event);
    this.keys.add(input.idempotencyKey);
    return event;
  }

  async publish(publisher: (event: DomainEvent) => Promise<void>): Promise<number> {
    let published = 0;
    for (const event of this.events.filter((candidate) => !candidate.publishedAt)) {
      event.attempts += 1;
      await publisher(event);
      event.publishedAt = new Date().toISOString();
      published += 1;
    }
    return published;
  }

  all(): readonly DomainEvent[] {
    return this.events;
  }
}

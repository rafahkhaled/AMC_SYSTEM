import type { OutboxReader, OutboxRecord } from '@amc/audit';
import { domainEvent } from '@amc/kernel';
import { describe, expect, it } from 'vitest';
import { OutboxPublisher } from './outbox-publisher.js';

class FakeOutbox implements OutboxReader {
  published: string[] = [];
  failures: { id: string; error: string }[] = [];

  constructor(private records: OutboxRecord[]) {}

  async pending(limit: number): Promise<OutboxRecord[]> {
    return this.records.filter((record) => !this.published.includes(record.id)).slice(0, limit);
  }

  async markPublished(ids: readonly string[]): Promise<void> {
    this.published.push(...ids);
  }

  async markFailed(id: string, error: string): Promise<void> {
    this.failures.push({ id, error });
  }
}

function record(id: string, name: string): OutboxRecord {
  return {
    id,
    attempts: 0,
    event: domainEvent(name, `aggregate-${id}`, new Date('2026-09-15T06:00:00Z'), { id }),
  };
}

const clock = { now: () => new Date('2026-09-15T06:00:00Z') };

describe('the outbox publisher', () => {
  it('delivers an event to the subscriber that asked for it by name', async () => {
    const seen: string[] = [];
    const outbox = new FakeOutbox([record('1', 'identity.session.started')]);
    const publisher = new OutboxPublisher(outbox, clock, 10).on(
      'identity.session.started',
      async (event) => {
        seen.push(event.name);
      },
    );

    expect(await publisher.drain()).toBe(1);
    expect(seen).toEqual(['identity.session.started']);
    expect(outbox.published).toEqual(['1']);
  });

  it('delivers to a prefix subscriber, so a module can listen to a whole area', async () => {
    const seen: string[] = [];
    const outbox = new FakeOutbox([
      record('1', 'identity.session.started'),
      record('2', 'billing.invoice.issued'),
    ]);
    const publisher = new OutboxPublisher(outbox, clock, 10).on('identity.', async (event) => {
      seen.push(event.name);
    });

    await publisher.drain();
    expect(seen).toEqual(['identity.session.started']);
  });

  it('marks an event nobody listens to as delivered, so the table does not grow for ever', async () => {
    const outbox = new FakeOutbox([record('1', 'nobody.cares.about.this')]);
    const publisher = new OutboxPublisher(outbox, clock, 10);

    expect(await publisher.drain()).toBe(1);
    expect(outbox.published).toEqual(['1']);
  });

  it('leaves a failed event unpublished with its error, and carries on with the rest', async () => {
    const delivered: string[] = [];
    const outbox = new FakeOutbox([record('1', 'a.b.c'), record('2', 'a.b.c')]);
    const publisher = new OutboxPublisher(outbox, clock, 10).on('a.', async (event) => {
      if ((event.payload as { id: string }).id === '1') throw new Error('subscriber blew up');
      delivered.push((event.payload as { id: string }).id);
    });

    await publisher.drain();

    expect(delivered).toEqual(['2']);
    expect(outbox.published).toEqual(['2']);
    expect(outbox.failures).toEqual([{ id: '1', error: 'subscriber blew up' }]);
  });

  it('gives every matching subscriber the event', async () => {
    let count = 0;
    const outbox = new FakeOutbox([record('1', 'identity.session.started')]);
    const publisher = new OutboxPublisher(outbox, clock, 10)
      .on('identity.session.started', async () => {
        count += 1;
      })
      .on('identity.', async () => {
        count += 1;
      });

    await publisher.drain();
    expect(count).toBe(2);
  });

  it('does nothing, cheaply, when there is nothing to do', async () => {
    expect(await new OutboxPublisher(new FakeOutbox([]), clock, 10).drain()).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import { AggregateRoot } from './aggregate-root.js';
import { domainEvent } from './domain-event.js';

class Task extends AggregateRoot<string> {
  // The base constructor is protected on purpose, so a subclass must widen it.
  // biome-ignore lint/complexity/noUselessConstructor: widens protected to public
  constructor(id: string) {
    super(id);
  }

  complete(at: Date): void {
    this.record(domainEvent('task.completed', this.id, at, { taskId: this.id }));
  }
}

describe('AggregateRoot', () => {
  it('records events and hands them over exactly once', () => {
    const task = new Task('task-1');
    task.complete(new Date('2026-09-14T10:00:00Z'));

    expect(task.hasPendingEvents).toBe(true);
    const first = task.pullEvents();
    expect(first.map((event) => event.name)).toEqual(['task.completed']);

    // Draining is what stops an event being published twice.
    expect(task.pullEvents()).toEqual([]);
    expect(task.hasPendingEvents).toBe(false);
  });
});

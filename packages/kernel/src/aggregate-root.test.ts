import { describe, expect, it } from 'vitest';
import { AggregateRoot } from './aggregate-root.js';
import { domainEvent } from './domain-event.js';

class Project extends AggregateRoot<string> {
  // The base constructor is protected on purpose, so a subclass must widen it.
  // biome-ignore lint/complexity/noUselessConstructor: widens protected to public
  constructor(id: string) {
    super(id);
  }

  complete(at: Date): void {
    this.record(domainEvent('project.completed', this.id, at, { projectId: this.id }));
  }
}

describe('AggregateRoot', () => {
  it('records events and hands them over exactly once', () => {
    const project = new Project('project-1');
    project.complete(new Date('2026-09-14T10:00:00Z'));

    expect(project.hasPendingEvents).toBe(true);
    const first = project.pullEvents();
    expect(first.map((event) => event.name)).toEqual(['project.completed']);

    // Draining is what stops an event being published twice.
    expect(project.pullEvents()).toEqual([]);
    expect(project.hasPendingEvents).toBe(false);
  });
});

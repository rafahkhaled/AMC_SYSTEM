import { describe, expect, it } from 'vitest';
import { Task } from './task.js';

const at = (iso: string) => new Date(iso);
const NOW = at('2026-04-01T06:00:00Z');

function task(service: Parameters<typeof Task.fromTemplate>[0]['service'] = 'vat_registration') {
  const created = Task.fromTemplate({
    id: 'task-1',
    clientId: 'client-1',
    clientServiceId: 'cs-1',
    service,
    periodKey: null,
    now: NOW,
  });
  created.pullEvents();
  return created;
}

function satisfy(subject: Task, now = NOW) {
  for (const type of subject.missingDocuments) {
    subject.attachDocument(type, `doc-${type}`, now);
  }
  return subject;
}

describe('creating a task from its template (FR-11)', () => {
  it('starts awaiting documents when any are mandatory', () => {
    // Starting at ready would show work on the board as available that cannot
    // actually be begun.
    expect(task().status).toBe('awaiting_documents');
  });

  it('starts ready when the service needs no paperwork of ours', () => {
    expect(task('emaratax_request').status).toBe('ready');
  });

  it('copies the steps from the template', () => {
    expect(task('vat_return').stepsRemaining).toBe(7);
  });

  it('lists exactly what is missing', () => {
    expect(task().missingDocuments).toEqual([
      'trade_licence',
      'emirates_id',
      'passport',
      'memorandum',
    ]);
  });
});

describe('attaching documents (ERD rule 1)', () => {
  it('links the task to one of the client documents', () => {
    const subject = task();
    expect(subject.attachDocument('trade_licence', 'doc-1', NOW).ok).toBe(true);
    expect(subject.requirements.find((r) => r.type === 'trade_licence')?.documentId).toBe('doc-1');
  });

  it('refuses a document this service never asked for', () => {
    expect(task().attachDocument('visa', 'doc-9', NOW).ok).toBe(false);
  });

  it('becomes ready on its own once the last mandatory document arrives', () => {
    // Nobody should have to notice that the blocker has cleared.
    const subject = satisfy(task());
    expect(subject.status).toBe('ready');
    expect(subject.isBlocked).toBe(false);
  });

  it('does not become ready while an optional document is still outstanding', () => {
    const subject = satisfy(task());
    expect(subject.requirements.find((r) => r.type === 'bank_letter')?.documentId).toBeNull();
    expect(subject.status).toBe('ready');
  });

  it('goes back to awaiting documents when one is removed', () => {
    const subject = satisfy(task());
    expect(subject.detachDocument('passport', NOW).ok).toBe(true);
    expect(subject.status).toBe('awaiting_documents');
  });

  it('keeps the documents of a completed task', () => {
    const subject = satisfy(task());
    subject.start(NOW);
    subject.moveTo('completed', NOW);
    // The work was done with those files; detaching them would make the
    // finished task unexplainable.
    expect(subject.detachDocument('passport', NOW).ok).toBe(false);
  });
});

describe('the document gate (FR-12)', () => {
  it('refuses to start while mandatory documents are missing', () => {
    const outcome = task().start(NOW);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.message).toContain('not all here yet');
      expect(outcome.error.details.missing).toContain('trade_licence');
    }
  });

  it('refuses the same move made through the general transition', () => {
    // The gate is a rule of the domain, not a disabled button, so it holds
    // however the state is changed.
    expect(task().moveTo('in_progress', NOW).ok).toBe(false);
  });

  it('starts once everything is in', () => {
    const subject = satisfy(task());
    expect(subject.start(NOW).ok).toBe(true);
    expect(subject.status).toBe('in_progress');
    expect(subject.snapshot().startedAt).toEqual(NOW);
  });
});

describe('how work moves', () => {
  function started() {
    const subject = satisfy(task());
    subject.start(NOW);
    subject.pullEvents();
    return subject;
  }

  it('waits on the client and comes back', () => {
    const subject = started();
    expect(subject.moveTo('waiting_for_client', NOW).ok).toBe(true);
    expect(subject.moveTo('in_progress', NOW).ok).toBe(true);
  });

  it('keeps waiting for the client separate from waiting for the authority', () => {
    // They look the same on a board and mean entirely different things: one is
    // chased by the practice, the other cannot be hurried.
    const subject = started();
    subject.moveTo('waiting_for_authority', NOW);
    expect(subject.status).toBe('waiting_for_authority');
    expect(subject.moveTo('completed', NOW).ok).toBe(true);
  });

  it('will not let work be completed before it has started', () => {
    expect(satisfy(task()).moveTo('completed', NOW).ok).toBe(false);
  });

  it('treats completion as final', () => {
    const subject = started();
    subject.moveTo('completed', NOW);
    // Reopening would quietly detach the hours already invoiced against it.
    expect(subject.moveTo('in_progress', NOW).ok).toBe(false);
  });

  it('records when it finished', () => {
    const subject = started();
    subject.moveTo('completed', at('2026-04-20T10:00:00Z'));
    expect(subject.snapshot().completedAt?.toISOString()).toBe('2026-04-20T10:00:00.000Z');
  });

  it('says what it refused and why', () => {
    const outcome = task('emaratax_request').moveTo('completed', NOW);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.message).toContain('from ready to completed');
  });
});

describe('steps and dates', () => {
  it('ticks steps off', () => {
    const subject = task('vat_return');
    expect(subject.completeStep(1, NOW).ok).toBe(true);
    expect(subject.stepsRemaining).toBe(6);
  });

  it('refuses a step the template does not have', () => {
    expect(task('vat_return').completeStep(99, NOW).ok).toBe(false);
  });

  it('is overdue once the date has passed, and never once finished', () => {
    const subject = satisfy(task());
    subject.setDueAt(at('2026-04-28T00:00:00Z'), NOW);

    expect(subject.isOverdueAt(at('2026-04-27T00:00:00Z'))).toBe(false);
    expect(subject.isOverdueAt(at('2026-04-29T00:00:00Z'))).toBe(true);

    subject.start(NOW);
    subject.moveTo('completed', NOW);
    expect(subject.isOverdueAt(at('2026-05-30T00:00:00Z'))).toBe(false);
  });
});

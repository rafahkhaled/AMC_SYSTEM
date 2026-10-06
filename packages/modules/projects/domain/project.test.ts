import { describe, expect, it } from 'vitest';
import { Project } from './project.js';

const at = (iso: string) => new Date(iso);
const NOW = at('2026-04-01T06:00:00Z');

function project(
  service: Parameters<typeof Project.fromTemplate>[0]['service'] = 'vat_registration',
) {
  const created = Project.fromTemplate({
    id: 'project-1',
    clientId: 'client-1',
    clientServiceId: 'cs-1',
    service,
    periodKey: null,
    now: NOW,
  });
  created.pullEvents();
  return created;
}

function satisfy(subject: Project, now = NOW) {
  for (const type of subject.missingDocuments) {
    subject.attachDocument(type, `doc-${type}`, now);
  }
  return subject;
}

describe('creating a project from its template (FR-11)', () => {
  it('starts awaiting documents when any are mandatory', () => {
    // Starting at ready would show work on the board as available that cannot
    // actually be begun.
    expect(project().status).toBe('awaiting_documents');
  });

  it('starts ready when the service needs no paperwork of ours', () => {
    expect(project('emaratax_request').status).toBe('ready');
  });

  it('copies the tasks from the template', () => {
    expect(project('vat_return').tasksRemaining).toBe(7);
  });

  it('lists exactly what is missing', () => {
    expect(project().missingDocuments).toEqual([
      'trade_licence',
      'emirates_id',
      'passport',
      'memorandum',
    ]);
  });
});

describe('attaching documents (ERD rule 1)', () => {
  it('links the project to one of the client documents', () => {
    const subject = project();
    expect(subject.attachDocument('trade_licence', 'doc-1', NOW).ok).toBe(true);
    expect(subject.requirements.find((r) => r.type === 'trade_licence')?.documentId).toBe('doc-1');
  });

  it('refuses a document this service never asked for', () => {
    expect(project().attachDocument('visa', 'doc-9', NOW).ok).toBe(false);
  });

  it('becomes ready on its own once the last mandatory document arrives', () => {
    // Nobody should have to notice that the blocker has cleared.
    const subject = satisfy(project());
    expect(subject.status).toBe('ready');
    expect(subject.isBlocked).toBe(false);
  });

  it('does not become ready while an optional document is still outstanding', () => {
    const subject = satisfy(project());
    expect(subject.requirements.find((r) => r.type === 'bank_letter')?.documentId).toBeNull();
    expect(subject.status).toBe('ready');
  });

  it('goes back to awaiting documents when one is removed', () => {
    const subject = satisfy(project());
    expect(subject.detachDocument('passport', NOW).ok).toBe(true);
    expect(subject.status).toBe('awaiting_documents');
  });

  it('keeps the documents of a completed project', () => {
    const subject = satisfy(project());
    subject.start(NOW);
    subject.moveTo('completed', NOW);
    // The work was done with those files; detaching them would make the
    // finished project unexplainable.
    expect(subject.detachDocument('passport', NOW).ok).toBe(false);
  });
});

describe('the document gate (FR-12)', () => {
  it('refuses to start while mandatory documents are missing', () => {
    const outcome = project().start(NOW);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.message).toContain('not all here yet');
      expect(outcome.error.details.missing).toContain('trade_licence');
    }
  });

  it('refuses the same move made through the general transition', () => {
    // The gate is a rule of the domain, not a disabled button, so it holds
    // however the state is changed.
    expect(project().moveTo('in_progress', NOW).ok).toBe(false);
  });

  it('starts once everything is in', () => {
    const subject = satisfy(project());
    expect(subject.start(NOW).ok).toBe(true);
    expect(subject.status).toBe('in_progress');
    expect(subject.snapshot().startedAt).toEqual(NOW);
  });
});

describe('how work moves', () => {
  function started() {
    const subject = satisfy(project());
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
    expect(satisfy(project()).moveTo('completed', NOW).ok).toBe(false);
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
    const outcome = project('emaratax_request').moveTo('completed', NOW);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.message).toContain('from ready to completed');
  });
});

describe('tasks and dates', () => {
  it('ticks tasks off', () => {
    const subject = project('vat_return');
    expect(subject.completeTask(1, NOW).ok).toBe(true);
    expect(subject.tasksRemaining).toBe(6);
  });

  it('refuses a task the template does not have', () => {
    expect(project('vat_return').completeTask(99, NOW).ok).toBe(false);
  });

  it('is overdue once the date has passed, and never once finished', () => {
    const subject = satisfy(project());
    subject.setDueAt(at('2026-04-28T00:00:00Z'), NOW);

    expect(subject.isOverdueAt(at('2026-04-27T00:00:00Z'))).toBe(false);
    expect(subject.isOverdueAt(at('2026-04-29T00:00:00Z'))).toBe(true);

    subject.start(NOW);
    subject.moveTo('completed', NOW);
    expect(subject.isOverdueAt(at('2026-05-30T00:00:00Z'))).toBe(false);
  });
});

describe('what a project tells the rest of the system', () => {
  /*
   * The unit of work turns every recorded event into an audit row. A change
   * that records nothing is therefore a change nobody can account for later,
   * which is the failure NFR-05 exists to prevent — so the events are worth
   * asserting on directly rather than trusting they were remembered.
   */
  it('records completing a task, with how much is left', () => {
    const subject = satisfy(project());
    subject.pullEvents();

    subject.completeTask(1, NOW);
    const [event] = subject.pullEvents();

    expect(event?.name).toBe('services.project.task_completed');
    expect(event?.payload).toMatchObject({ order: 1 });
    expect((event?.payload as { remaining: number }).remaining).toBe(subject.tasksRemaining);
  });

  it('refuses to complete a task twice', () => {
    // Without this a double tap writes a second audit row saying the same
    // task was finished at a different time, and neither reader can tell
    // which one was the work.
    const subject = satisfy(project());
    expect(subject.completeTask(1, NOW).ok).toBe(true);
    expect(subject.completeTask(1, at('2026-04-02T06:00:00Z')).ok).toBe(false);
  });

  it('records removing a document, naming the one removed', () => {
    const subject = satisfy(project());
    const type = subject.requirements[0]?.type ?? '';
    subject.pullEvents();

    expect(subject.detachDocument(type, NOW).ok).toBe(true);
    const names = subject.pullEvents().map((event) => event.name);

    expect(names).toContain('services.project.document_detached');
    // Losing a mandatory document puts the work back, and that is its own
    // event rather than something a reader has to infer.
    expect(names).toContain('services.project.state_changed');
  });

  it('will not let a completed project shed the documents it was done with', () => {
    const subject = satisfy(project());
    subject.start(NOW);
    subject.moveTo('completed', NOW);

    expect(subject.detachDocument(subject.requirements[0]?.type ?? '', NOW).ok).toBe(false);
  });
});

/** A project with its documents in and the work under way. */
function inProgress() {
  const subject = satisfy(project());
  subject.start(NOW);
  subject.pullEvents();
  return subject;
}

describe('going back a step', () => {
  it('asks why, because a correction nobody wrote down cannot be explained', () => {
    const subject = inProgress();
    subject.moveTo('waiting_for_client', NOW);

    const refused = subject.moveTo('awaiting_documents', NOW);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.message).toContain('Say why');

    expect(
      subject.moveTo('awaiting_documents', NOW, 'the trade licence they sent had expired').ok,
    ).toBe(true);
    expect(subject.status).toBe('awaiting_documents');
  });

  it('does not ask when the work simply carries on', () => {
    const subject = inProgress();
    subject.moveTo('waiting_for_client', NOW);

    /*
     * The client replied. That is the ordinary course of things, not a
     * correction — asking every time is how people learn to type "ok".
     */
    expect(subject.moveTo('in_progress', NOW).ok).toBe(true);
  });

  it('refuses a reason that says nothing', () => {
    const subject = inProgress();
    expect(subject.moveTo('awaiting_documents', NOW, '  ').ok).toBe(false);
    expect(subject.moveTo('awaiting_documents', NOW, 'x').ok).toBe(false);
  });

  it('carries the reason into the event, which is what the audit log keeps', () => {
    const subject = inProgress();
    subject.pullEvents();
    subject.moveTo('awaiting_documents', NOW, 'filed before the licence arrived');

    const [event] = subject.pullEvents();
    expect(event?.payload).toMatchObject({
      to: 'awaiting_documents',
      reason: 'filed before the licence arrived',
    });
  });
});

describe('a due date on a step', () => {
  it('is set and cleared freely, because a date a client agreed can move', () => {
    const subject = inProgress();
    const due = new Date('2026-11-15T00:00:00.000Z');

    expect(subject.setTaskDueOn(1, due, NOW).ok).toBe(true);
    expect(subject.snapshot().tasks.find((task) => task.order === 1)?.dueOn).toEqual(due);

    expect(subject.setTaskDueOn(1, null, NOW).ok).toBe(true);
    expect(subject.snapshot().tasks.find((task) => task.order === 1)?.dueOn).toBeNull();
  });

  it('says so when there is no such step', () => {
    expect(inProgress().setTaskDueOn(99, new Date(), NOW).ok).toBe(false);
  });
});

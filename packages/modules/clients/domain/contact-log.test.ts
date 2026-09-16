import { describe, expect, it } from 'vitest';
import { ContactLogEntry } from './contact-log.js';

const at = (iso: string) => new Date(iso);
const NOW = at('2026-09-16T06:00:00Z');

function entry(over: Record<string, unknown> = {}) {
  return ContactLogEntry.record({
    id: 'entry-1',
    clientId: 'c-1',
    userId: 'user-a',
    channel: 'call',
    direction: 'outbound',
    happenedAt: at('2026-09-14T10:00:00Z'),
    summary: 'Asked for the renewed trade licence',
    now: NOW,
    ...over,
  });
}

describe('a conversation with a client (FR-06)', () => {
  it('keeps when it happened apart from when it was written up', () => {
    /*
     * A call on Monday typed up on Wednesday is a call on Monday. The
     * escalation ladder counts days from when the client was actually asked,
     * so conflating the two would quietly move every chase.
     */
    const recorded = entry();
    expect(recorded.ok).toBe(true);
    if (!recorded.ok) return;

    const state = recorded.value.snapshot();
    expect(state.happenedAt.toISOString()).toBe('2026-09-14T10:00:00.000Z');
    expect(state.createdAt).toEqual(NOW);
  });

  it('refuses a conversation that has not happened yet', () => {
    // A mistyped year would otherwise sit in the log unnoticed and push a
    // chase forward, because the ladder counts from this date.
    expect(entry({ happenedAt: at('2027-01-05T10:00:00Z') }).ok).toBe(false);
  });

  it('refuses a summary that says nothing', () => {
    expect(entry({ summary: 'x' }).ok).toBe(false);
    expect(entry({ summary: '   ' }).ok).toBe(false);
  });

  it('refuses a way of talking to somebody that it does not record', () => {
    expect(entry({ channel: 'telepathy' }).ok).toBe(false);
  });

  it('insists on knowing which way the conversation went', () => {
    // Whether we chased them or they came to us is the difference between a
    // client who is slow and one who is asking questions.
    expect(entry({ direction: 'sideways' }).ok).toBe(false);
    expect(entry({ direction: 'inbound' }).ok).toBe(true);
  });

  it('takes several screenshots, because a thread is several images', () => {
    const recorded = entry({ channel: 'whatsapp' });
    if (!recorded.ok) throw new Error('fixture');

    for (const id of ['a', 'b']) {
      recorded.value.attach({
        id,
        storageKey: `clients/c-1/contact-log/entry-1/${id}.png`,
        originalName: `${id}.png`,
        contentType: 'image/png',
        checksum: 'x',
        sizeBytes: 100,
      });
    }

    expect(recorded.value.snapshot().attachments.map((file) => file.id)).toEqual(['a', 'b']);
  });

  it('records a call with no screenshot at all', () => {
    const recorded = entry();
    if (!recorded.ok) throw new Error('fixture');
    expect(recorded.value.snapshot().attachments).toEqual([]);
  });

  it('remembers which task was being chased, when one was', () => {
    // That is what lets a task show its own chasing history rather than the
    // client's whole log.
    const recorded = entry({ taskId: 'task-9' });
    if (!recorded.ok) throw new Error('fixture');
    expect(recorded.value.snapshot().taskId).toBe('task-9');
  });
});

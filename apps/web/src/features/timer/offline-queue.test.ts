import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { available, clear, enqueue, forget, pending } from './offline-queue.js';

describe('the queue that survives a tunnel (NFR-03)', () => {
  beforeEach(async () => {
    await clear();
  });

  it('is available in a browser that allows IndexedDB', () => {
    expect(available()).toBe(true);
  });

  it('keeps what a person did, with the instant they did it', async () => {
    const at = new Date('2026-09-16T10:30:00.000Z');
    await enqueue('stop', null, at);

    const queued = await pending();
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ action: 'stop', taskId: null, at: at.toISOString() });
  });

  it('replays in the order things happened, not the order they are read', async () => {
    /*
     * A start after a stop is a different piece of work. Replayed the other
     * way round, the gap between them is booked to whichever task happened to
     * be running when the connection came back.
     */
    await enqueue('stop', null, new Date('2026-09-16T10:00:00.000Z'));
    await enqueue('start', 'task-2', new Date('2026-09-16T10:05:00.000Z'));
    await enqueue('hold', null, new Date('2026-09-16T11:00:00.000Z'));

    expect((await pending()).map((item) => item.action)).toEqual(['stop', 'start', 'hold']);
  });

  it('forgets one action without disturbing the rest', async () => {
    await enqueue('stop', null);
    await enqueue('start', 'task-2');

    const [first] = await pending();
    await forget(first?.id ?? 0);

    const left = await pending();
    expect(left).toHaveLength(1);
    expect(left[0]?.action).toBe('start');
  });

  it('survives being read by a fresh connection, which is the whole point', async () => {
    // The tab that wrote this is gone. A new one has to find it.
    await enqueue('stop', null, new Date('2026-09-16T17:00:00.000Z'));

    const found = await pending();
    expect(found[0]?.at).toBe('2026-09-16T17:00:00.000Z');
  });

  it('keeps the task a start was for, because a start without one records nothing', async () => {
    await enqueue('start', 'task-9');
    expect((await pending())[0]?.taskId).toBe('task-9');
  });
});

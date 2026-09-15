import { describe, expect, it } from 'vitest';
import { ClientDocument, type DocumentTypeCode } from './document.js';

const at = (iso: string) => new Date(iso);

function required(type: DocumentTypeCode = 'trade_licence') {
  const document = ClientDocument.require({
    id: 'doc-1',
    clientId: 'client-1',
    type,
    now: at('2026-01-10T06:00:00Z'),
  });
  document.pullEvents();
  return document;
}

function receive(document: ClientDocument, expiresOn: string | null) {
  return document.receive({
    storageKey: 'clients/client-1/documents/doc-1.pdf',
    originalName: 'الرخصة التجارية.pdf',
    checksum: 'a'.repeat(64),
    issuedOn: at('2026-01-01T00:00:00Z'),
    expiresOn: expiresOn ? at(expiresOn) : null,
    uploadedBy: 'user-1',
    now: at('2026-01-10T06:00:00Z'),
  });
}

describe('asking for a document before it arrives', () => {
  it('exists as soon as it is needed, so a checklist can show what is missing', () => {
    expect(required().status).toBe('required');
    expect(required().storageKey).toBeNull();
  });
});

describe('receiving a document', () => {
  it('records the file, the checksum and the original name', () => {
    const document = required();
    expect(receive(document, '2027-01-01T00:00:00Z').ok).toBe(true);
    expect(document.status).toBe('held');
    expect(document.snapshot().originalName).toBe('الرخصة التجارية.pdf');
    expect(document.snapshot().checksum).toHaveLength(64);
  });

  it('refuses a trade licence with no expiry date', () => {
    // Accepting it would quietly remove that client from every renewal
    // reminder, which is the failure this system exists to prevent.
    const outcome = receive(required('trade_licence'), null);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.message).toContain('needs an expiry date');
  });

  it('accepts a memorandum without one, because it does not expire', () => {
    expect(receive(required('memorandum'), null).ok).toBe(true);
  });

  it('refuses an expiry that falls before the issue date', () => {
    expect(receive(required(), '2025-01-01T00:00:00Z').ok).toBe(false);
  });
});

describe('what the calendar says', () => {
  function held(expiresOn: string) {
    const document = required();
    receive(document, expiresOn);
    document.pullEvents();
    return document;
  }

  it('is valid while the expiry is far off', () => {
    expect(held('2027-01-01T00:00:00Z').expiryStateOn(at('2026-01-10T00:00:00Z'))).toBe('valid');
  });

  it('is expiring once inside ninety days', () => {
    expect(held('2026-04-01T00:00:00Z').expiryStateOn(at('2026-01-10T00:00:00Z'))).toBe('expiring');
  });

  it('is expired the day after, not the day of', () => {
    const document = held('2026-06-30T00:00:00Z');
    // The licence is good on its last day. Treating that day as expired would
    // have the firm chasing a client whose paperwork is in order.
    expect(document.expiryStateOn(at('2026-06-30T00:00:00Z'))).toBe('expiring');
    expect(document.expiryStateOn(at('2026-07-01T00:00:00Z'))).toBe('expired');
  });

  it('says a document without an expiry never expires', () => {
    const document = required('memorandum');
    receive(document, null);
    expect(document.expiryStateOn(at('2030-01-01T00:00:00Z'))).toBe('never_expires');
  });

  it('counts whole days rather than elapsed hours', () => {
    // Late in the evening against early the next morning is one day, not zero.
    const document = held('2026-06-30T00:00:00Z');
    expect(document.daysUntilExpiry(at('2026-06-29T23:00:00Z'))).toBe(1);
    expect(document.daysUntilExpiry(at('2026-06-30T01:00:00Z'))).toBe(0);
  });
});

describe('the staged reminders (FR-42)', () => {
  function held(expiresOn: string) {
    const document = required();
    receive(document, expiresOn);
    document.pullEvents();
    return document;
  }

  it('fires at ninety, sixty and thirty days', () => {
    const document = held('2026-12-31T00:00:00Z');
    expect(document.warningDueOn(at('2026-10-02T00:00:00Z'))).toBe(90);
    expect(document.warningDueOn(at('2026-11-01T00:00:00Z'))).toBe(60);
    expect(document.warningDueOn(at('2026-12-01T00:00:00Z'))).toBe(30);
  });

  it('fires on the day the threshold is crossed and not every day after', () => {
    // Three reminders over three months, rather than ninety and a client who
    // has learned to ignore all of them.
    const document = held('2026-12-31T00:00:00Z');
    expect(document.warningDueOn(at('2026-10-03T00:00:00Z'))).toBeNull();
    expect(document.warningDueOn(at('2026-12-15T00:00:00Z'))).toBeNull();
  });

  it('stops chasing once a renewal is under way', () => {
    const document = held('2026-12-31T00:00:00Z');
    document.markRenewing(at('2026-09-01T00:00:00Z'));
    expect(document.warningDueOn(at('2026-10-02T00:00:00Z'))).toBeNull();
  });

  it('never fires for something that does not expire', () => {
    const document = required('memorandum');
    receive(document, null);
    expect(document.warningDueOn(at('2026-10-02T00:00:00Z'))).toBeNull();
  });
});

describe('renewal', () => {
  it('keeps the old version rather than overwriting it', () => {
    const document = required();
    receive(document, '2026-06-30T00:00:00Z');
    expect(document.supersede('doc-2', at('2026-06-15T06:00:00Z')).ok).toBe(true);

    // A task completed in March used the licence valid in March, and the file
    // behind that work must still be the file that was used.
    expect(document.isSuperseded).toBe(true);
    expect(document.snapshot().storageKey).toBe('clients/client-1/documents/doc-1.pdf');
  });

  it('refuses to replace the same document twice', () => {
    const document = required();
    receive(document, '2026-06-30T00:00:00Z');
    document.supersede('doc-2', at('2026-06-15T06:00:00Z'));
    expect(document.supersede('doc-3', at('2026-06-16T06:00:00Z')).ok).toBe(false);
  });

  it('refuses a file uploaded against a version already replaced', () => {
    const document = required();
    receive(document, '2026-06-30T00:00:00Z');
    document.supersede('doc-2', at('2026-06-15T06:00:00Z'));
    expect(receive(document, '2027-06-30T00:00:00Z').ok).toBe(false);
  });

  it('will not mark a document under renewal before it has arrived', () => {
    expect(required().markRenewing(at('2026-02-01T06:00:00Z')).ok).toBe(false);
  });
});

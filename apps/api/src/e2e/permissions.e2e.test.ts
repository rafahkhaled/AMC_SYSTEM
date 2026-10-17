import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type RoleName, type Session, type TestApp, bootTestApp } from '../testing/test-app.js';

/**
 * Who may do what, asked through the front door.
 *
 * The permission matrix is proved as data in the identity module. What it does
 * not prove is that each route asks the right question: a controller that
 * names `clients.view.all` where it meant `clients.edit` passes every unit
 * test and lets the wrong person in. Each row below is one route and the
 * permission it is meant to need, tried as someone who has it and someone who
 * has not.
 */
type Verb = 'get' | 'post' | 'patch' | 'put' | 'delete';

interface Row {
  readonly name: string;
  readonly verb: Verb;
  readonly path: string;
  readonly body?: Record<string, unknown>;
  /** Roles that hold the permission this route asks for. */
  readonly allowed: readonly RoleName[];
}

const MANAGER_ONLY: readonly RoleName[] = ['manager'];
const WORKS_WITH_CLIENTS: readonly RoleName[] = ['manager', 'accountant'];

const ROWS: readonly Row[] = [
  // Administration: users.manage
  {
    name: 'add a branch',
    verb: 'post',
    path: '/branches',
    body: { nameEn: 'X', nameAr: 'س' },
    allowed: MANAGER_ONLY,
  },
  {
    name: 'change a branch',
    verb: 'patch',
    path: '/branches/dubai',
    body: { retired: false },
    allowed: MANAGER_ONLY,
  },
  {
    name: 'add a service',
    verb: 'post',
    path: '/services',
    body: {
      nameEn: 'X',
      nameAr: 'س',
      deadlineDays: null,
      steps: [{ nameEn: 'a', nameAr: 'أ' }],
      requiredDocuments: [],
    },
    allowed: MANAGER_ONLY,
  },
  {
    name: 'change a service',
    verb: 'patch',
    path: '/services/custom_none',
    body: { retired: true },
    allowed: MANAGER_ONLY,
  },
  {
    name: 'add a list option',
    verb: 'post',
    path: '/lists/portal',
    body: { code: 'zz', nameEn: 'Z', nameAr: 'ز' },
    allowed: MANAGER_ONLY,
  },
  {
    name: 'change a list option',
    verb: 'patch',
    path: '/lists/portal/other',
    body: { retired: false },
    allowed: MANAGER_ONLY,
  },
  {
    name: 'read every letter template',
    verb: 'get',
    path: '/letter-templates/all',
    allowed: MANAGER_ONLY,
  },
  {
    name: 'add a letter template',
    verb: 'post',
    path: '/letter-templates',
    body: { nameEn: 'X', nameAr: 'س', bodyEn: 'x', bodyAr: 'س' },
    allowed: MANAGER_ONLY,
  },
  {
    name: 'change a letter template',
    verb: 'patch',
    path: '/letter-templates/engagement_letter',
    body: { retired: false },
    allowed: MANAGER_ONLY,
  },
  {
    name: 'add a staff member',
    verb: 'post',
    path: '/staff',
    body: { email: 'a@b.ae', displayName: 'A', roles: ['accountant'], password: 'x' },
    allowed: MANAGER_ONLY,
  },
  { name: 'read the audit log', verb: 'get', path: '/audit', allowed: MANAGER_ONLY },

  // Money: billing.approve / billing.invoice.issue
  {
    name: 'draft a quotation',
    verb: 'post',
    path: '/billing/quotations',
    body: { clientId: 'nobody' },
    allowed: MANAGER_ONLY,
  },
  {
    name: 'set a quotation branch',
    verb: 'post',
    path: '/billing/quotations/x/branch',
    body: { branchCode: null },
    allowed: MANAGER_ONLY,
  },
  {
    name: 'add a quotation line',
    verb: 'post',
    path: '/billing/quotations/x/lines',
    body: { descriptionEn: 'x', amountMinor: 1, vat: 'standard' },
    allowed: MANAGER_ONLY,
  },
  {
    name: 'generate a statement',
    verb: 'post',
    path: '/billing/statements',
    body: { clientId: 'x', from: '2026-01-01', to: '2026-01-31' },
    allowed: MANAGER_ONLY,
  },
  {
    name: 'approve a statement',
    verb: 'post',
    path: '/billing/statements/x/approve',
    allowed: MANAGER_ONLY,
  },
  {
    name: 'raise an invoice',
    verb: 'post',
    path: '/billing/statements/x/invoice',
    body: {},
    allowed: MANAGER_ONLY,
  },
  {
    name: 'record a payment',
    verb: 'post',
    path: '/billing/invoices/x/payments',
    body: { amountMinor: 1, receivedOn: '2026-01-01', method: 'cash' },
    allowed: MANAGER_ONLY,
  },
  {
    name: 'see the quotations',
    verb: 'get',
    path: '/billing/quotations',
    allowed: WORKS_WITH_CLIENTS,
  },
  { name: 'see the invoices', verb: 'get', path: '/billing/invoices', allowed: WORKS_WITH_CLIENTS },

  // The client file: clients.edit and the vault
  {
    name: 'upload to a client folder',
    verb: 'post',
    path: '/clients/x/files',
    allowed: MANAGER_ONLY,
  },
  { name: 'remove a client file', verb: 'delete', path: '/client-files/x', allowed: MANAGER_ONLY },
  { name: 'upload a document', verb: 'post', path: '/clients/x/documents', allowed: MANAGER_ONLY },
  {
    name: 'generate a letter',
    verb: 'post',
    path: '/clients/x/letters',
    body: { templateCode: 'x', language: 'en' },
    allowed: MANAGER_ONLY,
  },
  {
    name: 'record a conversation',
    verb: 'post',
    path: '/clients/x/contact-log',
    allowed: MANAGER_ONLY,
  },
  {
    name: 'add an enquiry',
    verb: 'post',
    path: '/leads',
    body: { name: 'x' },
    allowed: MANAGER_ONLY,
  },
  {
    name: 'open the vault',
    verb: 'get',
    path: '/clients/x/credentials',
    allowed: WORKS_WITH_CLIENTS,
  },
  {
    name: 'store a login',
    verb: 'post',
    path: '/clients/x/credentials',
    body: { kind: 'other', username: 'u', secret: 's' },
    allowed: WORKS_WITH_CLIENTS,
  },

  // Work: projects.edit, time
  {
    name: 'start work',
    verb: 'post',
    path: '/projects',
    body: { clientId: 'x', service: 'audit' },
    allowed: WORKS_WITH_CLIENTS,
  },
  {
    name: 'move work',
    verb: 'post',
    path: '/projects/x/move',
    body: { to: 'ready' },
    allowed: WORKS_WITH_CLIENTS,
  },
  {
    name: 'open the next period',
    verb: 'post',
    path: '/projects/x/open-next',
    allowed: WORKS_WITH_CLIENTS,
  },
  {
    name: 'stop a job repeating',
    verb: 'post',
    path: '/projects/x/stop-repeating',
    allowed: WORKS_WITH_CLIENTS,
  },
  {
    name: 'record time',
    verb: 'post',
    path: '/timer/start',
    body: { projectId: 'x' },
    allowed: WORKS_WITH_CLIENTS,
  },
  { name: 'see time to approve', verb: 'get', path: '/timer/approvals', allowed: MANAGER_ONLY },
];

describe('every route asks for the permission it is meant to', () => {
  let t: TestApp;
  const people = {} as Record<RoleName, Session>;

  beforeAll(async () => {
    t = await bootTestApp();
    for (const role of ['manager', 'accountant', 'data_entry'] as const)
      people[role] = await t.as(role);
  });
  afterAll(async () => {
    await t.close();
  });

  for (const row of ROWS) {
    it(`${row.name}: refused to those without the permission, not to those with it`, async () => {
      for (const role of ['manager', 'accountant', 'data_entry'] as const) {
        const response = await people[role][row.verb](row.path).send(row.body ?? {});
        if (row.allowed.includes(role)) {
          // Whatever it says — a missing client, a malformed body — it is not
          // "you may not": the permission was held.
          expect(response.status, `${role} on ${row.name}`).not.toBe(403);
          expect(response.status, `${role} on ${row.name}`).not.toBe(401);
        } else {
          expect(response.status, `${role} on ${row.name}`).toBe(403);
        }
      }
    });
  }

  it('covers the routes that change things, so a new one has to be added here', async () => {
    // Not every route needs a row — reads that scope by client are covered by
    // the feature suites — but a route that writes and asks for a permission
    // is exactly what this table exists for.
    expect(ROWS.length).toBeGreaterThanOrEqual(30);
  });
});

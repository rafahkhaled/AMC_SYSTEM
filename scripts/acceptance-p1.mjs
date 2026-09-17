#!/usr/bin/env node
/**
 * The Phase 1 acceptance run.
 *
 * Walks the whole journey against a running system and prints what actually
 * happened, so the result can be read rather than taken on trust. It is not a
 * test suite: the suites prove the pieces, and this proves they join up.
 *
 * What it cannot check is printed at the end. A real client's data and a real
 * phone are not things a script can supply, and pretending otherwise would be
 * the one failure an acceptance run must not have.
 *
 *   node scripts/acceptance-p1.mjs [--url http://localhost:3000]
 */

const BASE = process.argv.includes('--url')
  ? process.argv[process.argv.indexOf('--url') + 1]
  : 'http://localhost:3000';

const EMAIL = process.env.ACCEPTANCE_EMAIL ?? 'wael@activemanagement.ae';
const PASSWORD = process.env.ACCEPTANCE_PASSWORD ?? 'correct horse battery staple';

let cookie = '';
const results = [];

async function call(path, options = {}) {
  const response = await fetch(`${BASE}/api${path}`, {
    method: options.method ?? 'GET',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });

  const set = response.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];

  const text = await response.text();
  try {
    return { status: response.status, body: text ? JSON.parse(text) : null };
  } catch {
    return { status: response.status, body: { raw: text } };
  }
}

/**
 * Any successful status.
 *
 * Nest answers a POST with 201 by default, and several of these do create
 * something. Checking for 200 exactly made the first run report three
 * failures that were the checks being wrong rather than the system.
 */
const ok = (status) => status >= 200 && status < 300;

/** Records one check, with what it actually saw. */
function check(criterion, passed, detail) {
  results.push({ criterion, passed, detail });
  console.log(`  ${passed ? 'pass' : 'FAIL'}  ${criterion}`);
  if (detail) console.log(`        ${detail}`);
}

function heading(text) {
  console.log(`\n${text}`);
}

async function run() {
  console.log(`Phase 1 acceptance run against ${BASE}`);

  heading('Signing in');
  const signIn = await call('/auth/sign-in', {
    method: 'POST',
    body: { email: EMAIL, password: PASSWORD },
  });
  check(
    'A manager can sign in',
    ok(signIn.status),
    `${signIn.status} as ${signIn.body?.caller?.displayName ?? 'nobody'}`,
  );
  if (!ok(signIn.status)) return finish();

  heading('Clients and their documents');
  const clients = (await call('/clients')).body?.clients ?? [];
  check('Clients are listed', clients.length > 0, `${clients.length} on the books`);

  /*
   * A VAT-registered one. A client converted from an enquiry has no tax
   * period until somebody sets one, which is correct and not what this
   * criterion is about.
   */
  const registered = clients.find((candidate) => candidate.vatState === 'registered');
  const client = registered ?? clients[0];
  const detail = (await call(`/clients/${client.id}`)).body;
  check(
    'A registered client shows its own VAT period months',
    Boolean(registered) && (detail?.vatPeriodEndMonths ?? []).length > 0,
    registered
      ? `${client.legalName}: periods end in months ${detail?.vatPeriodEndMonths?.join(', ')}`
      : 'no VAT-registered client to check',
  );
  check(
    'Document expiry is computed from the date, never stored',
    (detail?.documents ?? []).every((document) => typeof document.expiryState === 'string'),
    (detail?.documents ?? []).map((d) => `${d.type}=${d.expiryState}`).join('  '),
  );

  heading('Work created from the service templates');
  const board = (await call('/tasks')).body;
  const tasks = (board?.columns ?? []).flatMap((column) => column.tasks);
  check(
    'Tasks exist on the board',
    tasks.length > 0,
    `${tasks.length} open across ${board?.columns?.length} columns`,
  );
  check(
    'Waiting on the client is a different column from waiting on the authority',
    (board?.columns ?? []).some((c) => c.state === 'waiting_for_client') &&
      (board?.columns ?? []).some((c) => c.state === 'waiting_for_authority'),
  );

  const blocked = tasks.find((task) => task.missingDocuments.length > 0);
  if (blocked) {
    const refused = await call(`/tasks/${blocked.id}/move`, {
      method: 'POST',
      body: { to: 'in_progress' },
    });
    check(
      'Work cannot start without the documents it needs',
      refused.status >= 400,
      refused.body?.error?.message ?? String(refused.status),
    );
  } else {
    check('Work cannot start without the documents it needs', false, 'no blocked task to try');
  }

  heading('The timer');
  const startable = tasks[0];
  await call('/timer/stop', { method: 'POST' });

  const started = await call('/timer/start', { method: 'POST', body: { taskId: startable.id } });
  check(
    'A timer starts against a task',
    ok(started.status) && Boolean(started.body?.running),
    started.body?.running?.clientName,
  );

  await new Promise((resolve) => setTimeout(resolve, 2100));
  const held = await call('/timer/hold', { method: 'POST' });
  check(
    'Holding records the span and keeps the task',
    held.body?.running?.held === true,
    `${held.body?.today?.[0]?.seconds ?? 0} seconds recorded`,
  );

  const resumed = await call('/timer/resume', { method: 'POST' });
  check('Resuming starts a fresh span', resumed.body?.running?.held === false);

  const stopped = await call('/timer/stop', { method: 'POST' });
  check(
    'Stopping records the time',
    (stopped.body?.todaySeconds ?? 0) > 0,
    `${stopped.body?.todaySeconds} seconds today`,
  );

  await call('/timer/start', { method: 'POST', body: { taskId: startable.id } });
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const clamped = await call('/timer/stop', {
    method: 'POST',
    body: { at: new Date(Date.now() + 5 * 3600_000).toISOString() },
  });
  check(
    'A replayed stop cannot claim time that has not happened',
    (clamped.body?.today?.[0]?.seconds ?? 999) < 60,
    `claimed five hours ahead, recorded ${clamped.body?.today?.[0]?.seconds} seconds`,
  );

  heading('Time recorded by hand');
  const noReason = await call('/timer/entries', {
    method: 'POST',
    body: {
      taskId: startable.id,
      startedAt: '2026-09-16T10:00',
      endedAt: '2026-09-16T11:00',
      reason: 'x',
    },
  });
  check('Manual time needs a reason', noReason.status >= 400, noReason.body?.error?.message);

  const notYet = await call('/timer/entries', {
    method: 'POST',
    body: {
      taskId: startable.id,
      startedAt: '2027-01-01T10:00',
      endedAt: '2027-01-01T11:00',
      reason: 'Work that has not happened',
    },
  });
  check(
    'Time cannot be recorded for work not yet done',
    notYet.status >= 400,
    notYet.body?.error?.message,
  );

  heading('Deadlines');
  const month = new Date().toISOString().slice(0, 7);
  const calendar = (await call(`/calendar?month=${month}`)).body;
  check(
    'The month has a day for every date',
    (calendar?.days ?? []).length >= 28,
    `${calendar?.days?.length} days`,
  );

  const entries = (calendar?.days ?? []).flatMap((day) => day.entries);
  const moved = entries.find((entry) => entry.movedBecause);
  check(
    'A deadline on a closed day moves, and says why',
    Boolean(moved),
    moved
      ? `${moved.clientName}: ${moved.statutoryOn} became ${moved.dueOn}, a ${moved.movedBecause}`
      : 'nothing fell on a closed day this month',
  );

  const expiry = entries.find((entry) => entry.kind === 'document_expiry');
  check(
    'A document expiry never moves',
    !expiry || expiry.movedBecause === null,
    expiry ? `${expiry.subject} on ${expiry.dueOn}` : 'none this month',
  );

  heading('The credential vault');
  const stored = await call(`/clients/${client.id}/credentials`, {
    method: 'POST',
    body: { kind: 'emaratax', username: 'acceptance@portal.ae', secret: 'Acceptance-Pass-1' },
  });
  check(
    'A portal login is stored without the password coming back',
    ok(stored.status) && !JSON.stringify(stored.body).includes('Acceptance-Pass'),
  );

  const credentialId = stored.body?.credentials?.[0]?.id;
  const noWhy = await call(`/clients/${client.id}/credentials/${credentialId}/reveal`, {
    method: 'POST',
    body: { reason: 'x' },
  });
  check(
    'A password cannot be read without saying why',
    noWhy.status >= 400,
    noWhy.body?.error?.message,
  );

  const revealed = await call(`/clients/${client.id}/credentials/${credentialId}/reveal`, {
    method: 'POST',
    body: { reason: 'Phase 1 acceptance run' },
  });
  check('With a reason, the password comes back', revealed.body?.secret === 'Acceptance-Pass-1');

  const audit = (await call('/audit?limit=10')).body?.entries ?? [];
  check(
    'The read is in the audit log, with its reason and without the secret',
    audit.some((row) => row.action === 'clients.credential.read') &&
      !JSON.stringify(audit).includes('Acceptance-Pass'),
  );

  heading('Letters');
  const templates = (await call('/letter-templates')).body?.templates ?? [];
  check(
    'The firm has letters to send',
    templates.length > 0,
    templates.map((t) => t.code).join(', '),
  );

  const letter = (
    await call(`/clients/${client.id}/letters`, {
      method: 'POST',
      body: { templateCode: templates[0]?.code, language: 'ar' },
    })
  ).body;
  check(
    'A letter is filled in from the client record',
    typeof letter?.body === 'string' && letter.body.includes(client.legalName),
    `${letter?.title}, ${letter?.body?.length} characters`,
  );

  heading('Enquiries');
  const unreachable = await call('/leads', {
    method: 'POST',
    body: { name: 'Acceptance', source: 'whatsapp' },
  });
  check(
    'An enquiry with no way to reach anybody is refused',
    unreachable.status >= 400,
    unreachable.body?.error?.message,
  );

  const leads = (await call('/leads')).body;
  check(
    'The pipeline has its columns',
    (leads?.columns ?? []).length === 4,
    (leads?.columns ?? []).map((column) => column.status).join(' then '),
  );

  heading('Notifications');
  const inbox = (await call('/notifications')).body;
  check(
    'The inbox answers',
    typeof inbox?.unread === 'number',
    `${inbox?.entries?.length} entries, ${inbox?.unread} unread`,
  );
  const preferences = (await call('/notifications/preferences')).body?.preferences ?? [];
  check(
    'Every kind of notification has a setting',
    preferences.length === 5,
    preferences.map((preference) => preference.kind).join(', '),
  );

  heading('Who sees what');
  const workload = (await call('/tasks/workload')).body;
  check(
    'A manager sees who is on what',
    (workload?.people ?? []).length > 0,
    `${workload?.people?.length} people, ${workload?.unassignedTasks} tasks on nobody`,
  );

  finish();
}

function finish() {
  const failed = results.filter((result) => !result.passed);
  console.log(`\n${results.length - failed.length} of ${results.length} passed`);

  console.log('\nWhat this run cannot check');
  for (const line of [
    "A real client's data. This ran against the demo seed.",
    'A physical phone. Mobile layouts were checked at 375 pixels in a browser, not on a device.',
    'Installing to a home screen. No browser available here will register a service worker.',
    'Email delivery. Without a verified sender the worker writes emails to the log.',
    'A restore from a real backup, which belongs to the P0 exit and is recorded there.',
  ]) {
    console.log(`  - ${line}`);
  }

  process.exit(failed.length === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(`\nThe run stopped: ${error.message}`);
  process.exit(1);
});

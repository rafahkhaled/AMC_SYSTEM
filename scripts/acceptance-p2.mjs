#!/usr/bin/env node
/**
 * The Phase 2 acceptance run.
 *
 * The P2 exit is one sentence: the figures match a hand calculation, and
 * invoiced hours can no longer be edited. So this records time at a known
 * rate, bills it, and checks every figure against arithmetic written out
 * here in full — deliberately not by calling the same helpers the server
 * uses, because two copies of one mistake agree with each other.
 *
 *   node scripts/acceptance-p2.mjs [--url http://localhost:3000]
 */

const BASE = process.argv.includes('--url')
  ? process.argv[process.argv.indexOf('--url') + 1]
  : 'http://localhost:3000';

const EMAIL = process.env.ACCEPTANCE_EMAIL ?? 'wael@activemanagement.ae';
const PASSWORD = process.env.ACCEPTANCE_PASSWORD ?? 'correct horse battery staple';

/*
 * A mark unique to this run.
 *
 * The script records real time against a real project, so a second run finds
 * the first one's hours still there. Tagging them means each run can pick out
 * its own rather than counting whatever the database happens to hold.
 */
const RUN = `Acceptance run for P2 ${new Date().toISOString()}`;

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

const ok = (status) => status >= 200 && status < 300;

function check(criterion, passed, detail) {
  results.push({ criterion, passed, detail });
  console.log(`  ${passed ? 'pass' : 'FAIL'}  ${criterion}`);
  if (detail) console.log(`        ${detail}`);
}

function heading(text) {
  console.log(`\n${text}`);
}

/** Money as the firm would write it, from whole fils. */
const money = (minor) => (minor / 100).toFixed(2);

const state = {};

async function signingIn() {
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
  state.me = signIn.body?.caller;
  return ok(signIn.status);
}

async function recordingTime() {
  heading('Recording time against a project');

  const board = (await call('/projects')).body?.columns ?? [];
  const open = board.flatMap((column) => column.projects);
  const project = open[0];
  check('There is open work to record against', Boolean(project), project?.clientName ?? 'none');
  if (!project) return;
  state.project = project;

  /*
   * Two sittings on one day and one on another, so the statement has to group
   * as well as add: 2h30 and 1h15 on the third, 45m on the fourth.
   */
  state.sittings = [
    { day: '2026-09-03', from: '09:00', to: '11:30' },
    { day: '2026-09-03', from: '13:00', to: '14:15' },
    { day: '2026-09-04', from: '10:00', to: '10:45' },
  ];

  const before = (await call('/timer/timesheet?from=2026-09-01&to=2026-09-30')).body;
  state.alreadyRecorded = before?.totalSeconds ?? 0;

  for (const sitting of state.sittings) {
    const recorded = await call('/timer/entries', {
      method: 'POST',
      body: {
        projectId: project.id,
        startedAt: `${sitting.day}T${sitting.from}`,
        endedAt: `${sitting.day}T${sitting.to}`,
        reason: RUN,
        billable: true,
      },
    });
    if (!ok(recorded.status)) {
      check(
        'Time can be recorded by hand',
        false,
        `${recorded.status} ${JSON.stringify(recorded.body)}`,
      );
      return;
    }
  }

  // 2h30 + 1h15 + 45m = 4h30 = 16,200 seconds, worked out here and not there.
  const expected = 2.5 * 3600 + 1.25 * 3600 + 0.75 * 3600;
  const sheet = (await call('/timer/timesheet?from=2026-09-01&to=2026-09-30')).body;
  const added = (sheet?.totalSeconds ?? 0) - state.alreadyRecorded;
  check(
    'Three sittings add up to four and a half hours',
    added === expected,
    `${added} seconds recorded, ${expected} expected`,
  );

  /*
   * Through the approval queue rather than the timesheet, because that is the
   * screen a manager would use: a timesheet is deliberately a person's own,
   * and the hours that need approving are everybody's.
   */
  const queue = await call('/timer/approvals');
  state.entryIds = (queue.body?.entries ?? [])
    .filter((entry) => entry.reason === RUN)
    .map((entry) => entry.id);
  check(
    'The unapproved hours are listed somewhere a manager can act on them',
    ok(queue.status) && state.entryIds.length === 3,
    `${queue.status}: this run's 3 entries found in a queue of ${queue.body?.entries?.length ?? 0}`,
  );
}

async function approving() {
  heading('Approving it, which is what lets it be billed');
  if (!state.entryIds?.length) return;

  const approved = await call('/timer/entries/approve', {
    method: 'POST',
    body: { entryIds: state.entryIds },
  });
  check(
    'A manager can approve recorded time',
    ok(approved.status) && approved.body?.approved?.length === state.entryIds.length,
    `${approved.status}: ${approved.body?.approved?.length ?? 0} approved, ` +
      `${approved.body?.refused?.length ?? 0} refused`,
  );
}

async function theStatement() {
  heading('The statement, against a hand calculation');
  if (!state.project) return;

  const made = await call('/billing/statements', {
    method: 'POST',
    body: { clientId: state.project.clientId, from: '2026-09-01', to: '2026-09-30' },
  });
  if (!ok(made.status)) {
    check('A statement can be generated', false, `${made.status} ${JSON.stringify(made.body)}`);
    return;
  }
  state.statement = made.body;
  check('A statement can be generated', true, `${made.body.lines.length} lines`);

  /*
   * The hand calculation.
   *
   * The client's rate comes off the statement itself — this run does not set
   * rates — but everything after that is arithmetic done here. Hours are
   * counted in seconds and the money in fils, so there is no rounding to
   * argue about until the very last step.
   */
  const ours = state.statement.lines.filter((line) =>
    state.sittings.some((sitting) => line.performedOn === sitting.day),
  );
  const rate = ours.find((line) => line.perHour)?.perHour?.minorUnits ?? null;

  if (rate === null) {
    check('The statement prices the work at the client rate', false, 'no hourly line to check');
  } else {
    const seconds = ours.reduce((total, line) => total + line.workedSeconds, 0);
    // 16,200 seconds is 4.5 hours; at the client's rate, to the fils.
    const byHand = Math.round((seconds * rate) / 3600);
    const onScreen = ours.reduce((total, line) => total + line.amount.minorUnits, 0);
    check(
      'Every line equals its hours times the rate that applied',
      byHand === onScreen,
      `by hand ${money(byHand)}, statement ${money(onScreen)} ` +
        `(${(seconds / 3600).toFixed(2)}h at ${money(rate)})`,
    );
  }

  const linesTotal = state.statement.lines.reduce(
    (total, line) => total + line.amount.minorUnits,
    0,
  );
  check(
    'The statement total is the sum of its lines',
    linesTotal === state.statement.total.minorUnits,
    `lines ${money(linesTotal)}, total ${money(state.statement.total.minorUnits)}`,
  );
}

async function reviewing() {
  heading('Reviewing it: every change carries a reason');
  if (!state.statement) return;

  const line = state.statement.lines[0];
  const withoutReason = await call(
    `/billing/statements/${state.statement.id}/lines/${line.id}/revise`,
    { method: 'POST', body: { reason: '' } },
  );
  check(
    'A revision with no reason is refused',
    !ok(withoutReason.status),
    `${withoutReason.status}`,
  );

  const before = state.statement.total.minorUnits;
  const adjusted = await call(`/billing/statements/${state.statement.id}/lines/${line.id}/revise`, {
    method: 'POST',
    body: { reason: 'Acceptance run: agreed a lower figure', adjustToMinor: 10_000 },
  });
  if (!ok(adjusted.status)) {
    check('A line can be adjusted, with a reason', false, `${adjusted.status}`);
    return;
  }
  state.statement = adjusted.body;

  // The total has to move by exactly the difference, and by nothing else.
  const expected = before - line.amount.minorUnits + 10_000;
  check(
    'Adjusting a line moves the total by exactly the difference',
    state.statement.total.minorUnits === expected,
    `was ${money(before)}, now ${money(state.statement.total.minorUnits)}, expected ${money(expected)}`,
  );
  check(
    'The original is still on the document beside the new figure',
    state.statement.lines[0]?.asWorked.minorUnits === line.amount.minorUnits,
    `as worked ${money(state.statement.lines[0]?.asWorked?.minorUnits ?? 0)}`,
  );
}

async function theInvoice() {
  heading('The invoice');
  if (!state.statement) return;

  const approved = await call(`/billing/statements/${state.statement.id}/approve`, {
    method: 'POST',
  });
  check('A statement can be approved', ok(approved.status), `${approved.status}`);

  const raised = await call(`/billing/statements/${state.statement.id}/invoice`, {
    method: 'POST',
  });
  if (!ok(raised.status)) {
    check('An approved statement becomes an invoice', false, `${raised.status}`);
    return;
  }
  state.invoice = raised.body;
  check('An approved statement becomes an invoice', true, `number ${raised.body.number}`);

  const lines = state.invoice.lines.reduce((total, line) => total + line.amount.minorUnits, 0);
  const vat = Math.round((lines * state.invoice.vatBasisPoints) / 10_000);
  check(
    'Net, VAT and total agree with the lines',
    state.invoice.net.minorUnits === lines &&
      state.invoice.vat.minorUnits === vat &&
      state.invoice.total.minorUnits === lines + vat,
    `net ${money(state.invoice.net.minorUnits)}, VAT ${money(state.invoice.vat.minorUnits)} ` +
      `at ${state.invoice.vatBasisPoints} bp, total ${money(state.invoice.total.minorUnits)}`,
  );
  check(
    'The invoice equals the statement it came from',
    state.invoice.net.minorUnits === state.statement.total.minorUnits,
    `statement ${money(state.statement.total.minorUnits)}, invoice net ${money(state.invoice.net.minorUnits)}`,
  );

  const again = await call(`/billing/statements/${state.statement.id}/invoice`, { method: 'POST' });
  check(
    'The same statement cannot be invoiced twice',
    !ok(again.status),
    `${again.status} on the second attempt`,
  );
}

async function frozenHours() {
  heading('Invoiced hours can no longer be edited (FR-26)');
  if (!state.invoice || !state.entryIds?.length) return;

  const edited = await call('/timer/entries', {
    method: 'POST',
    body: {
      projectId: state.project.id,
      startedAt: '2026-09-03T09:00',
      endedAt: '2026-09-03T11:30',
      reason: `${RUN} — recording after the bill`,
      billable: true,
    },
  });
  // Recording *new* time is always allowed; what must not move is the hours
  // already on a document.
  check(
    'New time can still be recorded on a billed project',
    ok(edited.status),
    `${edited.status}`,
  );

  const approvedAgain = await call('/timer/entries/approve', {
    method: 'POST',
    body: { entryIds: state.entryIds },
  });
  const refusals = approvedAgain.body?.refused ?? [];
  check(
    'Time already on a statement cannot be approved again',
    refusals.length === state.entryIds.length,
    refusals[0]?.because ?? 'it was allowed through',
  );
}

async function payment() {
  heading('Payment');
  if (!state.invoice) return;

  const total = state.invoice.total.minorUnits;
  const part = Math.floor(total / 2);

  const first = await call(`/billing/invoices/${state.invoice.id}/payments`, {
    method: 'POST',
    body: { amountMinor: part, receivedOn: '2026-10-01', method: 'bank_transfer' },
  });
  check(
    'A part payment leaves the rest outstanding',
    ok(first.status) &&
      first.body?.status === 'part_paid' &&
      first.body?.balance?.minorUnits === total - part,
    `${first.status}: ${first.body?.status}, owing ${money(first.body?.balance?.minorUnits ?? -1)}`,
  );

  const second = await call(`/billing/invoices/${state.invoice.id}/payments`, {
    method: 'POST',
    body: { amountMinor: total - part, receivedOn: '2026-10-02', method: 'bank_transfer' },
  });
  check(
    'The rest settles it, to the fils',
    ok(second.status) && second.body?.status === 'paid' && second.body?.balance?.minorUnits === 0,
    `${second.status}: ${second.body?.status}, owing ${money(second.body?.balance?.minorUnits ?? -1)}`,
  );
}

async function reports() {
  heading('The reports, against the same arithmetic');
  if (!state.project) return;

  const hours = (await call('/billing/reports/hours?from=2026-09-01&to=2026-09-30&by=client')).body;
  const row = hours?.rows?.find((candidate) => candidate.key === state.project.clientId);
  check(
    'The hours report splits recorded time into billed and unbilled',
    Boolean(row) && row.recordedSeconds === row.billedSeconds + row.unbilledSeconds,
    row
      ? `recorded ${row.recordedSeconds}s = billed ${row.billedSeconds}s + unbilled ${row.unbilledSeconds}s`
      : 'no row for this client',
  );

  const profit = (await call('/billing/reports/profitability?from=2026-09-01&to=2026-09-30')).body;
  const client = profit?.rows?.find((candidate) => candidate.clientId === state.project.clientId);
  if (!client) {
    check('Profitability reports what an hour actually earned', false, 'no row for this client');
    return;
  }

  // Net over hours, worked out here: the report must not be dividing by
  // something else, or by gross.
  const byHand =
    client.recordedSeconds > 0
      ? Math.round((client.netInvoiced.minorUnits * 3600) / client.recordedSeconds)
      : null;
  check(
    'The effective hourly rate is the net fee over the hours',
    client.effectivePerHour?.minorUnits === byHand,
    `by hand ${byHand === null ? 'none' : money(byHand)}, report ${
      client.effectivePerHour ? money(client.effectivePerHour.minorUnits) : 'none'
    }`,
  );
  check(
    'What is outstanding is measured against the VAT-inclusive total',
    client.outstanding.minorUnits ===
      Math.max(0, client.grossInvoiced.minorUnits - client.paid.minorUnits),
    `gross ${money(client.grossInvoiced.minorUnits)} − paid ${money(client.paid.minorUnits)} ` +
      `= ${money(client.outstanding.minorUnits)}`,
  );
}

async function theDocument() {
  heading('What the client receives');
  const profile = await call('/billing/documents/profile');
  check(
    'The document profile is served from configuration',
    ok(profile.status) && Boolean(profile.body?.legalName),
    `${profile.status}: ${profile.body?.legalName ?? 'nothing'}`,
  );
  check(
    'Bank details are configured on this server',
    Boolean(profile.body?.bank?.iban),
    profile.body?.bank?.iban
      ? 'set (not printed here)'
      : 'not set — the invoice will print ______ where the IBAN belongs',
  );

  if (!state.invoice) return;
  const line = state.invoice.lines[0];
  check(
    'Each invoice line carries the quantity and rate the document prints',
    Boolean(line) && line.quantityCenti > 0 && line.unitRate !== null,
    line
      ? `qty ${line.quantityCenti / 100}, rate ${money(line.unitRate?.minorUnits ?? 0)}`
      : 'no lines',
  );
}

async function run() {
  console.log(`Phase 2 acceptance run against ${BASE}`);
  if (!(await signingIn())) return finish();

  for (const section of [
    recordingTime,
    approving,
    theStatement,
    reviewing,
    theInvoice,
    frozenHours,
    payment,
    reports,
    theDocument,
  ]) {
    await section();
  }

  finish();
}

function finish() {
  const failed = results.filter((result) => !result.passed);
  console.log(`\n${results.length - failed.length} of ${results.length} passed`);

  console.log('\nWhat this run cannot check');
  for (const line of [
    "A real client's figures. This ran against whatever the database held; the arithmetic is checked, the data is not the firm's.",
    'The printed sheet. The layout is checked by tests and by eye in a browser, not by this script, and nothing here can operate a printer.',
    "That the numbering continues the firm's own sequence. The next number is configuration and only the firm knows what it issued by hand.",
    'A reprint after the firm changes bank, which would show the new account: the profile is not snapshotted onto the invoice yet.',
  ]) {
    console.log(`  - ${line}`);
  }

  process.exit(failed.length === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(`\nThe run stopped: ${error.message}`);
  process.exit(1);
});

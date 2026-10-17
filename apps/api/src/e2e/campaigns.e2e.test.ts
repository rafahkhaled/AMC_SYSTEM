import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Session, type TestApp, bootTestApp } from '../testing/test-app.js';

/**
 * Advertising campaigns, and the enquiries they bring in.
 *
 * What the firm wants to be able to say is "the Instagram campaign cost this and
 * brought that many clients". Each step here is one the answer depends on: the
 * channel being a list the firm edits, the enquiry pointing at the campaign, and
 * the count following an enquiry all the way to a client.
 */
describe('campaigns', () => {
  let t: TestApp;
  let manager: Session;
  let accountant: Session;
  let dataEntry: Session;
  let campaignId: string;

  const start = {
    name: 'Ramadan offer',
    typeCode: 'instagram',
    startsOn: '2026-10-01',
    durationDays: 30,
    notes: 'Stories and reels',
    status: 'active',
    costMinor: 450_000,
  };

  beforeAll(async () => {
    t = await bootTestApp();
    manager = await t.as('manager');
    accountant = await t.as('accountant');
    dataEntry = await t.as('data_entry');
  });
  afterAll(async () => {
    await t.close();
  });

  it('offers WhatsApp, Instagram and the other channels from the start', async () => {
    const types = await manager.get('/lists/campaign_type').expect(200);
    const codes = JSON.stringify(types.body);
    for (const code of ['whatsapp', 'instagram', 'facebook', 'google']) {
      expect(codes).toContain(code);
    }
  });

  it('records a campaign with its channel, dates, salesperson, notes, status and cost', async () => {
    const created = await manager
      .post('/campaigns')
      .send({ ...start, salespersonId: accountant.userId })
      .expect(201);
    campaignId = created.body.id;

    expect(created.body).toMatchObject({
      name: 'Ramadan offer',
      typeCode: 'instagram',
      startsOn: '2026-10-01',
      durationDays: 30,
      endsOn: '2026-10-30',
      salespersonId: accountant.userId,
      status: 'active',
      costMinor: 450_000,
      currency: 'AED',
      leads: 0,
      clients: 0,
    });
    expect(created.body.salespersonName).toBeTruthy();
  });

  it('is for the manager to create and change, and for everyone signed in to read', async () => {
    await accountant.post('/campaigns').send(start).expect(403);
    await dataEntry.patch(`/campaigns/${campaignId}`).send({ costMinor: 1 }).expect(403);
    const seen = await accountant.get('/campaigns').expect(200);
    expect(seen.body.campaigns.map((c: { id: string }) => c.id)).toContain(campaignId);
    await t.anonymous().get('/campaigns').expect(401);
  });

  it('refuses what is not a campaign', async () => {
    await manager
      .post('/campaigns')
      .send({ ...start, name: '' })
      .expect(400);
    await manager
      .post('/campaigns')
      .send({ ...start, startsOn: 'next week' })
      .expect(400);
    await manager
      .post('/campaigns')
      .send({ ...start, costMinor: -5 })
      .expect(400);
    await manager
      .post('/campaigns')
      .send({ ...start, durationDays: 0 })
      .expect(400);
    await manager
      .post('/campaigns')
      .send({ ...start, typeCode: 'carrier_pigeon' })
      .expect(409);
    await manager
      .post('/campaigns')
      .send({ ...start, salespersonId: 'nobody' })
      .expect(409);
  });

  it('accepts a channel added in Settings, from the moment it is added', async () => {
    await manager
      .post('/lists/campaign_type')
      .send({ code: 'tiktok', nameEn: 'TikTok', nameAr: 'تيك توك' })
      .expect(201);
    await manager
      .post('/campaigns')
      .send({ ...start, name: 'Clips', typeCode: 'tiktok' })
      .expect(201);

    await manager.patch('/lists/campaign_type/tiktok').send({ retired: true }).expect(200);
    await manager
      .post('/campaigns')
      .send({ ...start, name: 'More clips', typeCode: 'tiktok' })
      .expect(409);
  });

  it('changes only what was sent, and clears a field sent as null', async () => {
    const changed = await manager
      .patch(`/campaigns/${campaignId}`)
      .send({ costMinor: 600_000, status: 'ended', durationDays: null })
      .expect(200);
    expect(changed.body).toMatchObject({
      costMinor: 600_000,
      status: 'ended',
      durationDays: null,
      endsOn: null,
      name: 'Ramadan offer',
      notes: 'Stories and reels',
    });
    await manager.patch('/campaigns/missing').send({ costMinor: 1 }).expect(404);
    await manager.patch(`/campaigns/${campaignId}`).send({ status: 'paused' }).expect(400);
  });

  describe('what it brought in', () => {
    const capture = (name: string, over: Record<string, unknown> = {}) =>
      manager
        .post('/leads')
        .send({ name, phone: '+971501234567', source: 'advertisement', ...over });
    const leadId = (
      board: { body: { columns: { leads: { id: string; name: string }[] }[] } },
      name: string,
    ) => board.body.columns.flatMap((c) => c.leads).find((l) => l.name === name)?.id;

    it('attributes an enquiry to a campaign, and refuses one that does not exist', async () => {
      const board = await capture('Saif Trading', { campaignId }).expect(201);
      const lead = board.body.columns
        .flatMap((c: { leads: { name: string; campaignId: string | null }[] }) => c.leads)
        .find((l: { name: string }) => l.name === 'Saif Trading');
      expect(lead.campaignId).toBe(campaignId);

      const refused = await capture('Ghost Ltd', { campaignId: 'no-such-campaign' }).expect(400);
      expect(refused.body.error.message).toContain('campaign');
    });

    it('counts enquiries, then the ones that became clients', async () => {
      const second = await capture('Noor Clinic', { campaignId }).expect(201);
      await capture('Walk-in, no campaign').expect(201);

      let row = (await manager.get('/campaigns').expect(200)).body.campaigns.find(
        (c: { id: string }) => c.id === campaignId,
      );
      expect(row).toMatchObject({ leads: 2, clients: 0 });

      const id = leadId(second, 'Noor Clinic');
      await manager.post(`/leads/${id}/move`).send({ to: 'contacted' }).expect(201);
      await manager.post(`/leads/${id}/quote`).send({ legalName: 'Noor Clinic LLC' }).expect(201);
      await manager.post(`/leads/${id}/convert`).send({ legalName: 'Noor Clinic LLC' }).expect(201);

      row = (await manager.get('/campaigns').expect(200)).body.campaigns.find(
        (c: { id: string }) => c.id === campaignId,
      );
      expect(row).toMatchObject({ leads: 2, clients: 1 });
    });
  });

  it('writes who added and changed a campaign, and what it cost, to the audit log', async () => {
    const rows = await t.sql<{ action: string; after: unknown }[]>`
      SELECT action, after FROM audit_log WHERE action LIKE 'campaigns.campaign.%'
    `;
    const actions = rows.map((row) => row.action);
    expect(actions).toContain('campaigns.campaign.added');
    expect(actions).toContain('campaigns.campaign.changed');
    expect(JSON.stringify(rows)).toContain('600000');
  });
});

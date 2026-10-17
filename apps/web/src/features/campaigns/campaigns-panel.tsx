import type { CampaignView } from '@amc/contracts';
import { campaignStatuses } from '@amc/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Badge, Button, Card, Field, Loading, Select } from '../../design/index.js';
import { formatMoney, minorUnitsFrom } from '../billing/money.js';
import { useOptions } from '../lists/use-options.js';
import { staffDirectory } from '../staff/api.js';
import { addCampaign, changeCampaign } from './api.js';
import { useCampaigns } from './use-campaigns.js';

const TONES = { planned: 'neutral', active: 'success', ended: 'warning' } as const;

/**
 * The firm's advertising campaigns (the "campaign type" table in the project
 * notes): what ran, on which channel, who ran it, what it cost, and how many
 * enquiries and clients it brought in.
 */
export function CampaignsPanel() {
  const { t, i18n } = useTranslation();
  const types = useOptions('campaign_type');
  const { all, loading } = useCampaigns();
  const [editing, setEditing] = useState<CampaignView | 'new' | null>(null);

  if (loading) return <Loading label={t('loading')} />;

  return (
    <>
      {editing ? (
        <CampaignForm
          // Keyed so opening a different campaign starts from that campaign.
          key={editing === 'new' ? 'new' : editing.id}
          campaign={editing === 'new' ? null : editing}
          onDone={() => setEditing(null)}
        />
      ) : (
        <div className="u-row">
          <Button onClick={() => setEditing('new')}>{t('campaigns.add')}</Button>
        </div>
      )}

      <Card title={t('campaigns.title')} description={t('campaigns.hint')}>
        {all.length === 0 ? (
          <p className="u-text-faint">{t('campaigns.none')}</p>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t('campaigns.name')}</th>
                  <th scope="col">{t('campaigns.type')}</th>
                  <th scope="col">{t('campaigns.runs')}</th>
                  <th scope="col">{t('campaigns.salesperson')}</th>
                  <th scope="col">{t('campaigns.cost')}</th>
                  <th scope="col">{t('campaigns.brought')}</th>
                  <th scope="col">{t('settings.manage')}</th>
                </tr>
              </thead>
              <tbody>
                {all.map((campaign) => (
                  <tr key={campaign.id}>
                    <th scope="row" className="u-typed">
                      {campaign.name}
                      <span className="u-block">
                        <Badge tone={TONES[campaign.status]}>
                          {t(`campaigns.statuses.${campaign.status}`)}
                        </Badge>
                      </span>
                    </th>
                    <td>{types.label(campaign.typeCode)}</td>
                    <td className="u-ltr u-numeric">
                      {campaign.startsOn}
                      {campaign.endsOn ? ` → ${campaign.endsOn}` : ''}
                    </td>
                    <td>{campaign.salespersonName ?? '—'}</td>
                    <td className="u-numeric">
                      {formatMoney(
                        { minorUnits: campaign.costMinor, currency: campaign.currency },
                        i18n.language,
                      )}
                    </td>
                    <td className="u-numeric">
                      {t('campaigns.broughtIn', {
                        leads: campaign.leads,
                        clients: campaign.clients,
                      })}
                    </td>
                    <td>
                      <Button small tone="secondary" onClick={() => setEditing(campaign)}>
                        {t('services.admin.edit')}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

function CampaignForm({ campaign, onDone }: { campaign: CampaignView | null; onDone: () => void }) {
  const { t } = useTranslation();
  const queries = useQueryClient();
  const types = useOptions('campaign_type');
  const staff = useQuery({ queryKey: ['staff'], queryFn: staffDirectory });

  const [name, setName] = useState(campaign?.name ?? '');
  const [typeCode, setTypeCode] = useState(campaign?.typeCode ?? types.live[0]?.code ?? '');
  const [startsOn, setStartsOn] = useState(
    campaign?.startsOn ?? new Date().toISOString().slice(0, 10),
  );
  const [duration, setDuration] = useState(
    campaign?.durationDays ? String(campaign.durationDays) : '',
  );
  const [salesperson, setSalesperson] = useState(campaign?.salespersonId ?? '');
  const [notes, setNotes] = useState(campaign?.notes ?? '');
  const [status, setStatus] = useState<CampaignView['status']>(campaign?.status ?? 'planned');
  const [cost, setCost] = useState(campaign ? (campaign.costMinor / 100).toFixed(2) : '0');

  const costMinor = minorUnitsFrom(cost);
  const durationDays = duration.trim() === '' ? null : Number(duration);
  const ready =
    name.trim() !== '' &&
    typeCode !== '' &&
    costMinor !== null &&
    (durationDays === null || (Number.isInteger(durationDays) && durationDays > 0));

  const save = useMutation({
    mutationFn: () => {
      if (costMinor === null) throw new Error(t('campaigns.badCost'));
      const body = {
        name: name.trim(),
        typeCode,
        startsOn,
        status,
        costMinor,
        notes: notes.trim() === '' ? null : notes.trim(),
        durationDays,
        salespersonId: salesperson === '' ? null : salesperson,
      };
      if (campaign) return changeCampaign(campaign.id, body);
      return addCampaign({
        name: body.name,
        typeCode,
        startsOn,
        status,
        costMinor,
        ...(body.notes ? { notes: body.notes } : {}),
        ...(durationDays ? { durationDays } : {}),
        ...(salesperson ? { salespersonId: salesperson } : {}),
      });
    },
    onSuccess: () => {
      void queries.invalidateQueries({ queryKey: ['campaigns'] });
      onDone();
    },
  });

  return (
    <Card title={campaign ? t('campaigns.edit') : t('campaigns.add')}>
      <form
        className="u-stack-tight"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) save.mutate();
        }}
      >
        <Field label={t('campaigns.name')} value={name} onChange={(e) => setName(e.target.value)} />
        <Field
          label={t('campaigns.type')}
          control={(props) => (
            <Select {...props} value={typeCode} onChange={(e) => setTypeCode(e.target.value)}>
              {types.live.map((option) => (
                <option key={option.code} value={option.code}>
                  {types.label(option.code)}
                </option>
              ))}
              {/* A type since retired still shows on the campaigns that used it. */}
              {typeCode && !types.live.some((option) => option.code === typeCode) ? (
                <option value={typeCode}>{types.label(typeCode)}</option>
              ) : null}
            </Select>
          )}
        />
        <div className="u-row u-row-top">
          <Field
            label={t('campaigns.startsOn')}
            ltr
            type="date"
            value={startsOn}
            onChange={(e) => setStartsOn(e.target.value)}
          />
          <Field
            label={t('campaigns.duration')}
            ltr
            inputMode="numeric"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          />
        </div>
        <Field
          label={t('campaigns.salesperson')}
          control={(props) => (
            <Select {...props} value={salesperson} onChange={(e) => setSalesperson(e.target.value)}>
              <option value="">{t('campaigns.nobody')}</option>
              {(staff.data ?? []).map((person) => (
                <option key={person.id} value={person.id}>
                  {person.displayName}
                </option>
              ))}
            </Select>
          )}
        />
        <div className="u-row u-row-top">
          <Field
            label={t('campaigns.status')}
            control={(props) => (
              <Select
                {...props}
                value={status}
                onChange={(e) => setStatus(e.target.value as CampaignView['status'])}
              >
                {campaignStatuses.map((value) => (
                  <option key={value} value={value}>
                    {t(`campaigns.statuses.${value}`)}
                  </option>
                ))}
              </Select>
            )}
          />
          <Field
            label={t('campaigns.cost')}
            ltr
            inputMode="decimal"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            {...(costMinor === null ? { error: t('campaigns.badCost') } : {})}
          />
        </div>
        <Field
          label={t('campaigns.notes')}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />

        {save.isError ? <Alert tone="error">{(save.error as Error).message}</Alert> : null}
        <div className="u-row">
          <Button type="submit" disabled={!ready} busy={save.isPending}>
            {t('campaigns.save')}
          </Button>
          <Button type="button" tone="quiet" onClick={onDone}>
            {t('clients.cancel')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

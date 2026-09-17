import type { LeadBoard, LeadView } from '@amc/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Badge, Button, Card, Empty, Field, Loading } from '../../design/index.js';
import { captureLead, convertLead, leadBoard, moveLead } from './api.js';

const SOURCES = ['whatsapp', 'phone', 'referral', 'advertisement', 'walk_in', 'other'] as const;

/**
 * The enquiry pipeline (FR-01).
 *
 * Confirmed is absent from the board and declined is present, which looks
 * backwards until you ask what the board is for. A confirmed enquiry has
 * become a client and lives on the clients list; a declined one is worth
 * seeing for a while, because it is the column that says what is being lost.
 */
export function LeadsBoard({ onOpenClient }: { onOpenClient: (clientId: string) => void }) {
  const { t } = useTranslation();
  const queries = useQueryClient();
  const board = useQuery({ queryKey: ['leads'], queryFn: leadBoard });
  const settle = (next: LeadBoard) => queries.setQueryData(['leads'], next);

  if (board.isLoading) return <Loading label={t('loading')} />;
  if (board.isError) return <p className="alert alert--error">{t('leads.failed')}</p>;

  const columns = board.data?.columns ?? [];
  const total = columns.reduce((count, column) => count + column.leads.length, 0);

  return (
    <div className="u-stack">
      <CaptureLead onCaptured={settle} />

      {total === 0 ? (
        <Card title={t('leads.title')}>
          <Empty title={t('leads.none')} description={t('leads.noneHint')} />
        </Card>
      ) : (
        <div className="board">
          {columns.map((column) => (
            <section key={column.status} className="board__column">
              <header className="board__heading">
                <h2>{t(`leads.statuses.${column.status}`)}</h2>
                <span className="u-text-faint u-numeric">{column.leads.length}</span>
              </header>
              {column.leads.length === 0 ? (
                <p className="board__quiet">{t('tasks.columnEmpty')}</p>
              ) : (
                column.leads.map((lead) => (
                  <LeadCard
                    key={lead.id}
                    lead={lead}
                    onChanged={settle}
                    onConverted={onOpenClient}
                  />
                ))
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function LeadCard({
  lead,
  onChanged,
  onConverted,
}: {
  lead: LeadView;
  onChanged: (board: LeadBoard) => void;
  onConverted: (clientId: string) => void;
}) {
  const { t } = useTranslation();
  const [converting, setConverting] = useState(false);
  const [legalName, setLegalName] = useState(lead.name);

  const move = useMutation({
    mutationFn: (to: string) => moveLead(lead.id, to),
    onSuccess: onChanged,
  });
  const convert = useMutation({
    mutationFn: () => convertLead(lead.id, legalName.trim()),
    onSuccess: (result) => {
      onChanged(result.board);
      onConverted(result.clientId);
    },
  });

  /*
   * How long it has been sitting, not when it arrived. "Eight days" is the
   * number somebody acts on; a date is one they would have to subtract from.
   */
  const waiting =
    lead.waitingDays === 0 ? t('leads.today') : t('leads.waiting', { count: lead.waitingDays });

  return (
    <div className="task-card lead-card">
      <strong className="task-card__client">{lead.name}</strong>
      {lead.requestedService ? <span className="u-text-soft">{lead.requestedService}</span> : null}
      <span className="u-text-faint u-ltr">{lead.phone ?? lead.email}</span>

      <div className="task-card__marks">
        <Badge>{t(`leads.sources.${lead.source}`)}</Badge>
        <span className={lead.waitingDays >= 7 ? 'u-danger' : 'u-text-faint'}>{waiting}</span>
      </div>

      {lead.sourceDetail ? <span className="u-text-faint">{lead.sourceDetail}</span> : null}
      {lead.notes ? <span className="u-text-faint">{lead.notes}</span> : null}

      <div className="u-row u-wrap">
        {lead.allowedNext.map((status) => (
          <Button
            key={status}
            small
            tone={status === 'declined' ? 'quiet' : 'secondary'}
            busy={move.isPending}
            onClick={() => move.mutate(status)}
          >
            {t(`leads.statuses.${status}`)}
          </Button>
        ))}
        {lead.status === 'quoted' ? (
          <Button small onClick={() => setConverting(!converting)}>
            {t('leads.convert')}
          </Button>
        ) : null}
      </div>

      {converting ? (
        <form
          className="u-stack-tight lead-card__convert"
          onSubmit={(event) => {
            event.preventDefault();
            if (legalName.trim()) convert.mutate();
          }}
        >
          <Field
            label={t('leads.legalName')}
            hint={t('leads.legalNameHint')}
            value={legalName}
            onChange={(event) => setLegalName(event.target.value)}
          />
          <div className="u-row">
            <Button type="submit" small disabled={!legalName.trim()} busy={convert.isPending}>
              {t('leads.makeClient')}
            </Button>
            <Button type="button" small tone="quiet" onClick={() => setConverting(false)}>
              {t('documents.clear')}
            </Button>
          </div>
        </form>
      ) : null}

      {move.error || convert.error ? (
        <Alert tone="error">{(move.error ?? convert.error)?.message}</Alert>
      ) : null}
    </div>
  );
}

function CaptureLead({ onCaptured }: { onCaptured: (board: LeadBoard) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [source, setSource] = useState('whatsapp');
  const [sourceDetail, setSourceDetail] = useState('');
  const [requestedService, setRequestedService] = useState('');

  const capture = useMutation({
    mutationFn: () =>
      captureLead({
        name: name.trim(),
        ...(phone.trim() ? { phone: phone.trim() } : {}),
        ...(email.trim() ? { email: email.trim() } : {}),
        source,
        ...(sourceDetail.trim() ? { sourceDetail: sourceDetail.trim() } : {}),
        ...(requestedService.trim() ? { requestedService: requestedService.trim() } : {}),
      }),
    onSuccess: (board) => {
      onCaptured(board);
      setOpen(false);
      setName('');
      setPhone('');
      setEmail('');
      setSourceDetail('');
      setRequestedService('');
    },
  });

  if (!open) {
    return (
      <div className="u-row">
        <Button small tone="secondary" onClick={() => setOpen(true)}>
          {t('leads.add')}
        </Button>
      </div>
    );
  }

  // Somebody has to be reachable, or the enquiry cannot be followed up and is
  // not really an enquiry. The server refuses it too.
  const ready = name.trim().length > 0 && (phone.trim().length > 0 || email.trim().length > 0);

  return (
    <Card title={t('leads.add')} description={t('leads.addHint')}>
      <form
        className="u-stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) capture.mutate();
        }}
      >
        <Field label={t('leads.name')} value={name} onChange={(e) => setName(e.target.value)} />
        <div className="u-row u-row-top">
          <Field
            label={t('leads.phone')}
            ltr
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <Field
            label={t('leads.email')}
            ltr
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="u-row u-row-top">
          <Field
            label={t('leads.source')}
            control={(props) => (
              <select
                {...props}
                className="input"
                value={source}
                onChange={(e) => setSource(e.target.value)}
              >
                {SOURCES.map((code) => (
                  <option key={code} value={code}>
                    {t(`leads.sources.${code}`)}
                  </option>
                ))}
              </select>
            )}
          />
          <Field
            label={t('leads.sourceDetail')}
            value={sourceDetail}
            onChange={(e) => setSourceDetail(e.target.value)}
          />
        </div>
        <Field
          label={t('leads.wants')}
          value={requestedService}
          onChange={(e) => setRequestedService(e.target.value)}
        />

        {capture.error ? <Alert tone="error">{capture.error.message}</Alert> : null}

        <div className="u-row">
          <Button type="submit" disabled={!ready} busy={capture.isPending}>
            {t('leads.save')}
          </Button>
          <Button type="button" tone="quiet" onClick={() => setOpen(false)}>
            {t('documents.clear')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

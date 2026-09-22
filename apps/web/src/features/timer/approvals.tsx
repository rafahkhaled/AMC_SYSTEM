import type { PendingApproval } from '@amc/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Card, Empty, Loading } from '../../design/index.js';
import { duration } from '../../lib/duration.js';
import { approveEntries, pendingApprovals } from './api.js';

/**
 * The step between a timesheet and a bill (FR-23).
 *
 * Nothing reaches a client statement until somebody senior has looked at it,
 * which is what stops a mistyped eleven-hour afternoon being invoiced before
 * anyone notices. Everybody's hours, not the manager's own: a timesheet is
 * deliberately private and this is the one screen that is not.
 *
 * Oldest first, because unapproved time is unbillable time and the hours
 * waiting longest are the ones closest to being written off by accident.
 */
export function ApprovalsPanel() {
  const { t } = useTranslation();
  const queries = useQueryClient();
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());

  const queue = useQuery({ queryKey: ['approvals'], queryFn: pendingApprovals });

  const approve = useMutation({
    mutationFn: (entryIds: string[]) => approveEntries(entryIds),
    onSuccess: () => {
      setChosen(new Set());
      void queries.invalidateQueries({ queryKey: ['approvals'] });
      // The hours have moved; anything counting them has to look again.
      void queries.invalidateQueries({ queryKey: ['timesheet'] });
    },
  });

  const entries = queue.data ?? [];

  function toggle(id: string) {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setChosen(next);
  }

  return (
    <Card title={t('timer.approvals.title')} description={t('timer.approvals.hint')}>
      {queue.isLoading ? <Loading label={t('loading')} /> : null}
      {queue.isError ? <Alert tone="error">{t('timer.approvals.failed')}</Alert> : null}
      {queue.data && entries.length === 0 ? (
        <Empty title={t('timer.approvals.none')} description={t('timer.approvals.noneHint')} />
      ) : null}

      {entries.length > 0 ? (
        <>
          <div className="u-row">
            <Button
              small
              busy={approve.isPending}
              disabled={chosen.size === 0}
              onClick={() => approve.mutate([...chosen])}
            >
              {t('timer.approvals.approve', { count: chosen.size })}
            </Button>
            <Button
              small
              tone="quiet"
              onClick={() =>
                setChosen(
                  chosen.size === entries.length
                    ? new Set()
                    : new Set(entries.map((entry) => entry.id)),
                )
              }
            >
              {chosen.size === entries.length
                ? t('timer.approvals.chooseNone')
                : t('timer.approvals.chooseAll')}
            </Button>
          </div>

          {/*
           * What came back refused, in the words the server used. A bulk
           * approval that silently does nine of ten is worse than one that
           * says which one it would not touch.
           */}
          {approve.data && approve.data.refused.length > 0 ? (
            <Alert tone="warning">
              {t('timer.approvals.someRefused', { count: approve.data.refused.length })}
              {': '}
              {approve.data.refused.map((one) => one.because).join(' · ')}
            </Alert>
          ) : null}
          {approve.isError ? <Alert tone="error">{(approve.error as Error).message}</Alert> : null}

          <div className="u-stack-tight">
            {entries.map((entry) => (
              <ApprovalRow
                key={entry.id}
                entry={entry}
                chosen={chosen.has(entry.id)}
                onToggle={() => toggle(entry.id)}
              />
            ))}
          </div>
        </>
      ) : null}
    </Card>
  );
}

function ApprovalRow({
  entry,
  chosen,
  onToggle,
}: {
  entry: PendingApproval;
  chosen: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();

  return (
    <label className={`approval${chosen ? ' approval--chosen' : ''}`}>
      <input type="checkbox" checked={chosen} onChange={onToggle} />
      <span className="row__main">
        <strong>{entry.clientName}</strong>
        <span className="u-text-faint">
          {entry.userName}
          {' · '}
          {t(`services.${entry.service}`)}
          {' · '}
          <span className="u-ltr">{entry.day}</span>
        </span>
        {/* The reason is required on a manual entry, and it is the thing a
            manager is actually reading before saying yes. */}
        {entry.reason ? <span className="u-text-soft">{entry.reason}</span> : null}
      </span>

      <span className="u-row u-row--tight">
        {entry.reviewReason ? (
          <span className="u-warn">{t(`timer.review.${entry.reviewReason}`)}</span>
        ) : null}
        {entry.billable ? null : (
          <span className="u-text-faint">{t('timer.approvals.notBillable')}</span>
        )}
        <span className="u-numeric">{duration(entry.seconds, t)}</span>
      </span>
    </label>
  );
}

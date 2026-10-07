import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Card, Loading } from '../../design/index.js';
import { formatMoney } from '../billing/money.js';
import { answerQuotation, openQuotation } from './api.js';

/**
 * What the client sees when they open the link they were sent (FR-30).
 *
 * The only screen in this system a person outside the practice reaches. No
 * navigation, no sign-in, nothing they can get to from here: a page with one
 * thing on it and two things to do with it.
 *
 * Every failure reads the same, because the server refuses the same way for a
 * wrong token, a lapsed link and a quotation already answered — and a page
 * that explained the difference would undo that.
 */
export function ClientQuotationPage({ token }: { token: string }) {
  const { t, i18n } = useTranslation();
  const [confirming, setConfirming] = useState<'accept' | 'decline' | null>(null);

  const quotation = useQuery({
    queryKey: ['client-quotation', token],
    queryFn: () => openQuotation(token),
    retry: false,
  });

  const answer = useMutation({
    mutationFn: (decision: 'accept' | 'decline') => answerQuotation(token, decision),
    onSuccess: (next) => {
      quotation.refetch();
      setConfirming(null);
      return next;
    },
  });

  if (quotation.isLoading) return <Loading label={t('loading')} />;
  if (quotation.isError || !quotation.data) {
    return (
      <main className="client-page">
        <Card title={t('clientLink.unavailable')}>
          <p className="u-text-soft">{t('clientLink.unavailableHint')}</p>
        </Card>
      </main>
    );
  }

  const view = quotation.data;
  const arabic = i18n.language === 'ar';

  return (
    <main className="client-page">
      {/* Who sent it. A client opening an unfamiliar link to a page of their
          own prices, with no name on it, has every reason to close the tab. */}
      <p className="client-page__firm">{view.firmName}</p>

      <Card
        title={t('clientLink.title', { reference: view.reference })}
        description={view.validUntil ? t('clientLink.validUntil', { date: view.validUntil }) : ''}
      >
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('clientLink.description')}</th>
                <th scope="col" className="table__figure">
                  {t('clientLink.amount')}
                </th>
              </tr>
            </thead>
            <tbody>
              {view.lines.map((line) => (
                <tr key={`${line.descriptionEn}${line.descriptionAr}`}>
                  {/* Whichever description the client can read. Falling back
                      rather than showing an empty cell: a line with no words
                      on it is a line they cannot agree to. */}
                  <th scope="row" className="u-typed">
                    {arabic
                      ? line.descriptionAr || line.descriptionEn
                      : line.descriptionEn || line.descriptionAr}
                    {/* What came off this line, against the line it came off.
                        It is the firm's own argument for the price and the
                        client reads a quotation line by line. */}
                    {line.discount.minorUnits > 0 ? (
                      // Its own line under the description, the way every
                      // other second line in a table cell sits: run inline it
                      // reads as part of the service's name.
                      <span className="u-block u-text-faint">
                        {t('clientLink.lessDiscount', {
                          amount: formatMoney(line.discount, i18n.language),
                        })}
                      </span>
                    ) : null}
                  </th>
                  <td className="table__figure u-numeric">
                    {formatMoney(line.chargeable, i18n.language)}
                  </td>
                </tr>
              ))}
            </tbody>
            {/*
              The breakdown above the total, and only the rows that say
              something. The client is being asked to agree to this figure,
              and a page showing one number asks them to agree to something
              they cannot check.
            */}
            <tfoot>
              {view.discount.minorUnits > 0 ? (
                <>
                  <tr>
                    <th scope="row">{t('clientLink.subtotal')}</th>
                    <td className="table__figure u-numeric">
                      {formatMoney(view.subtotal, i18n.language)}
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">{t('clientLink.discount')}</th>
                    <td className="table__figure u-numeric">
                      {formatMoney(view.discount, i18n.language)}
                    </td>
                  </tr>
                </>
              ) : null}
              {view.vat.minorUnits > 0 ? (
                <>
                  <tr>
                    <th scope="row">{t('clientLink.net')}</th>
                    <td className="table__figure u-numeric">
                      {formatMoney(view.net, i18n.language)}
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">{t('clientLink.vat')}</th>
                    <td className="table__figure u-numeric">
                      {formatMoney(view.vat, i18n.language)}
                    </td>
                  </tr>
                </>
              ) : null}
              <tr>
                <th scope="row">{t('clientLink.total')}</th>
                <td className="table__figure u-numeric">
                  {formatMoney(view.total, i18n.language)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* One paragraph either way. This used to render the Arabic notes as
            a bare string, outside the paragraph and without the class that
            gives user-typed text its own direction. */}
        {(arabic ? view.notesAr : view.notesEn) ? (
          <p className="u-text-soft u-typed">{arabic ? view.notesAr : view.notesEn}</p>
        ) : null}

        {view.state === 'accepted' ? (
          <Alert tone="success">{t('clientLink.accepted')}</Alert>
        ) : null}
        {view.state === 'declined' ? <Alert tone="info">{t('clientLink.declined')}</Alert> : null}
        {view.state === 'expired' ? <Alert tone="warning">{t('clientLink.expired')}</Alert> : null}

        {answer.isError ? <Alert tone="error">{t('clientLink.answerFailed')}</Alert> : null}

        {view.answerable ? (
          <>
            {/*
             * Asked twice, because this one is not undoable from here.
             * A client who meant to read it again and hit the wrong button
             * has no way back, and the firm finds out by being told.
             */}
            {confirming ? (
              <div className="u-stack-tight">
                <p>{t(`clientLink.confirm.${confirming}`)}</p>
                <div className="u-row">
                  <Button
                    busy={answer.isPending}
                    tone={confirming === 'accept' ? 'primary' : 'danger'}
                    onClick={() => answer.mutate(confirming)}
                  >
                    {t(`clientLink.confirmed.${confirming}`)}
                  </Button>
                  <Button tone="quiet" onClick={() => setConfirming(null)}>
                    {t('clientLink.back')}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="u-row">
                <Button onClick={() => setConfirming('accept')}>{t('clientLink.accept')}</Button>
                <Button tone="quiet" onClick={() => setConfirming('decline')}>
                  {t('clientLink.decline')}
                </Button>
              </div>
            )}
          </>
        ) : null}
      </Card>
    </main>
  );
}

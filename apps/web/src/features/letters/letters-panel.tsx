import type { Letter, LetterTemplate } from '@amc/contracts';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Card, Field, Select } from '../../design/index.js';
import { useOptions } from '../lists/use-options.js';
import { generateLetter, letterTemplates, lettersFor } from './api.js';

/**
 * Letters the firm sends, filled in from the client's record (FR-15).
 *
 * Today these are Word files somebody copies and edits by hand, which is how a
 * letter goes out with the previous client's name still in it. Nothing here is
 * clever: the point is that the name, the licence number and the tax number
 * come from the record instead of from memory.
 *
 * The result is printed rather than turned into a PDF on the server. Arabic
 * needs proper text shaping, which browsers do correctly and PDF libraries
 * mostly do not — and "print to PDF" is one keystroke in every browser the
 * practice uses.
 */
export function LettersPanel({ clientId }: { clientId: string }) {
  const { t, i18n } = useTranslation();
  const [code, setCode] = useState('');
  const [language, setLanguage] = useState<'en' | 'ar'>(i18n.language === 'ar' ? 'ar' : 'en');
  const authorities = useOptions('authority');
  const [authority, setAuthority] = useState('');
  const [letter, setLetter] = useState<Letter | null>(null);

  const templates = useQuery({ queryKey: ['letter-templates'], queryFn: letterTemplates });
  const history = useQuery({
    queryKey: ['letters', clientId],
    queryFn: () => lettersFor(clientId),
  });

  const generate = useMutation({
    mutationFn: () => generateLetter(clientId, code, language, authority || undefined),
    onSuccess: (produced) => {
      setLetter(produced);
      void history.refetch();
    },
  });

  return (
    <Card title={t('letters.title')} description={t('letters.hint')}>
      <div className="u-row u-row-top">
        <Field
          label={t('letters.which')}
          control={(props) => (
            <Select {...props} value={code} onChange={(event) => setCode(event.target.value)}>
              <option value="">{t('letters.choose')}</option>
              {(templates.data ?? []).map((template: LetterTemplate) => (
                <option key={template.code} value={template.code}>
                  {i18n.language === 'ar' ? template.nameAr : template.nameEn}
                </option>
              ))}
            </Select>
          )}
        />
        <Field
          label={t('letters.language')}
          control={(props) => (
            <Select
              {...props}
              value={language}
              onChange={(event) => setLanguage(event.target.value as 'en' | 'ar')}
            >
              <option value="ar">العربية</option>
              <option value="en">English</option>
            </Select>
          )}
        />

        {/* Who it is addressed to, so "what did we send the FTA, and when"
            has an answer six months later. */}
        <Field
          label={t('letters.authority')}
          control={(props) => (
            <Select
              {...props}
              value={authority}
              onChange={(event) => setAuthority(event.target.value)}
            >
              <option value="">{t('letters.authorityUnknown')}</option>
              {authorities.live.map((option) => (
                <option key={option.code} value={option.code}>
                  {authorities.label(option.code)}
                </option>
              ))}
            </Select>
          )}
        />
      </div>

      <div className="u-row">
        <Button disabled={code === ''} busy={generate.isPending} onClick={() => generate.mutate()}>
          {t('letters.generate')}
        </Button>
        {letter ? (
          <Button tone="secondary" onClick={() => window.print()}>
            {t('letters.print')}
          </Button>
        ) : null}
      </div>

      {generate.error ? <Alert tone="error">{generate.error.message}</Alert> : null}

      {letter ? (
        <>
          {/*
            What the letter asked for and the record could not give. Not a
            refusal — a letter with a gap is often exactly what somebody wants,
            because they are about to write the number in by hand.
          */}
          {letter.missing.length > 0 ? (
            <Alert tone="warning">
              {t('letters.missing', {
                fields: letter.missing
                  .map((name) => t(`letters.facts.${name}`))
                  .join(t('listSeparator')),
              })}
            </Alert>
          ) : null}

          <article className="letter" dir={letter.language === 'ar' ? 'rtl' : 'ltr'}>
            <h3 className="letter__title">{letter.title}</h3>
            {/*
              The body is plain text the server escaped when it filled in the
              placeholders, so it is rendered as text and never as markup.
            */}
            <pre className="letter__body">{letter.body}</pre>
          </article>
        </>
      ) : null}

      {(history.data ?? []).length > 0 ? (
        <div className="u-stack-tight">
          <span className="u-text-faint">{t('letters.previously')}</span>

          {/* A table, because the question is "what did we send the FTA, and
              when" — which is a comparison across rows, not one letter. */}
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t('letters.columns.title')}</th>
                  <th scope="col">{t('letters.columns.authority')}</th>
                  <th scope="col">{t('letters.columns.language')}</th>
                  <th scope="col">{t('letters.columns.created')}</th>
                  <th scope="col">{t('letters.columns.by')}</th>
                  <th scope="col">{t('letters.columns.open')}</th>
                </tr>
              </thead>
              <tbody>
                {(history.data ?? []).map((previous) => (
                  <tr key={previous.id}>
                    <th scope="row" className="u-typed">
                      {previous.title}
                    </th>
                    <td className="u-typed">
                      {previous.authority ? (
                        authorities.label(previous.authority)
                      ) : (
                        <span className="u-text-faint">—</span>
                      )}
                    </td>
                    <td>{previous.language === 'ar' ? 'العربية' : 'English'}</td>
                    <td>
                      <span className="u-ltr u-numeric">{previous.createdAt.slice(0, 10)}</span>
                    </td>
                    <td className="u-typed">
                      {previous.generatedBy ?? <span className="u-text-faint">—</span>}
                    </td>
                    <td>
                      <Button small tone="quiet" onClick={() => setLetter(previous)}>
                        {t('letters.open')}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

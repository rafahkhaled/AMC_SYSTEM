import type { Letter, LetterTemplate } from '@amc/contracts';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Card, Field } from '../../design/index.js';
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
  const [letter, setLetter] = useState<Letter | null>(null);

  const templates = useQuery({ queryKey: ['letter-templates'], queryFn: letterTemplates });
  const history = useQuery({
    queryKey: ['letters', clientId],
    queryFn: () => lettersFor(clientId),
  });

  const generate = useMutation({
    mutationFn: () => generateLetter(clientId, code, language),
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
            <select
              {...props}
              className="input"
              value={code}
              onChange={(event) => setCode(event.target.value)}
            >
              <option value="">{t('letters.choose')}</option>
              {(templates.data ?? []).map((template: LetterTemplate) => (
                <option key={template.code} value={template.code}>
                  {i18n.language === 'ar' ? template.nameAr : template.nameEn}
                </option>
              ))}
            </select>
          )}
        />
        <Field
          label={t('letters.language')}
          control={(props) => (
            <select
              {...props}
              className="input"
              value={language}
              onChange={(event) => setLanguage(event.target.value as 'en' | 'ar')}
            >
              <option value="ar">العربية</option>
              <option value="en">English</option>
            </select>
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
          {(history.data ?? []).slice(0, 5).map((previous) => (
            <div key={previous.id} className="line">
              <span>{previous.title}</span>
              <span className="u-text-faint">
                {previous.language === 'ar' ? 'العربية' : 'English'}
              </span>
              <span className="u-grow" />
              <span className="u-text-faint u-ltr u-numeric">
                {previous.createdAt.slice(0, 10)}
              </span>
              <Button small tone="quiet" onClick={() => setLetter(previous)}>
                {t('letters.open')}
              </Button>
            </div>
          ))}
        </div>
      ) : null}
    </Card>
  );
}

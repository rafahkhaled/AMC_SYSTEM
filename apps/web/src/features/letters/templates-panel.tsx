import { type LetterTemplateDetail, letterPlaceholders } from '@amc/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Badge, Button, Card, Field, Loading } from '../../design/index.js';
import { addLetterTemplate, changeLetterTemplate, letterTemplateDetails } from './api.js';

/**
 * The firm's own letters (feedback item 6).
 *
 * They were seeded by a migration, so adding one or fixing a sentence meant a
 * developer. The wording is the firm's and this is where it is changed. A
 * change affects the letters generated from then on; ones already produced keep
 * the text they went out with.
 */
export function LetterTemplatesPanel() {
  const { t, i18n } = useTranslation();
  const queries = useQueryClient();
  const [editing, setEditing] = useState<LetterTemplateDetail | 'new' | null>(null);
  const arabic = i18n.language === 'ar';

  const templates = useQuery({
    queryKey: ['letter-templates', 'all'],
    queryFn: letterTemplateDetails,
  });

  const retire = useMutation({
    mutationFn: ({ code, retired }: { code: string; retired: boolean }) =>
      changeLetterTemplate(code, { retired }),
    onSuccess: () => void queries.invalidateQueries({ queryKey: ['letter-templates'] }),
  });

  if (templates.isLoading) return <Loading label={t('loading')} />;
  if (templates.isError) return <Alert tone="error">{t('letterTemplates.failed')}</Alert>;

  const name = (template: LetterTemplateDetail) =>
    arabic ? template.nameAr || template.nameEn : template.nameEn || template.nameAr;

  return (
    <>
      {editing ? (
        <TemplateEditor
          // Keyed so opening a different letter starts from that letter's wording.
          key={editing === 'new' ? 'new' : editing.code}
          template={editing === 'new' ? null : editing}
          onDone={() => setEditing(null)}
        />
      ) : (
        <div className="u-row">
          <Button onClick={() => setEditing('new')}>{t('letterTemplates.add')}</Button>
        </div>
      )}

      <Card title={t('letterTemplates.title')} description={t('letterTemplates.hint')}>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('settings.name')}</th>
                <th scope="col">{t('letterTemplates.uses')}</th>
                <th scope="col">{t('settings.manage')}</th>
              </tr>
            </thead>
            <tbody>
              {(templates.data ?? []).map((template) => (
                <tr key={template.code}>
                  <th scope="row" className="u-typed">
                    {name(template)}
                    <span className="u-block u-text-faint u-typed">
                      {arabic ? template.nameEn : template.nameAr}
                    </span>
                    {template.retired ? (
                      <span className="u-block">
                        <Badge tone="neutral">{t('settings.retired')}</Badge>
                      </span>
                    ) : null}
                  </th>
                  <td className="u-text-faint u-ltr">{template.needs.length}</td>
                  <td>
                    <div className="u-row u-row--tight">
                      <Button small tone="secondary" onClick={() => setEditing(template)}>
                        {t('services.admin.edit')}
                      </Button>
                      {/*
                       * Retire, never delete: a letter already produced from it
                       * refers to it, and the record of what was sent survives.
                       */}
                      <Button
                        small
                        tone="quiet"
                        busy={retire.isPending}
                        onClick={() =>
                          retire.mutate({ code: template.code, retired: !template.retired })
                        }
                      >
                        {template.retired ? t('settings.restore') : t('settings.retire')}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {retire.isError ? <Alert tone="error">{(retire.error as Error).message}</Alert> : null}
      </Card>
    </>
  );
}

const PLACEHOLDER = /\{\{\s*([a-z_]+)\s*\}\}/g;

/** The placeholders in a body that the system will not fill in. */
function unknownIn(body: string): string[] {
  const known = new Set<string>(letterPlaceholders);
  const found = new Set<string>();
  for (const match of body.matchAll(PLACEHOLDER)) {
    const name = match[1];
    if (name && !known.has(name)) found.add(name);
  }
  return [...found];
}

function TemplateEditor({
  template,
  onDone,
}: {
  template: LetterTemplateDetail | null;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const queries = useQueryClient();

  const [nameEn, setNameEn] = useState(template?.nameEn ?? '');
  const [nameAr, setNameAr] = useState(template?.nameAr ?? '');
  const [bodyEn, setBodyEn] = useState(template?.bodyEn ?? '');
  const [bodyAr, setBodyAr] = useState(template?.bodyAr ?? '');
  /** Which body the buttons write into: the one touched last. */
  const [target, setTarget] = useState<'en' | 'ar'>('en');
  const english = useRef<HTMLTextAreaElement>(null);
  const arabic = useRef<HTMLTextAreaElement>(null);

  const save = useMutation({
    mutationFn: () => {
      const body = { nameEn: nameEn.trim(), nameAr: nameAr.trim(), bodyEn, bodyAr };
      return template ? changeLetterTemplate(template.code, body) : addLetterTemplate(body);
    },
    onSuccess: () => {
      void queries.invalidateQueries({ queryKey: ['letter-templates'] });
      onDone();
    },
  });

  const unknown = [...new Set([...unknownIn(bodyEn), ...unknownIn(bodyAr)])];
  const ready =
    nameEn.trim() !== '' &&
    nameAr.trim() !== '' &&
    bodyEn.trim() !== '' &&
    bodyAr.trim() !== '' &&
    unknown.length === 0;

  /*
   * Writes `{{name}}` where the cursor is, in the body being edited.
   *
   * Typing the braces by hand is how `{{client_nme}}` ends up in a letter, so
   * the facts the system can fill in are offered as buttons, and a typed one
   * that is not among them is flagged before saving.
   */
  function insert(name: string) {
    const token = `{{${name}}}`;
    const field = target === 'en' ? english.current : arabic.current;
    const value = target === 'en' ? bodyEn : bodyAr;
    const set = target === 'en' ? setBodyEn : setBodyAr;
    const start = field?.selectionStart ?? value.length;
    const end = field?.selectionEnd ?? value.length;
    set(`${value.slice(0, start)}${token}${value.slice(end)}`);
    queueMicrotask(() => {
      field?.focus();
      field?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  return (
    <Card
      title={template ? t('letterTemplates.editTitle') : t('letterTemplates.addTitle')}
      description={t('letterTemplates.formHint')}
    >
      <form
        className="u-stack-tight"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) save.mutate();
        }}
      >
        <Field
          label={t('settings.add.nameEn')}
          ltr
          value={nameEn}
          onChange={(event) => setNameEn(event.target.value)}
        />
        <Field
          label={t('settings.add.nameAr')}
          value={nameAr}
          onChange={(event) => setNameAr(event.target.value)}
        />

        <fieldset className="u-stack-tight">
          <legend>
            <strong>{t('letterTemplates.facts')}</strong>
          </legend>
          <p className="u-text-soft">{t('letterTemplates.factsHint')}</p>
          <div className="u-row u-row--wrap">
            {letterPlaceholders.map((name) => (
              <Button key={name} small tone="secondary" onClick={() => insert(name)}>
                {t(`letterTemplates.placeholders.${name}`)}
              </Button>
            ))}
          </div>
        </fieldset>

        <Field
          label={t('letterTemplates.bodyEn')}
          control={(props) => (
            <textarea
              {...props}
              ref={english}
              className="input input--ltr"
              dir="ltr"
              rows={12}
              value={bodyEn}
              onFocus={() => setTarget('en')}
              onChange={(event) => setBodyEn(event.target.value)}
            />
          )}
        />
        <Field
          label={t('letterTemplates.bodyAr')}
          control={(props) => (
            <textarea
              {...props}
              ref={arabic}
              className="input"
              dir="rtl"
              rows={12}
              value={bodyAr}
              onFocus={() => setTarget('ar')}
              onChange={(event) => setBodyAr(event.target.value)}
            />
          )}
        />

        {unknown.length > 0 ? (
          <Alert tone="error">
            {t('letterTemplates.unknown', {
              names: unknown.map((name) => `{{${name}}}`).join(' '),
            })}
          </Alert>
        ) : null}
        {save.isError ? <Alert tone="error">{(save.error as Error).message}</Alert> : null}

        <div className="u-row">
          <Button type="submit" busy={save.isPending} disabled={!ready}>
            {t('letterTemplates.save')}
          </Button>
          <Button tone="quiet" onClick={onDone}>
            {t('settings.add.cancel')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

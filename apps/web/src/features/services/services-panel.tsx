import type { ServiceView } from '@amc/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Badge, Button, Card, Field, Loading } from '../../design/index.js';
import { useOptions } from '../lists/use-options.js';
import { addService, changeService } from './api.js';
import { useServices } from './use-services.js';

/**
 * The services the firm offers (feedback item 8).
 *
 * The eleven built-ins are listed so the whole catalogue is in one place, and
 * are read-only: each carries a deadline rule and a recurrence that the engine
 * has to understand, and changing one from a screen would quietly change that.
 * What an administrator can add is the plain case — a one-off service with its
 * own steps and the documents it needs.
 */
export function ServicesPanel() {
  const { t, i18n } = useTranslation();
  const queries = useQueryClient();
  const services = useServices();
  const [editing, setEditing] = useState<ServiceView | 'new' | null>(null);
  const arabic = i18n.language === 'ar';

  const retire = useMutation({
    mutationFn: ({ code, retired }: { code: string; retired: boolean }) =>
      changeService(code, { retired }),
    onSuccess: () => void queries.invalidateQueries({ queryKey: ['services'] }),
  });

  if (services.loading) return <Loading label={t('loading')} />;

  const custom = services.all.filter((service) => !service.builtIn);
  const builtIn = services.all.filter((service) => service.builtIn);
  const name = (service: ServiceView) =>
    arabic ? service.nameAr || service.nameEn : service.nameEn || service.nameAr;

  return (
    <>
      {editing ? (
        <ServiceEditor
          // Keyed so opening a different service starts from that service's
          // values rather than the last one's.
          key={editing === 'new' ? 'new' : editing.code}
          service={editing === 'new' ? null : editing}
          onDone={() => setEditing(null)}
        />
      ) : (
        <div className="u-row">
          <Button onClick={() => setEditing('new')}>{t('services.admin.add')}</Button>
        </div>
      )}

      <Card title={t('services.admin.customTitle')} description={t('services.admin.customHint')}>
        {custom.length === 0 ? (
          <p className="u-text-soft">{t('services.admin.noneYet')}</p>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t('settings.name')}</th>
                  <th scope="col">{t('services.admin.steps')}</th>
                  <th scope="col">{t('settings.manage')}</th>
                </tr>
              </thead>
              <tbody>
                {custom.map((service) => (
                  <tr key={service.code}>
                    <th scope="row" className="u-typed">
                      {name(service)}
                      <span className="u-block u-text-faint u-typed">
                        {arabic ? service.nameEn : service.nameAr}
                      </span>
                      {service.retired ? (
                        <span className="u-block">
                          <Badge tone="neutral">{t('settings.retired')}</Badge>
                        </span>
                      ) : null}
                    </th>
                    <td className="u-numeric">{service.steps.length}</td>
                    <td>
                      <div className="u-row u-row--tight">
                        <Button small tone="secondary" onClick={() => setEditing(service)}>
                          {t('services.admin.edit')}
                        </Button>
                        {/*
                         * Retire, never delete: projects already opened under
                         * it have to keep showing what they were.
                         */}
                        <Button
                          small
                          tone="quiet"
                          busy={retire.isPending}
                          onClick={() =>
                            retire.mutate({ code: service.code, retired: !service.retired })
                          }
                        >
                          {service.retired ? t('settings.restore') : t('settings.retire')}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {retire.isError ? <Alert tone="error">{(retire.error as Error).message}</Alert> : null}
      </Card>

      <Card title={t('services.admin.builtInTitle')} description={t('services.admin.builtInHint')}>
        <ul className="u-stack-tight lines">
          {builtIn.map((service) => (
            <li key={service.code} className="u-row u-spread">
              <span className="u-typed">{name(service)}</span>
              <span className="u-text-faint">
                {service.recurring ? t('services.admin.recurring') : t('services.admin.oneOff')}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

type Step = { nameEn: string; nameAr: string };
type Needed = { type: string; mandatory: boolean };

/**
 * Adding or changing one.
 *
 * Steps can be renamed and added to but not removed once the service exists:
 * a project already opened under it records progress by step number, and
 * removing step 2 would relabel everything done against step 3. The server
 * refuses it too; the screen simply does not offer the button.
 */
function ServiceEditor({ service, onDone }: { service: ServiceView | null; onDone: () => void }) {
  const { t, i18n } = useTranslation();
  const queries = useQueryClient();
  const documentTypes = useOptions('document_type');
  const arabic = i18n.language === 'ar';

  const [nameEn, setNameEn] = useState(service?.nameEn ?? '');
  const [nameAr, setNameAr] = useState(service?.nameAr ?? '');
  const [days, setDays] = useState(service?.deadlineDays ? String(service.deadlineDays) : '');
  const [steps, setSteps] = useState<Step[]>(
    service ? service.steps.map((step) => ({ ...step })) : [{ nameEn: '', nameAr: '' }],
  );
  const [needed, setNeeded] = useState<Needed[]>(
    service ? service.requiredDocuments.map((document) => ({ ...document })) : [],
  );
  /** How many steps existed when this was opened; those cannot be removed. */
  const locked = service?.steps.length ?? 0;

  const save = useMutation({
    mutationFn: () => {
      const body = {
        nameEn: nameEn.trim(),
        nameAr: nameAr.trim(),
        deadlineDays: days.trim() === '' ? null : Number(days),
        steps,
        requiredDocuments: needed,
      };
      return service ? changeService(service.code, body) : addService(body);
    },
    onSuccess: () => {
      void queries.invalidateQueries({ queryKey: ['services'] });
      onDone();
    },
  });

  const daysOk = days.trim() === '' || (Number.isInteger(Number(days)) && Number(days) >= 1);
  const stepsOk = steps.some((step) => step.nameEn.trim() !== '' || step.nameAr.trim() !== '');
  const ready = nameEn.trim() !== '' && nameAr.trim() !== '' && daysOk && stepsOk;

  const setStep = (index: number, change: Partial<Step>) =>
    setSteps(steps.map((step, at) => (at === index ? { ...step, ...change } : step)));

  const toggleDocument = (type: string) =>
    setNeeded(
      needed.some((document) => document.type === type)
        ? needed.filter((document) => document.type !== type)
        : [...needed, { type, mandatory: true }],
    );

  // A type the service already requires but that has since been retired stays
  // listed, so editing does not silently drop it.
  const offered = [
    ...documentTypes.live,
    ...needed
      .filter((document) => !documentTypes.live.some((option) => option.code === document.type))
      .map((document) => ({ code: document.type, nameEn: document.type, nameAr: document.type })),
  ];

  return (
    <Card
      title={service ? t('services.admin.editTitle') : t('services.admin.addTitle')}
      description={t('services.admin.formHint')}
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
        <Field
          label={t('services.admin.deadlineDays')}
          hint={t('services.admin.deadlineDaysHint')}
          inputMode="numeric"
          value={days}
          onChange={(event) => setDays(event.target.value)}
          {...(daysOk ? {} : { error: t('services.admin.deadlineDaysBad') })}
        />

        <fieldset className="u-stack-tight">
          <legend>
            <strong>{t('services.admin.steps')}</strong>
          </legend>
          <p className="u-text-soft">{t('services.admin.stepsHint')}</p>
          {steps.map((step, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: steps are identified by their position, which is the whole point of them
            <div key={index} className="u-row u-row--end">
              <span className="u-numeric u-text-faint">{index + 1}</span>
              <div className="u-grow">
                <Field
                  label={t('services.admin.stepEn', { number: index + 1 })}
                  ltr
                  value={step.nameEn}
                  onChange={(event) => setStep(index, { nameEn: event.target.value })}
                />
              </div>
              <div className="u-grow">
                <Field
                  label={t('services.admin.stepAr', { number: index + 1 })}
                  value={step.nameAr}
                  onChange={(event) => setStep(index, { nameAr: event.target.value })}
                />
              </div>
              {index >= locked ? (
                <Button
                  small
                  tone="quiet"
                  onClick={() => setSteps(steps.filter((_, at) => at !== index))}
                  disabled={steps.length === 1}
                >
                  {t('services.admin.removeStep')}
                </Button>
              ) : null}
            </div>
          ))}
          <div className="u-row">
            <Button
              small
              tone="secondary"
              onClick={() => setSteps([...steps, { nameEn: '', nameAr: '' }])}
            >
              {t('services.admin.addStep')}
            </Button>
          </div>
        </fieldset>

        <fieldset className="u-stack-tight">
          <legend>
            <strong>{t('services.admin.documents')}</strong>
          </legend>
          <p className="u-text-soft">{t('services.admin.documentsHint')}</p>
          {offered.map((option) => {
            const chosen = needed.find((document) => document.type === option.code);
            return (
              <div key={option.code} className="u-row">
                <label className="u-row u-row--tight">
                  <input
                    type="checkbox"
                    checked={Boolean(chosen)}
                    onChange={() => toggleDocument(option.code)}
                  />
                  <span className="u-typed">{arabic ? option.nameAr : option.nameEn}</span>
                </label>
                {chosen ? (
                  <label className="u-row u-row--tight u-text-soft">
                    <input
                      type="checkbox"
                      checked={chosen.mandatory}
                      onChange={() =>
                        setNeeded(
                          needed.map((document) =>
                            document.type === option.code
                              ? { ...document, mandatory: !document.mandatory }
                              : document,
                          ),
                        )
                      }
                    />
                    {t('services.admin.mandatory')}
                  </label>
                ) : null}
              </div>
            );
          })}
        </fieldset>

        {save.isError ? <Alert tone="error">{(save.error as Error).message}</Alert> : null}

        <div className="u-row">
          <Button type="submit" busy={save.isPending} disabled={!ready}>
            {t('services.admin.save')}
          </Button>
          <Button tone="quiet" onClick={onDone}>
            {t('settings.add.cancel')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

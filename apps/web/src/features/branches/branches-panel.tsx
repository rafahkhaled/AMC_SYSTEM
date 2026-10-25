import type { BranchView } from '@amc/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Badge, Button, Card, Field, Loading } from '../../design/index.js';
import { addBranch, changeBranch } from './api.js';
import { useBranches } from './use-branches.js';

/**
 * The firm's branches (feedback item 12b).
 *
 * A branch is a letterhead: the name, addresses, and where it has them its own
 * bank account, logo and stamp, printed on the documents issued under it. It is
 * not a separate company, and the screen says so rather than letting it look
 * like one — the tax registration and the run of numbers are the firm's.
 */
export function BranchesPanel() {
  const { t, i18n } = useTranslation();
  const queries = useQueryClient();
  const branches = useBranches();
  const [editing, setEditing] = useState<BranchView | 'new' | null>(null);
  const arabic = i18n.language === 'ar';

  const retire = useMutation({
    mutationFn: ({ code, retired }: { code: string; retired: boolean }) =>
      changeBranch(code, { retired }),
    onSuccess: () => void queries.invalidateQueries({ queryKey: ['branches'] }),
  });

  if (branches.loading) return <Loading label={t('loading')} />;

  const name = (branch: BranchView) =>
    arabic ? branch.nameAr || branch.nameEn : branch.nameEn || branch.nameAr;

  return (
    <>
      {editing ? (
        <BranchEditor
          // Keyed so opening a different branch starts from that branch's values.
          key={editing === 'new' ? 'new' : editing.code}
          branch={editing === 'new' ? null : editing}
          onDone={() => setEditing(null)}
        />
      ) : (
        <div className="u-row">
          <Button onClick={() => setEditing('new')}>{t('branches.admin.add')}</Button>
        </div>
      )}

      <Card title={t('branches.admin.listTitle')} description={t('branches.admin.listHint')}>
        {branches.all.length === 0 ? (
          <p className="u-text-soft">{t('branches.admin.none')}</p>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t('settings.name')}</th>
                  <th scope="col">{t('branches.admin.addresses')}</th>
                  <th scope="col">{t('settings.manage')}</th>
                </tr>
              </thead>
              <tbody>
                {branches.all.map((branch) => (
                  <tr key={branch.code}>
                    <th scope="row" className="u-typed">
                      {name(branch)}
                      <span className="u-block u-text-faint u-typed">
                        {arabic ? branch.nameEn : branch.nameAr}
                      </span>
                      {branch.retired ? (
                        <span className="u-block">
                          <Badge tone="neutral">{t('settings.retired')}</Badge>
                        </span>
                      ) : null}
                    </th>
                    <td className="u-typed">
                      {branch.addresses.length > 0 ? (
                        branch.addresses.map((line) => (
                          <span key={line} className="u-block">
                            {line}
                          </span>
                        ))
                      ) : (
                        <span className="u-text-faint">{t('branches.admin.noAddressYet')}</span>
                      )}
                    </td>
                    <td>
                      <div className="u-row u-row--tight">
                        <Button small tone="secondary" onClick={() => setEditing(branch)}>
                          {t('services.admin.edit')}
                        </Button>
                        {/*
                         * Retire, never delete: invoices already issued under it
                         * still print as it, and a client may be holding one.
                         */}
                        <Button
                          small
                          tone="quiet"
                          busy={retire.isPending}
                          onClick={() =>
                            retire.mutate({ code: branch.code, retired: !branch.retired })
                          }
                        >
                          {branch.retired ? t('settings.restore') : t('settings.retire')}
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
    </>
  );
}

function BranchEditor({ branch, onDone }: { branch: BranchView | null; onDone: () => void }) {
  const { t } = useTranslation();
  const queries = useQueryClient();

  const [nameEn, setNameEn] = useState(branch?.nameEn ?? '');
  const [nameAr, setNameAr] = useState(branch?.nameAr ?? '');
  const [addresses, setAddresses] = useState((branch?.addresses ?? []).join('\n'));
  const [holder, setHolder] = useState(branch?.bank?.accountHolder ?? '');
  const [iban, setIban] = useState(branch?.bank?.iban ?? '');
  const [bic, setBic] = useState(branch?.bank?.bic ?? '');
  const [logoUrl, setLogoUrl] = useState(branch?.logoUrl ?? '');
  const [stampUrl, setStampUrl] = useState(branch?.stampUrl ?? '');

  const lines = addresses
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  // All of an account or none of it: an IBAN with nobody to say whose it is.
  const halfBank = (holder.trim() === '') !== (iban.trim() === '');
  const ready = nameEn.trim() !== '' && nameAr.trim() !== '' && !halfBank;

  const save = useMutation({
    mutationFn: () => {
      const body = {
        nameEn: nameEn.trim(),
        nameAr: nameAr.trim(),
        addresses: lines,
        bank:
          holder.trim() !== '' && iban.trim() !== ''
            ? {
                accountHolder: holder.trim(),
                iban: iban.trim(),
                bic: bic.trim() === '' ? null : bic.trim(),
              }
            : null,
        logoUrl: logoUrl.trim() === '' ? null : logoUrl.trim(),
        stampUrl: stampUrl.trim() === '' ? null : stampUrl.trim(),
      };
      return branch ? changeBranch(branch.code, body) : addBranch(body);
    },
    onSuccess: () => {
      void queries.invalidateQueries({ queryKey: ['branches'] });
      onDone();
    },
  });

  return (
    <Card
      title={branch ? t('branches.admin.editTitle') : t('branches.admin.addTitle')}
      description={t('branches.admin.formHint')}
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
          label={t('branches.admin.addresses')}
          hint={t('branches.admin.addressesHint')}
          control={(props) => (
            <textarea
              {...props}
              className="input u-typed"
              rows={4}
              value={addresses}
              onChange={(event) => setAddresses(event.target.value)}
            />
          )}
        />

        <fieldset className="u-stack-tight">
          <legend>
            <strong>{t('branches.admin.bank')}</strong>
          </legend>
          <p className="u-text-soft">{t('branches.admin.bankHint')}</p>
          <Field
            label={t('branches.admin.accountHolder')}
            value={holder}
            onChange={(event) => setHolder(event.target.value)}
          />
          <Field
            label={t('branches.admin.iban')}
            ltr
            value={iban}
            onChange={(event) => setIban(event.target.value)}
            {...(halfBank ? { error: t('branches.admin.bankHint') } : {})}
          />
          <Field
            label={t('branches.admin.bic')}
            ltr
            value={bic}
            onChange={(event) => setBic(event.target.value)}
          />
        </fieldset>

        <ImagePicker label={t('branches.admin.logoUrl')} value={logoUrl} onChange={setLogoUrl} />
        <ImagePicker label={t('branches.admin.stampUrl')} value={stampUrl} onChange={setStampUrl} />

        {save.isError ? <Alert tone="error">{(save.error as Error).message}</Alert> : null}

        <div className="u-row">
          <Button type="submit" busy={save.isPending} disabled={!ready}>
            {t('branches.admin.save')}
          </Button>
          <Button tone="quiet" onClick={onDone}>
            {t('settings.add.cancel')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** The largest image kept. A logo or a stamp is a few dozen kilobytes. */
const MAX_IMAGE_BYTES = 400 * 1024;

/**
 * Choosing the logo or the stamp from the computer.
 *
 * Read in the browser into a data URL and saved with the branch, so it prints
 * on every quotation and invoice without a link that could break.
 */
function ImagePicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const { t } = useTranslation();
  const [problem, setProblem] = useState<string | null>(null);

  const take = (file: File | undefined) => {
    setProblem(null);
    if (!file) return;
    if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(file.type)) {
      setProblem(t('branches.admin.imageType'));
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setProblem(t('branches.admin.imageTooLarge'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => onChange(String(reader.result));
    reader.readAsDataURL(file);
  };

  return (
    <div className="field">
      <span className="field__label">{label}</span>
      <div className="u-row u-row--tight u-wrap">
        {value ? <img src={value} alt="" className="branch__image" /> : null}
        <label className="button button--secondary button--small">
          {value ? t('branches.admin.replaceImage') : t('branches.admin.chooseImage')}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            className="u-visually-hidden"
            onChange={(event) => take(event.target.files?.[0])}
          />
        </label>
        {value ? (
          <Button type="button" small tone="quiet" onClick={() => onChange('')}>
            {t('branches.admin.removeImage')}
          </Button>
        ) : null}
      </div>
      <span className="field__hint">{t('branches.admin.imageHint')}</span>
      {problem ? <span className="u-danger">{problem}</span> : null}
    </div>
  );
}

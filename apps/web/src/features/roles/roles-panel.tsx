import type { RolePermissions } from '@amc/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Badge, Button, Card, Loading } from '../../design/index.js';
import { chooseRolePermissions, rolePermissions } from './api.js';

/** The tick boxes, in the order somebody reads down the system. */
const GROUPS: { key: string; permissions: string[] }[] = [
  {
    key: 'clients',
    permissions: [
      'clients.view.all',
      'clients.view.assigned',
      'clients.edit',
      'clients.vault.read',
    ],
  },
  {
    key: 'work',
    permissions: [
      'projects.view.all',
      'projects.edit',
      'projects.assign',
      'time.record',
      'time.edit.any',
    ],
  },
  {
    key: 'billing',
    permissions: [
      'billing.view',
      'billing.approve',
      'billing.invoice.issue',
      'billing.entries.unlink',
    ],
  },
  { key: 'admin', permissions: ['audit.read'] },
];

/**
 * What each role may do (Settings → Roles and permissions).
 *
 * The manager's column is shown and cannot be changed: a manager who could take
 * away managing would lock the firm out with one click. A change reaches
 * everyone in the role on their next click; nobody has to sign in again.
 */
export function RolesPanel() {
  const { t } = useTranslation();
  const query = useQuery({ queryKey: ['roles'], queryFn: rolePermissions });

  if (query.isLoading) return <Loading label={t('loading')} />;
  if (query.isError || !query.data) return <Alert tone="error">{t('rolesAdmin.failed')}</Alert>;

  return (
    <>
      {query.data.roles.map((role) => (
        <RoleCard key={role.role} role={role} grantable={query.data.grantable} />
      ))}
    </>
  );
}

function RoleCard({
  role,
  grantable,
}: {
  role: RolePermissions['roles'][number];
  grantable: string[];
}) {
  const { t } = useTranslation();
  const queries = useQueryClient();
  const [ticked, setTicked] = useState<Set<string>>(new Set(role.permissions));
  const [saved, setSaved] = useState(false);

  const save = useMutation({
    mutationFn: (permissions: string[]) => chooseRolePermissions(role.role, permissions),
    onSuccess: (next) => {
      queries.setQueryData(['roles'], next);
      setSaved(true);
    },
  });

  const changed =
    ticked.size !== role.permissions.length || role.permissions.some((one) => !ticked.has(one));
  const toggle = (permission: string) => {
    setSaved(false);
    const next = new Set(ticked);
    if (next.has(permission)) next.delete(permission);
    else next.add(permission);
    setTicked(next);
  };

  return (
    <Card
      title={t(`roles.${role.role}`)}
      description={role.editable ? t('rolesAdmin.editableHint') : t('rolesAdmin.fixedHint')}
    >
      <div className="u-stack">
        {GROUPS.map((group) => {
          const shown = group.permissions.filter((one) => grantable.includes(one));
          if (shown.length === 0) return null;
          return (
            <fieldset key={group.key} className="u-stack-tight">
              <legend className="field__label">{t(`rolesAdmin.groups.${group.key}`)}</legend>
              {shown.map((permission) => (
                <label key={permission} className="choice">
                  <input
                    type="checkbox"
                    checked={ticked.has(permission)}
                    disabled={!role.editable || save.isPending}
                    onChange={() => toggle(permission)}
                  />
                  <span>
                    {t(`rolesAdmin.permissions.${permission.replace(/\./g, '_')}.name`)}
                    <span className="u-block u-text-faint">
                      {t(`rolesAdmin.permissions.${permission.replace(/\./g, '_')}.hint`)}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
          );
        })}

        {role.editable ? (
          <>
            {save.isError ? <Alert tone="error">{(save.error as Error).message}</Alert> : null}
            {saved && !changed ? <Alert tone="success">{t('rolesAdmin.saved')}</Alert> : null}
            <div className="u-row">
              <Button
                busy={save.isPending}
                disabled={!changed}
                onClick={() => save.mutate([...ticked])}
              >
                {t('rolesAdmin.save')}
              </Button>
              <Button
                tone="quiet"
                disabled={save.isPending}
                onClick={() => {
                  setSaved(false);
                  setTicked(new Set(role.defaults));
                }}
              >
                {t('rolesAdmin.defaults')}
              </Button>
            </div>
          </>
        ) : (
          <Badge tone="neutral">{t('rolesAdmin.fixed')}</Badge>
        )}
      </div>
    </Card>
  );
}

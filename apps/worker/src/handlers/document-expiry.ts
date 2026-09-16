import { EXPIRY_WARNING_DAYS } from '@amc/clients/domain';
import { DrizzleDocumentRepository } from '@amc/clients/infrastructure';
import type { Database } from '@amc/database';
import type { AlertLog } from './alerts.js';

export interface ExpiryWarning {
  readonly documentId: string;
  readonly clientId: string;
  readonly clientName: string;
  readonly type: string;
  readonly daysRemaining: number;
  readonly expiresOn: string;
}

/**
 * The staged document reminders (FR-42).
 *
 * Runs once a day and asks a narrow question three times: what expires in
 * exactly ninety days, in exactly sixty, in exactly thirty? Asking for "within
 * ninety days" would raise the same warning every day for three months, and a
 * client who receives ninety reminders has learned to ignore all of them.
 *
 * Catching up after downtime is the one place that exactness costs something:
 * a sweep that missed Tuesday never asks about Tuesday's ninety-day mark
 * again. The alert log makes repeats harmless, so the sweep asks about a small
 * window around each threshold rather than a single day.
 */
export async function sweepDocumentExpiry(params: {
  db: Database;
  alerts: AlertLog;
  today: Date;
  /** How many days back to look, so a missed run still catches up. */
  catchUpDays?: number;
}): Promise<ExpiryWarning[]> {
  const documents = new DrizzleDocumentRepository(params.db);
  const catchUp = params.catchUpDays ?? 3;
  const raised: ExpiryWarning[] = [];

  for (const threshold of EXPIRY_WARNING_DAYS) {
    for (let offset = 0; offset <= catchUp; offset += 1) {
      const asAt = new Date(params.today.getTime() - offset * 86_400_000);

      for (const document of await documents.expiringOn(threshold, asAt)) {
        const isNew = await params.alerts.raise({
          subjectType: 'client_document',
          subjectId: document.documentId,
          stage: `expiry_${threshold}`,
          clientId: document.clientId,
          detail: {
            type: document.type,
            expiresOn: document.expiresOn.toISOString().slice(0, 10),
            daysRemaining: threshold,
          },
        });

        if (isNew) {
          raised.push({
            documentId: document.documentId,
            clientId: document.clientId,
            clientName: document.clientName,
            type: document.type,
            daysRemaining: threshold,
            expiresOn: document.expiresOn.toISOString().slice(0, 10),
          });
        }
      }
    }
  }

  return raised;
}

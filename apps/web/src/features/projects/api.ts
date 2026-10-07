import {
  type ProjectBoard,
  type ProjectDetail,
  type ProjectStateName,
  type Workload,
  projectBoardSchema,
  projectDetailSchema,
  workloadSchema,
} from '@amc/contracts';
import { patch, request, send } from '../auth/api.js';

export async function projectBoard(): Promise<ProjectBoard> {
  return projectBoardSchema.parse(await request('/projects'));
}

export async function projectDetail(id: string): Promise<ProjectDetail> {
  return projectDetailSchema.parse(await request(`/projects/${encodeURIComponent(id)}`));
}

export async function moveProject(
  id: string,
  to: ProjectStateName,
  /** Required when the work goes back; the server refuses without it. */
  reason?: string,
): Promise<ProjectDetail> {
  return projectDetailSchema.parse(
    await send(`/projects/${encodeURIComponent(id)}/move`, {
      to,
      ...(reason ? { reason } : {}),
    }),
  );
}

/** When a step should be finished. Null clears it. */
export async function setTaskDue(
  id: string,
  order: number,
  dueOn: string | null,
): Promise<ProjectDetail> {
  return projectDetailSchema.parse(
    await patch(`/projects/${encodeURIComponent(id)}/tasks/${order}/due`, { dueOn }),
  );
}

export async function completeTask(id: string, order: number): Promise<ProjectDetail> {
  return projectDetailSchema.parse(
    await send(`/projects/${encodeURIComponent(id)}/tasks/${order}`),
  );
}

export async function attachDocument(
  id: string,
  type: string,
  documentId: string,
): Promise<ProjectDetail> {
  return projectDetailSchema.parse(
    await send(`/projects/${encodeURIComponent(id)}/documents`, { type, documentId }),
  );
}

/** What is on each person's desk. Empty for anyone who cannot assign work. */
export async function workload(): Promise<Workload> {
  return workloadSchema.parse(await request('/projects/workload'));
}

/**
 * Opening a piece of work by hand (FR-10).
 *
 * The recurring services arrive on their own; a de-registration or a penalty
 * waiver is asked for on the phone and somebody has to be able to open it.
 */
export async function startProject(input: {
  clientId: string;
  service: string;
  dueOn?: string;
  periodKey?: string;
}): Promise<ProjectDetail> {
  return projectDetailSchema.parse(await send('/projects', input));
}

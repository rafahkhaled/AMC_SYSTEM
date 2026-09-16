import {
  type TaskBoard,
  type TaskDetail,
  type TaskStateName,
  taskBoardSchema,
  taskDetailSchema,
} from '@amc/contracts';
import { request, send } from '../auth/api.js';

export async function taskBoard(): Promise<TaskBoard> {
  return taskBoardSchema.parse(await request('/tasks'));
}

export async function taskDetail(id: string): Promise<TaskDetail> {
  return taskDetailSchema.parse(await request(`/tasks/${encodeURIComponent(id)}`));
}

export async function moveTask(id: string, to: TaskStateName): Promise<TaskDetail> {
  return taskDetailSchema.parse(await send(`/tasks/${encodeURIComponent(id)}/move`, { to }));
}

export async function completeStep(id: string, order: number): Promise<TaskDetail> {
  return taskDetailSchema.parse(await send(`/tasks/${encodeURIComponent(id)}/steps/${order}`));
}

export async function attachDocument(
  id: string,
  type: string,
  documentId: string,
): Promise<TaskDetail> {
  return taskDetailSchema.parse(
    await send(`/tasks/${encodeURIComponent(id)}/documents`, { type, documentId }),
  );
}

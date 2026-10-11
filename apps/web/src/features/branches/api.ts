import {
  type BranchView,
  type CreateBranchRequest,
  type UpdateBranchRequest,
  branchSchema,
  branchesSchema,
} from '@amc/contracts';
import { patch, request, send } from '../auth/api.js';

export async function listBranches(): Promise<BranchView[]> {
  return branchesSchema.parse(await request('/branches')).branches;
}

export async function addBranch(branch: CreateBranchRequest): Promise<BranchView> {
  return branchSchema.parse(await send('/branches', branch));
}

export async function changeBranch(
  code: string,
  changes: UpdateBranchRequest,
): Promise<BranchView> {
  return branchSchema.parse(await patch(`/branches/${encodeURIComponent(code)}`, changes));
}

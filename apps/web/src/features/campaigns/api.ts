import {
  type CampaignView,
  type CreateCampaignRequest,
  type UpdateCampaignRequest,
  campaignListSchema,
  campaignSchema,
} from '@amc/contracts';
import { patch, request, send } from '../auth/api.js';

export async function listCampaigns(): Promise<CampaignView[]> {
  return campaignListSchema.parse(await request('/campaigns')).campaigns;
}

export async function addCampaign(campaign: CreateCampaignRequest): Promise<CampaignView> {
  return campaignSchema.parse(await send('/campaigns', campaign));
}

export async function changeCampaign(
  id: string,
  changes: UpdateCampaignRequest,
): Promise<CampaignView> {
  return campaignSchema.parse(await patch(`/campaigns/${encodeURIComponent(id)}`, changes));
}

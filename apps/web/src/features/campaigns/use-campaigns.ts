import type { CampaignView } from '@amc/contracts';
import { useQuery } from '@tanstack/react-query';
import { listCampaigns } from './api.js';

/**
 * The campaigns, for a dropdown and for turning an id back into a name.
 *
 * Ended ones are still returned: an enquiry that came in from a campaign last
 * quarter has to keep showing which one.
 */
export function useCampaigns(): {
  all: CampaignView[];
  /** Not ended, so offered when somebody is attributing a new enquiry. */
  open: CampaignView[];
  nameOf: (id: string | null) => string | null;
  loading: boolean;
} {
  const query = useQuery({
    queryKey: ['campaigns'],
    queryFn: listCampaigns,
    staleTime: 60_000,
  });
  const all = query.data ?? [];
  return {
    all,
    open: all.filter((campaign) => campaign.status !== 'ended'),
    nameOf: (id) => (id ? (all.find((campaign) => campaign.id === id)?.name ?? null) : null),
    loading: query.isLoading,
  };
}

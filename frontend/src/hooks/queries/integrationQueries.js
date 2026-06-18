import { useQuery } from "@tanstack/react-query";

import { fetchTallyIntegrationInfo } from "@/api/services/integrations.service";

export const integrationQueryKeys = {
  all: ["integrations"],
  tally: (cmp_id) => [...integrationQueryKeys.all, "tally", cmp_id],
};

export const useTallyIntegrationInfoQuery = (cmp_id, enabled = true) =>
  useQuery({
    queryKey: integrationQueryKeys.tally(cmp_id),
    queryFn: () => fetchTallyIntegrationInfo(cmp_id),
    enabled: Boolean(cmp_id) && enabled,
    staleTime: 60 * 1000,
  });

import api from "../client/apiClient";

export const fetchTallyIntegrationInfo = async (cmp_id) => {
  const response = await api.get("/admin/integrations/tally", {
    params: {
      cmp_id,
    },
  });

  return response.data;
};

export const sendTallyIntegrationKeyEmail = async (cmp_id) => {
  const response = await api.post(
    "/admin/integrations/tally/send-key",
    {},
    {
      params: {
        cmp_id,
      },
    },
  );

  return response.data;
};

export const integrationsService = {
  fetchTallyIntegrationInfo,
  sendTallyIntegrationKeyEmail,
};

// import { useMemo } from "react";
import { useState } from "react";
import { useSelector } from "react-redux";
import { Copy, Link2, Mail } from "lucide-react";
import { toast } from "sonner";

import { sendTallyIntegrationKeyEmail } from "@/api/services/integrations.service";
import ErrorRetryState from "@/components/common/ErrorRetryState";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useTallyIntegrationInfoQuery } from "@/hooks/queries/integrationQueries";
import { DataEntryDetailHeader } from "@/pages/settings/DataEntrySettingsShared";


function IntegrationSkeleton() {
  return (
    <div className="mt-5">
      <Card className="shadow-md ring-slate-200 px-8">
        <CardHeader>
          <div className="h-5 w-32 animate-pulse rounded bg-slate-100" />
          <div className="h-4 w-48 animate-pulse rounded bg-slate-100" />
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="h-16 animate-pulse rounded-lg bg-slate-50" />
          <div className="h-9 w-48 animate-pulse rounded-lg bg-slate-50" />
          <div className="h-4 w-32 animate-pulse rounded bg-slate-100" />
          <div className="h-4 w-40 animate-pulse rounded bg-slate-100" />
        </CardContent>
      </Card>
    </div>
  );
}


function formatStatusLabel(status) {
  if (!status) return "Inactive";
  return status.charAt(0).toUpperCase() + status.slice(1);
}


export default function IntegrationsScreen() {
  const cmp_id = useSelector((state) => state.company.selectedCompanyId) || "";
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const {
    data,
    isLoading,
    isError,
    refetch,
  } = useTallyIntegrationInfoQuery(cmp_id);

  // const isError = true;

  const handleCopy = async () => {
    const value = data?.masked_key || "";
    if (!value) {
      toast.error("No API key available");
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Failed to copy");
    }
  };

  const handleSendToEmail = async () => {
    if (!cmp_id) {
      toast.error("Select a company first");
      return;
    }

    try {
      setIsSendingEmail(true);
      const response = await sendTallyIntegrationKeyEmail(cmp_id);
      toast.success(response?.message || "API key sent to admin email");
    } catch (error) {
      toast.error(
        error?.response?.data?.message ||
          error?.message ||
          "Failed to send API key email",
      );
    } finally {
      setIsSendingEmail(false);
    }
  };

  return (
    <section className="flex min-h-[calc(100dvh-64px)] flex-1 flex-col bg-white">

      {!cmp_id ? (
        <Card className="shadow-md ring-slate-200">
          <CardContent className="py-8 text-center text-sm text-slate-500">
            Select a company first to view integrations.
          </CardContent>
        </Card>

      ) : isLoading ? (
        <IntegrationSkeleton />

      ) : isError ? (
        <div className="flex flex-1 items-center justify-center pb-24">
          <Card className="py-6 ring-0">
            <ErrorRetryState
              message="Failed to load. Tap to retry."
              onRetry={() => refetch()}
            />
          </Card>
        </div>

      ) : (
        <div className="mt-10">
          <Card className="ring-0">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Link2 className="h-4 w-4 text-slate-700" />
                Tally ERP
              </CardTitle>
              <CardDescription>
                Manage your Tally integration details.
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-5">
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.04em] text-slate-500">
                  API Key
                </p>

                <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                  <code className="min-w-0 flex-1 truncate font-mono text-sm text-slate-900">
                    {data?.masked_key || "Not configured"}
                  </code>

                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={handleCopy}
                    aria-label="Copy API key"
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleSendToEmail}
                disabled={isSendingEmail}
                className="w-fit"
              >
                <Mail className="h-4 w-4" />
                {isSendingEmail ? "Sending..." : "Send API Key to Email"}
              </Button>

              <div className="space-y-2 text-sm text-slate-700">
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-block h-2.5 w-2.5 rounded-full ${
                      data?.status === "active"
                        ? "bg-emerald-500"
                        : "bg-slate-300"
                    }`}
                  />
                  <span>Status: {formatStatusLabel(data?.status)}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

    </section>
  );
}

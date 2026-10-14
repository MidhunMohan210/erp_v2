import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { cashTransactionService } from "@/api/services/cashTransaction.service";
import { cashTransactionQueryKeys } from "@/hooks/queries/cashTransactionQueries";
import { outstandingQueryKeys } from "@/hooks/queries/outstandingQueries";
import { partyQueryKeys } from "@/hooks/queries/partyQueries";
import { invalidateVoucherSummaryForCompany } from "@/hooks/queries/voucherQueries";
import { isTallyAcceptedConflict } from "@/utils/tallyVoucherStatus";

/**
 * Mutation hook for cancelling receipt/payment transactions.
 *
 * Side effects:
 * - updates detail cache for the cancelled doc
 * - invalidates transaction/outstanding/party aggregates
 * - invalidates voucher summary totals
 *
 * @param {{
 *   cmp_id?: string,
 *   onSuccess?: Function,
 *   onError?: Function
 * } & object} options
 * @returns {import("@tanstack/react-query").UseMutationResult}
 */
export function useCancelCashTransaction(options = {}) {
  const { cmp_id = "", onSuccess, onError, ...mutationOptions } = options;
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, payload }) => cashTransactionService.cancelCashTransaction(id, payload),
    onSuccess: async (data, variables, context) => {
      const cashTransaction = data?.data?.cashTransaction;
      const transactionId = cashTransaction?._id || variables?.id || "";
      const resolvedCmpId =
        cmp_id || variables?.payload?.cmpId || variables?.payload?.cmp_id || "";

      if (transactionId && cashTransaction) {
        queryClient.setQueryData(
          cashTransactionQueryKeys.detail(transactionId, resolvedCmpId),
          cashTransaction
        );
      }

      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: cashTransactionQueryKeys.all,
          exact: false,
          refetchType: "all",
        }),
        queryClient.invalidateQueries({
          queryKey: outstandingQueryKeys.all,
          exact: false,
          refetchType: "all",
        }),
        queryClient.invalidateQueries({
          queryKey: partyQueryKeys.all,
          exact: false,
          refetchType: "all",
        }),
        resolvedCmpId
          ? invalidateVoucherSummaryForCompany(queryClient, resolvedCmpId)
          : Promise.resolve(),
      ]);

      toast.success(data?.message || "Receipt cancelled");

      if (onSuccess) {
        await onSuccess(data, variables, context);
      }
    },
    onError: async (error, variables, context) => {
      const message =
        error?.response?.data?.message ||
        error?.message ||
        "Failed to cancel receipt";

      toast.error(message);

      if (isTallyAcceptedConflict(error)) {
        const transactionId = variables?.id || "";
        const resolvedCmpId =
          cmp_id || variables?.payload?.cmpId || variables?.payload?.cmp_id || "";
        await Promise.all([
          transactionId
            ? queryClient.invalidateQueries({
              queryKey: cashTransactionQueryKeys.detail(transactionId, resolvedCmpId),
              refetchType: "all",
            })
            : Promise.resolve(),
          queryClient.invalidateQueries({
            queryKey: cashTransactionQueryKeys.all,
            exact: false,
            refetchType: "all",
          }),
          queryClient.invalidateQueries({ queryKey: ["daybook"], exact: false }),
          resolvedCmpId
            ? invalidateVoucherSummaryForCompany(queryClient, resolvedCmpId)
            : Promise.resolve(),
        ]);
      }

      if (onError) {
        await onError(error, variables, context);
      }
    },
    ...mutationOptions,
  });
}

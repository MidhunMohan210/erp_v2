import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useDispatch } from "react-redux";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { saleOrderService } from "@/api/services/saleOrder.service";
import { saleOrderQueryKeys } from "@/hooks/queries/saleOrderQueries";
import { ROUTES } from "@/routes/paths";
import { resetSaleOrderDraft } from "@/store/slices/transactionSlice";
import { clearSaleOrderDraftStorage } from "@/utils/transactionStorage";
import { invalidateVoucherSummaryForCompany } from "@/hooks/queries/voucherQueries";
import { isTallyAcceptedConflict } from "@/utils/tallyVoucherStatus";

/**
 * Mutation hook for updating an existing sale order.
 *
 * On success it:
 * - updates detail cache
 * - invalidates sale-order list queries
 * - clears draft state/storage
 * - navigates back to detail page
 *
 * @param {{
 *   cmp_id?: string,
 *   onSuccess?: Function,
 *   onError?: Function
 * } & object} options
 * @returns {import("@tanstack/react-query").UseMutationResult}
 */
export function useUpdateSaleOrder(options = {}) {
  const {
    cmp_id = "",
    onSuccess,
    onError,
    onTallyConflict,
    ...mutationOptions
  } = options;
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, payload }) => saleOrderService.updateSaleOrder(id, payload),
    onSuccess: async (data, variables, context) => {
      const saleOrder = data?.data?.saleOrder;
      const saleOrderId = saleOrder?._id || variables?.id || "";
      const resolvedCmpId = cmp_id || variables?.payload?.cmpId || variables?.payload?.cmp_id || "";

      if (saleOrderId && saleOrder) {
        queryClient.setQueryData(
          saleOrderQueryKeys.detail(saleOrderId, resolvedCmpId),
          saleOrder,
        );
      }

      await queryClient.invalidateQueries({
        queryKey: saleOrderQueryKeys.all,
      });

      clearSaleOrderDraftStorage(resolvedCmpId);
      dispatch(resetSaleOrderDraft());
      toast.success(data?.message || "Sales order updated");

      if (saleOrderId) {
        navigate(
          ROUTES.saleOrderDetail.replace(":saleOrderId", saleOrderId),
        );
      }

      if (onSuccess) {
        await onSuccess(data, variables, context);
      }
    },
    onError: async (error, variables, context) => {
      const message =
        error?.response?.data?.message ||
        error?.message ||
        "Failed to update sales order";

      toast.error(message);

      if (isTallyAcceptedConflict(error)) {
        const saleOrderId = variables?.id || "";
        const resolvedCmpId =
          cmp_id || variables?.payload?.cmpId || variables?.payload?.cmp_id || "";
        await Promise.all([
          saleOrderId
            ? queryClient.invalidateQueries({
              queryKey: saleOrderQueryKeys.detail(saleOrderId, resolvedCmpId),
              refetchType: "all",
            })
            : Promise.resolve(),
          queryClient.invalidateQueries({ queryKey: saleOrderQueryKeys.all }),
          queryClient.invalidateQueries({ queryKey: ["daybook"], exact: false }),
          resolvedCmpId
            ? invalidateVoucherSummaryForCompany(queryClient, resolvedCmpId)
            : Promise.resolve(),
        ]);

        if (onTallyConflict) {
          await onTallyConflict(error, variables, context);
        }
      }

      if (onError) {
        await onError(error, variables, context);
      }
    },
    ...mutationOptions,
  });
}

import {
  cancelSaleOrder as cancelSaleOrderService,
  createSaleOrder as createSaleOrderService,
  getSaleOrderById as getSaleOrderByIdService,
  updateSaleOrder as updateSaleOrderService,
} from "../services/saleOrder.service.js";

// Controller responsibility:
// - Read request params/body and derive runtime context from middleware (`req.companyId`, `req.user`)
// - Validate minimum required inputs
// - Call service functions that contain transactional business logic
// - Convert thrown service errors into consistent HTTP responses
export async function createSaleOrder(req, res) {
  try {
    // Incoming payload is frontend-driven; service will perform deeper checks.
    const body = req.body || {};
    const createdSaleOrder = await createSaleOrderService(
      {
        // Company is never trusted from body; use middleware-scoped company id.
        ...body,
        cmpId: req.companyId,
        // Support both mongoose `_id` and plain `id` shapes for user object.
        userId: req.user?._id || req.user?.id || null,
      },
      req
    );

    // Standard success envelope used across backend controllers.
    return res.status(201).json({
      success: true,
      data: {
        saleOrder: createdSaleOrder,
      },
    });
  } catch (error) {
    if (process.env.NODE_ENV !== "test") {
      console.error("createSaleOrder error:", error);
    }
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to create sale order",
    });
  }
}

export async function getSaleOrderById(req, res) {
  try {
    const { saleOrderId } = req.params;
    const cmpId = req.companyId;

    // Fast fail for malformed request path.
    if (!saleOrderId) {
      return res.status(400).json({
        success: false,
        message: "saleOrderId is required",
      });
    }

    const saleOrder = await getSaleOrderByIdService(
      saleOrderId,
      { cmp_id: cmpId },
      req
    );

    // Service returns `null` if record not found or not accessible in scope.
    if (!saleOrder) {
      return res.status(404).json({
        success: false,
        message: "Sale order not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        saleOrder,
      },
    });
  } catch (error) {
    console.error("getSaleOrderById error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch sale order",
    });
  }
}

export async function updateSaleOrder(req, res) {
  try {
    // Backward compatibility: some callers may still pass `id` instead of `saleOrderId`.
    const saleOrderId = req.params.saleOrderId || req.params.id;
    const body = req.body || {};
    const cmpId = req.companyId;

    // Must include both target document and scoped company.
    if (!saleOrderId || !cmpId) {
      return res.status(400).json({
        success: false,
        message: "saleOrderId and cmpId are required",
      });
    }

    const updatedSaleOrder = await updateSaleOrderService(
      saleOrderId,
      {
        ...body,
        cmpId,
        userId: req.user?._id || req.user?.id || null,
      },
      req
    );

    return res.status(200).json({
      success: true,
      data: {
        saleOrder: updatedSaleOrder,
      },
    });
  } catch (error) {
    if (process.env.NODE_ENV !== "test") {
      console.error("updateSaleOrder error:", error);
    }
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to update sale order",
    });
  }
}

export async function cancelSaleOrder(req, res) {
  try {
    // Backward compatibility with older route param naming.
    const saleOrderId = req.params.saleOrderId || req.params.id;
    const cmpId = req.companyId;

    if (!saleOrderId || !cmpId) {
      return res.status(400).json({
        success: false,
        message: "saleOrderId and cmpId are required",
      });
    }

    const cancelledSaleOrder = await cancelSaleOrderService(
      saleOrderId,
      {
        cmpId,
        userId: req.user?._id || req.user?.id || null,
      },
      req
    );

    // Cancellation is a status change, so we return updated document snapshot.
    return res.status(200).json({
      success: true,
      message: "Sale order cancelled successfully",
      data: {
        saleOrder: cancelledSaleOrder,
      },
    });
  } catch (error) {
    if (process.env.NODE_ENV !== "test") {
      console.error("cancelSaleOrder error:", error);
    }
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to cancel sale order",
    });
  }
}

export default {
  createSaleOrder,
  getSaleOrderById,
  updateSaleOrder,
  cancelSaleOrder,
};
